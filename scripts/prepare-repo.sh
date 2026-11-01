#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Umbra IA — prépare un dépôt Git propre (public ou privé)
#
#  Usage :
#    ./scripts/prepare-repo.sh [dossier-de-sortie]
#
#  Ce script copie le projet dans un dossier neuf en excluant :
#    • .env               → contient ta clé Gemini
#    • mobile/keystore/   → clé de signature de l'APK
#    • node_modules, builds, cache Gradle, www généré
#
#  Il initialise ensuite un dépôt Git avec un premier commit prêt
#  à pousser sur GitHub / GitLab / Codeberg.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$HOME/umbra-ia-repo}"

echo "→ source : $SRC"
echo "→ sortie : $OUT"

rm -rf "$OUT"
mkdir -p "$OUT"

# rsync si dispo, sinon cp + suppression
if command -v rsync >/dev/null 2>&1; then
  rsync -a \
    --exclude='.env' \
    --exclude='.env.deploy' \
    --exclude='.env.local' \
    --exclude='node_modules/' \
    --exclude='mobile/node_modules/' \
    --exclude='mobile/www/' \
    --exclude='mobile/keystore/' \
    --exclude='mobile/keystore.properties' \
    --exclude='mobile/android/.gradle/' \
    --exclude='mobile/android/build/' \
    --exclude='mobile/android/app/build/' \
    --exclude='mobile/android/local.properties' \
    --exclude='*.jks' \
    --exclude='*.keystore' \
    --exclude='apk/' \
    --exclude='data/' \
    --exclude='shots/' \
    --exclude='.git/' \
    --exclude='*.pyc' \
    --exclude='__pycache__/' \
    "$SRC/" "$OUT/"
else
  echo "rsync absent : copie simple (les exclusions .gitignore s'appliquent au commit)"
  # motifs volontairement larges : tar compare le chemin complet (avec ./)
  tar -C "$SRC" \
      --exclude='*.env' --exclude='*.env.deploy' --exclude='*/.env' \
      --exclude='*node_modules*' --exclude='*mobile/www*' \
      --exclude='*keystore.properties' --exclude='*keystore*' \
      --exclude='*.jks' --exclude='*.keystore' \
      --exclude='*/.gradle' --exclude='*/.gradle/*' \
      --exclude='*capacitor-cordova-android-plugins/build*' \
      --exclude='*app/src/main/assets*' \
      --exclude='*android/build' --exclude='*android/build/*' \
      --exclude='*app/build' --exclude='*app/build/*' \
      --exclude='*apk/*' --exclude='*data/*' --exclude='*shots*' --exclude='.git' \
      -cf - . | tar -C "$OUT" -xf -
fi

# dossier data vide mais conservé (le serveur y écrit notes et mémoire)
mkdir -p "$OUT/data"
touch "$OUT/data/.gitkeep"

cd "$OUT"

# ── sécurité : aucun secret ne doit partir ──
if [ -f .env ] || [ -f mobile/keystore.properties ] || ls mobile/keystore/*.jks >/dev/null 2>&1; then
  echo "✗ ARRÊT : un fichier sensible a survécu à la copie. Rien n'a été commité."
  exit 1
fi

git init -q -b main 2>/dev/null || git init -q
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-Umbra}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-umbra@localhost}" \
    commit -q -m "Umbra IA 2.0 — assistant personnel installable (web, desktop, APK, en ligne)"

FILES=$(git ls-files | wc -l)
SIZE=$(du -sh . --exclude=.git 2>/dev/null | cut -f1)

cat <<TXT

✔ Dépôt prêt : $OUT
   $FILES fichiers, $SIZE (sans .git)

   Aucun secret embarqué :
     · .env                    exclu  (ta clé Gemini reste chez toi)
     · mobile/keystore/        exclu  (clé de signature de l'APK)
     · apk/, data/, node_modules/ exclus

   Pour publier :

     cd $OUT
     git remote add origin git@github.com:TON-COMPTE/umbra-ia.git
     git push -u origin main

   GitHub te donnera alors une adresse à coller partout :
     https://github.com/TON-COMPTE/umbra-ia

TXT
