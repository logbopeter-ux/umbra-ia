#!/bin/sh
# ─────────────────────────────────────────────────────────────
#  Umbra IA — point d'entrée du conteneur
#
#  Pourquoi ce script existe :
#  Render monte les disques persistants appartenant à ROOT. Or l'image
#  lance Umbra avec l'utilisateur non privilégié « node » (uid 1000), qui
#  ne peut donc pas écrire dans /app/data → les notes échoueraient en
#  « EACCES: permission denied ».
#
#  On démarre donc en root uniquement pour redonner /app/data à « node »,
#  puis on abandonne immédiatement les privilèges avec su-exec.
#  Sans disque monté, ce script ne change rien au comportement.
# ─────────────────────────────────────────────────────────────
set -e

# Doit correspondre au dossier codé en dur dans server/tools.js : <projet>/data
DATA_DIR="${UMBRA_DATA_DIR:-/app/data}"

mkdir -p "$DATA_DIR/notes" "$DATA_DIR/screenshots" "$DATA_DIR/python"

if [ "$(id -u)" = "0" ]; then
  # Volumes Render = root:root → on aligne sur l'utilisateur applicatif.
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  exec su-exec node "$@"
fi

# Déjà non-root (docker run --user, ou disque aux bons droits) : rien à faire.
exec "$@"
