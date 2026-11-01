#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Umbra IA — mettre à jour un dépôt GitHub existant
#
#  Ce script remplace le contenu de ton dépôt par la version 2.1,
#  vérifie que tout tient debout, puis pousse le commit.
#
#  Usage :
#     ./maj-depot-github.sh https://github.com/TON-COMPTE/umbra-ia.git
#     ./maj-depot-github.sh git@github.com:TON-COMPTE/umbra-ia.git
#
#  Jeton GitHub (dépôt privé, ou pour éviter de saisir un mot de passe) :
#     GITHUB_TOKEN=ghp_xxx ./maj-depot-github.sh <url>
#
#     Le jeton se passe en VARIABLE D'ENVIRONNEMENT, jamais en argument :
#     il n'apparaît ainsi ni dans l'historique du shell ni dans « ps ».
#     Il est masqué dans tous les messages, et n'est jamais écrit sur le disque.
#
#  Options :
#     ./maj-depot-github.sh <url> --sans-tests    pour pousser sans lancer les tests
#     ./maj-depot-github.sh <url> --source /chemin/vers/umbra-ia
#
#  Ce qui est préservé dans le dépôt :
#     .git/   — l'historique et les remotes
#     .env    — tes clés, si tu en as un (jamais poussé, il est ignoré)
#     data/   — tes notes et captures locales
#
#  Ce qui est remplacé : tout le reste (server, web, docs, tests, Dockerfile…)
# ─────────────────────────────────────────────────────────────

set -euo pipefail

ROUGE=$'\033[31m'; VERT=$'\033[32m'; JAUNE=$'\033[33m'; GRIS=$'\033[90m'; RAZ=$'\033[0m'
dire  () { printf '%s\n' "$*"; }
ok    () { printf '%s✔%s %s\n' "$VERT" "$RAZ" "$*"; }
attention () { printf '%s⚠%s  %s\n' "$JAUNE" "$RAZ" "$*"; }
erreur() { printf '%s✘%s %s\n' "$ROUGE" "$RAZ" "$*" >&2; }

URL="${1:-}"
[[ -z "$URL" || "$URL" == "-h" || "$URL" == "--help" ]] && {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}
shift

SANS_TESTS=0
SOURCE="$(cd "$(dirname "$0")" && pwd)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sans-tests) SANS_TESTS=1; shift ;;
    --source) SOURCE="$2"; shift 2 ;;
    *) erreur "Option inconnue : $1"; exit 1 ;;
  esac
done

# ── jeton d'accès ────────────────────────────────────────────
JETON="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
masquer() {  # remplace le jeton par *** dans tout texte affiché
  if [[ -n "$JETON" ]]; then sed "s|$JETON|***|g"; else cat; fi
}
avec_jeton() {  # https://github.com/a/b.git → https://x-access-token:TOKEN@github.com/a/b.git
  local u="$1"
  if [[ -z "$JETON" || "$u" != https://* ]]; then printf '%s' "$u"; return; fi
  printf '%s' "${u/https:\/\//https://x-access-token:${JETON}@}"
}

# ── vérifications ────────────────────────────────────────────
command -v git >/dev/null || { erreur "git n'est pas installé."; exit 1; }
[[ -d "$SOURCE/server" ]] || { erreur "Code source introuvable dans : $SOURCE"; erreur "Utilise --source /chemin/vers/umbra-ia"; exit 1; }
[[ -f "$SOURCE/server/fichiers.js" ]] || { erreur "Ce dossier n'est pas la version 2.1 (server/fichiers.js manquant)."; exit 1; }

VERSION=$(grep -m1 '"version"' "$SOURCE/package.json" | sed 's/.*: *"\(.*\)".*/\1/')
ok "Code source : $SOURCE"
ok "Version détectée : $VERSION"

# ── récupération du dépôt ────────────────────────────────────
TRAVAIL=$(mktemp -d)
trap 'rm -rf "$TRAVAIL"' EXIT
DEPOT="$TRAVAIL/depot"

dire ""
dire "${GRIS}Récupération du dépôt…${RAZ}"
URL_AUTH=$(avec_jeton "$URL")
if ! git clone --quiet "$URL_AUTH" "$DEPOT" 2>"$TRAVAIL/erreur.txt"; then
  erreur "Impossible de cloner le dépôt."
  masquer < "$TRAVAIL/erreur.txt" | sed 's/^/    /' >&2
  cas=$(grep -o "Authentication failed\|Repository not found\|does not exist\|Permission denied\|Could not resolve" "$TRAVAIL/erreur.txt" | head -1)
  case "$cas" in
    "Authentication failed") erreur "Jeton refusé : il a peut-être expiré, ou n'a pas le droit « Contents : Read and write » sur ce dépôt." ;;
    "Repository not found") erreur "Dépôt introuvable : vérifie l'adresse, ou qu'il est bien privé ET accessible par ce compte." ;;
    "does not exist") erreur "Dépôt introuvable : l'adresse ne correspond à aucun dépôt." ;;
    "Permission denied") erreur "Clé SSH refusée : teste avec 'ssh -T git@github.com'." ;;
    "Could not resolve") erreur "Adresse introuvable : vérifie l'orthographe et ta connexion." ;;
  esac
  exit 1
fi
BRANCHE=$(git -C "$DEPOT" branch --show-current)
ok "Dépôt récupéré — branche « $BRANCHE », $(git -C "$DEPOT" rev-list --count HEAD 2>/dev/null || echo 0) commit(s)"

# ── remplacement du contenu ──────────────────────────────────
dire ""
dire "${GRIS}Remplacement du contenu…${RAZ}"
AVANT=$(git -C "$DEPOT" rev-parse HEAD)

# tout sauf .git, .env et data/ (qui restent au dépôt)
find "$DEPOT" -mindepth 1 -maxdepth 1 \
  ! -name '.git' ! -name '.env' ! -name 'data' \
  -exec rm -rf {} +

# puis on copie la nouvelle version, sans les dossiers lourds ou secrets
tar -C "$SOURCE" \
    --exclude='./.git' \
    --exclude='./.env' \
    --exclude='./.env.local' \
    --exclude='./node_modules' \
    --exclude='./mobile/node_modules' \
    --exclude='./mobile/android/build' \
    --exclude='./mobile/android/.gradle' \
    --exclude='./mobile/android/app/build' \
    --exclude='./mobile/keystore' \
    --exclude='./release' \
    --exclude='./dist' \
    -cf - . | tar -C "$DEPOT" -xf -
mkdir -p "$DEPOT/data"

NB_FICHIERS=$(find "$DEPOT" -type f ! -path '*/.git/*' | wc -l | tr -d ' ')
ok "Fichiers en place : $NB_FICHIERS"
if [[ "$NB_FICHIERS" -gt 400 ]]; then
  attention "$NB_FICHIERS fichiers : c'est beaucoup pour ce projet (≈ 90 attendus)."
  dire "    Vérifie que tu ne pousses pas node_modules ou un dossier de build."
  dire "    Le dossier propre est celui livré dans Umbra-IA-2.1-repo.zip."
fi

# ── vérifications avant de pousser ───────────────────────────
dire ""
dire "${GRIS}Contrôles…${RAZ}"
CONTROLES_OK=1
for f in Dockerfile render.yaml package.json server/fichiers.js server/index.js web/app.js web/index.html; do
  if [[ -e "$DEPOT/$f" ]]; then
    ok "$f"
  else
    erreur "$f manquant"; CONTROLES_OK=0
  fi
done
[[ $CONTROLES_OK -eq 1 ]] || { erreur "Contenu incomplet : rien n'a été poussé."; exit 1; }

# Une vraie clé est longue ; « sk-ant-… » dans un exemple ne doit pas alerter.
MOTIF_CLE='(AQ\.[A-Za-z0-9_-]{30,}|sk-ant-[A-Za-z0-9_-]{30,}|gsk_[A-Za-z0-9]{35,}|sk-[A-Za-z0-9]{35,})'
if grep -rlE "$MOTIF_CLE" "$DEPOT" --include='*.js' --include='*.json' --include='*.md' \
     --include='*.txt' --include='*.yml' --include='*.yaml' --exclude-dir=.git 2>/dev/null; then
  erreur "Une clé API semble présente dans les fichiers. Rien n'a été poussé :"
  grep -rlE "$MOTIF_CLE" "$DEPOT" --include='*.js' --include='*.json' --include='*.md' \
    --include='*.txt' --include='*.yml' --include='*.yaml' --exclude-dir=.git | sed 's/^/    /'
  dire "    Retire-la, ou pousse avec --sans-tests après vérification manuelle."
  exit 1
fi
ok "Aucune clé API dans les fichiers"

if [[ $SANS_TESTS -eq 0 ]] && command -v npm >/dev/null; then
  dire "${GRIS}Lancement des tests (30 s environ)…${RAZ}"
  if ( cd "$DEPOT" && npm test >"$TRAVAIL/tests.log" 2>&1 ); then
    resume=$(grep -E '^# (pass|fail)' "$TRAVAIL/tests.log" | tr '\n' ' ')
    ok "Tests : $resume"
  else
    erreur "Les tests échouent — rien n'a été poussé."
    tail -25 "$TRAVAIL/tests.log" | sed 's/^/    /'
    exit 1
  fi
fi

# ── commit et push ───────────────────────────────────────────
dire ""
git -C "$DEPOT" add -A
if git -C "$DEPOT" diff --cached --quiet; then
  attention "Aucun changement : le dépôt est déjà à jour."
  exit 0
fi

RESUME=$(git -C "$DEPOT" diff --cached --stat | tail -1)
git -C "$DEPOT" -c user.name="${GIT_AUTEUR:-Umbra IA}" \
                -c user.email="${GIT_EMAIL:-umbra@localhost}" \
  commit --quiet -m "Umbra IA $VERSION — pièces jointes, vision, retour à la ligne"
ok "Commit créé — $RESUME"

dire ""
dire "${GRIS}Envoi vers GitHub…${RAZ}"
git -C "$DEPOT" remote set-url origin "$URL_AUTH" 2>/dev/null || true
if git -C "$DEPOT" push --quiet origin "$BRANCHE" 2>"$TRAVAIL/push.txt"; then
  git -C "$DEPOT" remote set-url origin "$URL" 2>/dev/null || true
  ok "Poussé sur origin/$BRANCHE"
  dire ""
  dire "  ${VERT}Étape suivante :${RAZ} Render → Manual Deploy → Deploy latest commit"
  dire "  ${GRIS}Guide : docs/DEPLOYER-RENDER.md${RAZ}"
else
  erreur "L'envoi a échoué."
  masquer < "$TRAVAIL/push.txt" | sed 's/^/    /' >&2
  if grep -q 'rejected\|non-fast-forward' "$TRAVAIL/push.txt"; then
    attention "Le dépôt distant a des commits que tu n'as pas en local."
    dire "    Deux issues, au choix :"
    dire "      • fusionner à la main : git pull --rebase, puis relancer ce script"
    dire "      • écraser le distant :  git push --force-with-lease origin $BRANCHE"
  fi
  exit 1
fi
