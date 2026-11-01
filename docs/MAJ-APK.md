# 📲 Mettre à jour l'APK sur le téléphone

La version **2.1.1** ajoute les pièces jointes (photos, PDF, Word, Excel…) et le
bouton « aller à la ligne ». Voici comment la mettre sur le téléphone sans perdre
vos conversations.

---

## Ce qu'il faut mettre à jour — et pourquoi deux choses

L'application Android ne charge pas son interface depuis internet : **elle
l'embarque**. C'est ce qui lui permet de s'ouvrir instantanément et de garder son
allure même si le serveur est loin. Conséquence directe :

| Ce qui change | Où ça se met à jour |
|---|---|
| Le trombone, les vignettes, le bouton ↵, l'apparence | **dans l'APK** → réinstaller |
| L'extraction des PDF/Word/Excel, la vision, la bascule entre cerveaux | **sur le serveur** → redémarrer |

Si vous ne mettez à jour que le serveur, le téléphone garde l'ancien écran (sans
trombone). Si vous ne mettez à jour que l'APK, le trombone apparaît mais le serveur
répondra « route inconnue ». **Il faut les deux.** C'est l'affaire de cinq minutes.

---

## Étape 1 — Mettre le serveur à jour

### Si Umbra tourne sur votre ordinateur

Arrêtez le serveur (Ctrl+C dans sa fenêtre) puis relancez-le :

```bash
cd umbra-ia
node server/index.js
```

Au démarrage, la bannière doit afficher **Umbra IA 2.1**. Si elle affiche encore
2.0, c'est que les fichiers n'ont pas été remplacés.

Vérification en une ligne :

```bash
curl -s http://localhost:4173/api/health | grep -o '"version":"[^"]*"'
# → "version":"2.1.1"
```

### Si Umbra est hébergée en ligne (Render, VPS…)

Envoyez le nouveau code puis redéployez. Le serveur n'a **rien de nouveau à
installer** : aucune dépendance ajoutée, toujours Node pur. Il faut simplement que
le dossier `data/` soit persistant (volume), sinon les pièces jointes seront
perdues à chaque redéploiement.

---

## Étape 2 — Récupérer l'APK sur le téléphone

### La méthode courte : par le serveur

Le serveur sait maintenant distribuer son propre APK. Sur le téléphone, connecté
au **même Wi-Fi** que l'ordinateur :

1. Ouvrez **Chrome** sur le téléphone.
2. Tapez l'adresse affichée au démarrage du serveur, suivie de `/apk` :

   ```
   http://192.168.1.42:4173/apk
   ```

   (remplacez par votre adresse locale — elle s'affiche sous « Réseau » au lancement)

3. Le mot de passe d'Umbra vous est demandé, puis le téléchargement commence.
4. Ouvrez le fichier téléchargé → **Installer**.

C'est le chemin le plus court : pas de câble, pas d'ordinateur à portée de main.

### La méthode sûre : par câble

```bash
adb install -r apk/Umbra-IA-2.1.1.apk
```

Le `-r` signifie « remplacer en gardant les données ». C'est l'équivalent de la
mise à jour depuis le téléphone.

### La méthode manuelle

Copiez `apk/Umbra-IA-2.1.1.apk` sur le téléphone (câble USB, Google Drive,
Telegram…), puis touchez le fichier dans le gestionnaire de fichiers.

---

## Étape 3 — Installer par-dessus l'ancienne version

Android acceptera la mise à jour sans désinstaller, **à une condition** : que la
signature soit identique. Elle l'est — les deux APK sont signés avec la même clé
(`Umbra IA`, empreinte `FE:58:24:1C…7F:95`), et la version interne passe de 2 à 3.

Ce que cela signifie concrètement :

| Point | Résultat |
|---|---|
| Conversations, mémoire, réglages | **conservés** |
| Sur le serveur : pièces jointes et notes | **conservés** |
| Désinstallation préalable | **inutile** |
| Compte Google, Play Store | **non requis** |

> ⚠️ Si Android affiche « Application non installée » ou « Signature
> incompatible », c'est que l'ancienne version provenait d'une autre clé. Dans ce
> cas seulement : désinstallez l'ancienne, puis installez la nouvelle. Les
> conversations vivent sur le téléphone, elles partiront avec — exportez-les
> avant si besoin.

Android peut aussi demander d'autoriser l'installation depuis Chrome ou le
gestionnaire de fichiers : **Paramètres → Applications → Accès spéciaux →
Installer des applications inconnues**.

---

## ⚠️ Si les boutons sont visibles mais ne font rien

C'est le symptôme d'un **ancien fichier resté en cache** : le HTML est à jour,
le JavaScript ne l'est pas. Depuis la 2.1.1, les fichiers de l'application sont
chargés avec un numéro de version (`/app.js?v=2.1.1`) et le service worker les
demande au réseau en priorité — le mélange ne peut plus se produire.

Pour une installation antérieure, deux gestes suffisent :

- **Dans le navigateur** : recharger en forçant (`Ctrl+Maj+R`, ou vider le cache
  des sites dans les réglages).
- **Dans l'APK** : installer la 2.1.1 par-dessus ; elle se débarrasse elle-même
  de l'ancien service worker.

Réglages → **Version** affiche désormais l'interface réellement en cours
d'exécution. Si elle indique autre chose que la version du serveur, c'est un
cache : rechargez.

## Étape 4 — Vérifier que la mise à jour a pris

Dans l'application :

1. **Réglages** en bas à gauche → l'adresse du serveur est-elle toujours la
   bonne ? (`http://192.168.1.42:4173` ou votre adresse en ligne)
2. En haut à gauche, la petite mention doit indiquer **v2.1.1**.
3. Sous le champ de saisie, un **trombone** à gauche et un **bouton ↵** à droite.
4. Touchez le trombone : le sélecteur Android doit s'ouvrir avec « Photos »,
   « Fichiers » et « Appareil photo ».

Si le trombone ne s'ouvre pas, c'est que l'APK installé est encore le 2.0 :
recommencez l'étape 2.

---

## Le premier test, en trente secondes

1. Trombone → **Photos** → choisissez n'importe quelle image.
2. Elle apparaît en vignette au-dessus du champ.
3. Écrivez « Décris cette image » et envoyez.
4. Umbra doit répondre en décrivant réellement ce qu'elle voit.

Puis un second essai avec un **PDF** : le texte doit être lu, pas seulement le nom
du fichier.

> 💡 Le premier envoi peut prendre deux ou trois secondes : l'image est d'abord
> réduite puis transmise au serveur. Les suivants sont immédiats.

---

## En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Rien ne se passe » au trombone | APK 2.0 encore installé | réinstaller l'APK 2.1 |
| « Réseau indisponible » à l'envoi | adresse du serveur absente ou obsolète | Réglages → adresse du serveur |
| L'image s'envoie mais Umbra ne la voit pas | le cerveau actif ne voit pas les images | voir la ligne suivante |
| « Ce cerveau ne voit pas les images » | Groq ou Ollama `llama3.1` (modèles texte) | ajouter une clé Gemini, ou `ollama pull llava` |
| « Session expirée » | jeton périmé après redémarrage | se reconnecter (Réglages → Se déconnecter, puis mot de passe) |
| Le PDF répond « page scannée » | PDF sans couche de texte | photographier la page et envoyer l'image |
| Fichier refusé | plus de 25 Mo | compresser ou découper |

---

## Pour les mises à jour suivantes

Chaque nouvelle version suit les mêmes quatre étapes. Deux réflexes qui évitent
les mauvaises surprises :

1. **Changez le numéro de version** dans `mobile/android/app/build.gradle`
   (`versionCode` doit **toujours augmenter** — Android refuse de rétrograder) :
   ```gradle
   versionCode 4
   versionName "2.2.0"
   ```
2. **Rebâtissez avec la même clé** — `mobile/keystore/umbra-release.jks`. Si ce
   fichier est perdu, plus aucune mise à jour ne pourra s'installer par-dessus :
   il faudra désinstaller. Gardez-en une copie quelque part de sûr.

La recette complète du build :

```bash
cd mobile
npm run sync:web          # copie web/ → mobile/www
npx cap sync android      # met à jour le projet Android
cd android
echo "sdk.dir=/opt/android-sdk" > local.properties
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk \
GRADLE_USER_HOME=/opt/gradle-home \
./gradlew assembleRelease --no-daemon -x lintVitalAnalyzeRelease -x lintVitalRelease
cp app/build/outputs/apk/release/app-release.apk ../apk/Umbra-IA-2.1.1.apk
```

Puis vérifier la signature, sans quoi Android refusera la mise à jour :

```bash
apksigner verify --print-certs apk/Umbra-IA-2.1.1.apk
```
