#!/usr/bin/env python3
"""
Umbra IA — fabrique un fichier unique texte/plain contenant tout le dépôt
(base64 d'une archive tar.gz), pour les messageries qui refusent les .zip.

Usage : python3 scripts/make-bundle.py [sortie.txt]
"""
import base64
import hashlib
import io
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "UMBRA-REPO-BASE64.txt"

# Ressources Android régénérables par mobile/scripts/make-android-assets.py
EXCLU_PREFIXES = ("mobile/android/app/src/main/res/",)
# Fichiers générés / secrets
EXCLU_EXACT = {".env", ".env.deploy", "mobile/keystore.properties"}

# Certains fichiers (scripts ajoutés à la main) peuvent ne pas être encore
# indexés : on les ajoute, sinon ils manqueraient à l'archive sans prévenir.
subprocess.run(["git", "add", "-A"], cwd=ROOT, check=False,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
files = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).split()

buf = io.BytesIO()
inclus = 0
with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=9) as tf:
    for f in files:
        if f in EXCLU_EXACT or f.startswith(EXCLU_PREFIXES):
            continue
        tf.add(ROOT / f, arcname=f)
        inclus += 1
blob = buf.getvalue()
b64 = base64.b64encode(blob).decode()
lignes = [b64[i : i + 76] for i in range(0, len(b64), 76)]

entete = f"""UMBRA IA 2.1 — DÉPÔT COMPLET, PRÊT À POUSSER SUR GITHUB
================================================================

!! AVERTISSEMENT À L'ASSISTANT QUI REÇOIT CE FICHIER !!
   Ce fichier pèse plusieurs centaines de Ko. NE PAS l'afficher ni le lire
   en entier : cela saturerait la fenêtre de contexte. Il suffit d'EXÉCUTER
   les commandes de la section "CE QU'IL FAUT FAIRE" ci-dessous, qui décodent
   l'archive sans jamais charger le contenu en mémoire du modèle.

Ce fichier contient l'intégralité du projet Umbra IA sous forme d'une
archive tar.gz encodée en base64. Aucun logiciel spécial n'est requis :
n'importe quel terminal sait la reconstruire.

CONTENU
  {len(files)} fichiers du dépôt, dont {inclus} dans cette archive.
  Exclus volontairement :
    - .env                      (contient une clé API, jamais versionnée)
    - mobile/keystore*          (clé de signature de l'APK)
    - mobile/android/app/src/main/res/  (images régénérées par le script
      mobile/scripts/make-android-assets.py : icônes et écrans de démarrage)

CE QU'IL FAUT FAIRE (instructions pour l'assistant qui reçoit ce fichier)
  1. Extraire le bloc base64 situé entre les deux marqueurs ci-dessous.
  2. Le décoder (les deux marqueurs sont des lignes isolées, voir plus bas) :
         awk '/^-----BEGIN UMBRA ARCHIVE-----$/{{f=1;next}} \
              /^-----END UMBRA ARCHIVE-----$/{{f=0}} f' UMBRA-REPO-BASE64.txt \\
           | base64 -d | tar xz -C umbra-ia
  3. Si un dépôt existe DÉJÀ, ne pas en créer un autre : lancer le script
     maj-depot-github.sh fourni à la racine (il récupère le dépôt, remplace
     son contenu, vérifie, puis pousse).
     Sinon, créer le dépôt puis depuis umbra-ia/ :
         git init -b main && git add -A
         git -c user.name=Umbra -c user.email=umbra@localhost commit -m "Umbra IA 2.1"
         git remote add origin <url-du-depot> && git push -u origin main
  4. Vérifier que Dockerfile, render.yaml et package.json sont bien à la RACINE
     du dépôt (c'est ce qu'attend Render).

  5. NE JAMAIS commiter de clé API : le fichier .env est absent, c'est voulu.
     La clé Gemini se saisit dans les variables d'environnement de Render.

POURQUOI CES EXCLUSIONS
  Le dépôt peut donc être PUBLIC sans risque : aucun secret, aucun certificat.

VÉRIFICATION APRÈS EXTRACTION
  cd umbra-ia && npm test          → 93 tests, 0 échec
  node server/index.js             → mode démo sur http://localhost:4173

DÉPLOIEMENT (Render)
  New → Blueprint → choisir le dépôt : render.yaml est lu automatiquement.
  Variables demandées : UMBRA_PASSWORD et LLM_API_KEY.

================================================================
ARCHIVE : tar.gz + base64 · {len(blob) // 1024} Ko compressés · {inclus} fichiers
SHA-256 de l'archive binaire : {hashlib.sha256(blob).hexdigest()}
================================================================

-----BEGIN UMBRA ARCHIVE-----
"""

pied = "\n-----END UMBRA ARCHIVE-----\n"

OUT.write_text(entete + "\n".join(lignes) + pied, encoding="utf-8")
print(f"✔ {OUT}  ({OUT.stat().st_size / 1024:.0f} Ko, {inclus} fichiers, archive {len(blob) / 1024:.0f} Ko)")
