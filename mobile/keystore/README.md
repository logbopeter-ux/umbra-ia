# Keystore de signature Android

Ce dossier reçoit **`umbra-release.jks`**, la clé qui signe les APK de production.
Il n'est **jamais** versionné : `.gitignore` exclut `*.jks` et `mobile/keystore.properties`.

⚠️ **Perdre ce fichier = impossible de publier une mise à jour** qui s'installe
par-dessus l'application déjà installée sur les téléphones. Sauvegarde-le hors
du dépôt (gestionnaire de mots de passe, clé USB chiffrée).
Et s'il fuit, quelqu'un peut signer une fausse application en ton nom.

## Reconstruire un keystore

```bash
cd mobile/keystore
keytool -genkeypair -v -keystore umbra-release.jks -alias umbra \
  -keyalg RSA -keysize 2048 -validity 10950 \
  -dname "CN=Umbra IA, O=Umbra, L=Cotonou, ST=Littoral, C=BJ"
```

## Compiler un APK signé

Les mots de passe ne sont **pas** écrits dans le dépôt : ils passent par
l'environnement (le `build.gradle` les lit en priorité).

```bash
cd mobile
npm install && npm run cap:sync
cd android
UMBRA_STORE_PASSWORD='…' UMBRA_KEY_PASSWORD='…' UMBRA_KEY_ALIAS=umbra \
  ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Sans `mobile/keystore/umbra-release.jks`, la compilation retombe
automatiquement sur la signature debug (APK installable, mais pas publiable).
