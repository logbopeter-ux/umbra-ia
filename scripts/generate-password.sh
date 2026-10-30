#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Umbra IA — génère un mot de passe fort + un secret de session
#  Usage : ./scripts/generate-password.sh
#  Puis copie la sortie dans ton tableau de bord d'hébergement.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# 4 mots français courants + 4 chiffres ≈ 40 bits d'entropie, facile à dicter
MOTS=("ombre" "lune" "nuit" "étoile" "orage" "rivière" "cuivre" "sable" "brume" "cèdre" "faucon" "marée" "granit" "silex" "brume" "aube")
MDP=""
for _ in 1 2 3 4; do
  MDP+="${MOTS[$((RANDOM % ${#MOTS[@]}))]}"
  [ "$MDP" != "${MDP%??}" ] && MDP+="-"
done
MDP="${MDP%-}-$(printf '%04d' $((RANDOM % 10000)))"

SECRET=$(openssl rand -hex 32)

cat <<TXT

  🔐 Mot de passe d'accès à Umbra (à saisir sur la page de connexion)
      $MDP

  🔑 Secret de session (colle-le dans UMBRA_SESSION_SECRET)
      $SECRET

  Sur un serveur Linux, tu peux aussi ajouter ceci à ton .env :

    UMBRA_PASSWORD=$MDP
    UMBRA_SESSION_SECRET=$SECRET

TXT
