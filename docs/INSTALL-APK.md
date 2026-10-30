# 📱 Installer Umbra IA sur Android (fichier APK)

Umbra existe maintenant en **vraie application Android** — pas seulement un site
web ouvert dans Chrome. Tu télécharges un fichier, tu l'installes, l'icône Umbra
apparaît sur ton écran d'accueil, et elle fonctionne en plein écran, avec
la dictée vocale branchée sur la reconnaissance vocale d'Android.

---

## 1. Le fichier à installer

Dans le dossier `apk/` du projet :

| Fichier | Taille | À utiliser |
|---|---|---|
| **`Umbra-IA-2.0.0.apk`** | 3,9 Mo | ✅ **celui-ci** — version de production, signée |
| `Umbra-IA-2.0.0-debug.apk` | 4,8 Mo | seulement pour le dépannage / tests |

La version de production est signée avec un certificat à ton nom
(`CN=Umbra IA, L=Cotonou, C=BJ`), valable 32 ans. C'est ce qui permet de
publier plus tard des mises à jour qui s'installent **par-dessus** l'ancienne,
sans désinstaller.

> 💡 Les deux fichiers portent le même `applicationId` (`app.umbra.ia`).
> Si tu installes la version debug après la production, Android refuse :
> désinstalle d'abord, ou garde uniquement celle que tu veux.

---

## 2. Copier l'APK sur le téléphone

Trois méthodes, au choix.

**A. Par câble (le plus sûr)**

```bash
adb install -r apk/Umbra-IA-2.0.0.apk
```

**B. Par transfert de fichier**
Câble USB en mode « transfert de fichiers », Google Drive, WhatsApp (envoie-toi
le fichier à toi-même), ou Bluetooth. Le fichier arrive dans `Téléchargements`.

**C. Par lien**
Mets l'APK sur ton hébergement (Render, ton site…) et ouvre le lien depuis
Chrome sur le téléphone.

---

## 3. Autoriser l'installation « depuis les sources inconnues »

Android bloque par défaut les applications qui ne viennent pas du Play Store.
C'est une sécurité normale — tu la lèves uniquement pour l'app qui va installer
l'APK (ton gestionnaire de fichiers, ou Chrome).

**Android 12 et plus récent :**

1. Ouvre le fichier `Umbra-IA-2.0.0.apk` depuis **Fichiers** / **Téléchargements**.
2. Android affiche « Pour votre sécurité, votre téléphone n'est pas autorisé à
   installer d'applications inconnues issues de cette source ».
3. Touche **Paramètres** dans ce message.
4. Active **« Autoriser depuis cette source »**.
5. Reviens en arrière → **Installer**.

**Android 8 à 11 :**

1. ⚙️ **Paramètres** → **Applications** → **Accès spéciaux**
2. → **Installer des applications inconnues**
3. → choisis **Fichiers** (ou Chrome) → active l'interrupteur.

**Xiaomi / Redmi / POCO (MIUI)** : en plus, désactive
« Analyse MIUI » dans l'écran d'installation, ou attends 10 secondes que
le compte à rebours finisse.

**Samsung / One UI** : il faut parfois désactiver **Paramètres → Sécurité et
confidentialité → Installer des applications inconnues → Fichiers → Autoriser**.

---

## 4. Premier lancement

L'icône **Umbra IA** (lune sombre sur fond noir) apparaît sur l'écran d'accueil.

1. Ouvre-la. Un écran **« Connecter Umbra »** s'affiche.
2. Il te faut une adresse de serveur Umbra :
   - **Ton propre hébergement** → voir [INSTALL-EN-LIGNE.md](INSTALL-EN-LIGNE.md),
     par exemple `umbra-ia-xxxx.onrender.com`
   - **Ton PC sur le même Wi-Fi** → l'IP de la machine, par exemple
     `192.168.1.20:4173` (lance Umbra sur le PC avec `HOST=0.0.0.0 npm start`)
3. Saisis l'adresse, touche **Tester** (Umbra vérifie que le serveur répond),
   puis **Se connecter**.
4. Si ton serveur est protégé par mot de passe, la page de connexion s'affiche :
   entre `UMBRA_PASSWORD` et valide.
5. C'est bon : l'app se souvient de l'adresse et te connecte directement
   les fois suivantes.

> 📡 **Pas de serveur ?** L'APK est une coquille : elle charge l'interface
> depuis ton serveur Umbra. Ça garantit que tes notes, ta mémoire et tes clés
> API restent **chez toi**, jamais dans une app tierce. Il faut donc un serveur
> accessible (ton PC sur le Wi-Fi, un VPS, ou Render — voir le guide en ligne).

---

## 5. Ce que l'APK apporte de plus que le navigateur

| Fonction | Navigateur | APK |
|---|---|---|
| Icône sur l'écran d'accueil | ✅ (PWA) | ✅ |
| Plein écran, sans barre d'adresse | partiel | ✅ |
| **Dictée vocale native** (moteur Android, hors ligne possible) | ❌ (Web Speech pas dispo sur tous les appareils) | ✅ |
| Barre de statut assortie au thème sombre | ❌ | ✅ |
| Démarrage instantané, sans ouvrir Chrome | ❌ | ✅ |
| Mises à jour automatiques | ✅ | via APK ou fichier |

La dictée utilise le plugin `@capacitor-community/speech-recognition` :
quand tu touches le micro, Android demande l'autorisation **une fois**
(`RECORD_AUDIO`), puis transcrit en français (`fr-FR`) avec résultats partiels
affichés au fil de l'eau. Touche à nouveau pour arrêter et envoyer.

Si aucun moteur de reconnaissance vocale n'est installé (certains appareils
très épurés), l'app retombe proprement sur la saisie clavier.

---

## 6. Reconstruire l'APK soi-même

Utile après une modification du dossier `web/`.

### Prérequis

```bash
# Java 21 (obligatoire pour Gradle 8.11 / AGP 8.7)
sudo apt install openjdk-21-jdk-headless

# SDK Android (ligne de commande)
mkdir -p ~/android-sdk/cmdline-tools && cd ~/android-sdk/cmdline-tools
unzip commandlinetools-linux-11076708_latest.zip
mv cmdline-tools latest 2>/dev/null || true

export ANDROID_HOME=~/android-sdk
~/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses
~/android-sdk/cmdline-tools/latest/bin/sdkmanager \
  "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

### Compilation

```bash
cd umbra-ia/mobile
npm install                 # Capacitor + plugins (une seule fois)
npm run sync:web            # copie web/ → mobile/www/
npx cap sync android        # met à jour le projet natif

cd android
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=~/android-sdk

./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk
./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

Sur une machine modeste (2 Go de RAM), ajoute `--no-daemon` et évite le lint :

```bash
./gradlew assembleRelease --no-daemon -x lintVitalAnalyzeRelease -x lintVitalRelease
```

Le script `mobile/scripts/sync-web.mjs` copie `web/` vers `mobile/www/` en
ignorant le service worker (inutile dans une coquille native).

> ⚠️ **Règle d'or** : on modifie toujours `web/`, **jamais** `mobile/www/`
> (c'est une copie générée, écrasée à chaque `npm run sync:web`).

---

## 7. Signature : garder la clé, c'est garder les mises à jour

Le keystore se trouve dans `mobile/keystore/umbra-release.jks`
(mots de passe dans `mobile/keystore.properties`).

```
Alias       : umbra
Mot de passe: umbra2026
Validité    : 32 ans
```

> 🔒 **Sauvegarde ce fichier et ses mots de passe hors du projet**
> (gestionnaire de mots de passe, clé USB). Perdre le keystore = impossible de
> publier une mise à jour par-dessus l'app installée : il faudra désinstaller
> l'ancienne version. Et si le keystore fuit, quelqu'un peut signer une fausse
> mise à jour à ton nom.

Pour personnaliser avant diffusion :

```bash
cd mobile/keystore
keytool -genkeypair -v -keystore umbra-release.jks -alias umbra \
  -keyalg RSA -keysize 2048 -validity 12000 \
  -dname "CN=Ton Nom, O=Umbra, L=Cotonou, C=BJ"
```

Variables d'environnement équivalentes (utiles en CI) :
`UMBRA_STORE_PASSWORD`, `UMBRA_KEY_ALIAS`, `UMBRA_KEY_PASSWORD`.

---

## 8. Détails techniques

| Élément | Valeur |
|---|---|
| Identifiant | `app.umbra.ia` |
| Version | 2.0.0 (versionCode 2) |
| Android minimum | 6.0 (API 23) |
| Cible | Android 15 (API 35) |
| Poids | 3,9 Mo |
| Permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` |
| Techno | Capacitor 7.6 + WebView système |
| Icône / splash | générées dans `web/icons/` puis déclinées en 5 densités |

Permissions — Umbra ne demande **aucun** accès aux contacts, à la position,
aux photos ou au stockage. Seul le micro, et seulement quand tu appuies sur
le bouton de dictée.

---

## 9. Dépannage

| Symptôme | Cause | Solution |
|---|---|---|
| « Application non installée » | Ancienne version du même identifiant | Désinstaller l'ancienne, puis installer |
| « Fichier endommagé » | Téléchargement incomplet | Retélécharger, vérifier la taille (3,9 Mo) |
| Écran de connexion en boucle | Adresse serveur erronée | Réglages → Serveur Umbra → corriger |
| « Impossible de joindre le serveur » | PC éteint, IP changée, mauvais Wi-Fi | Vérifier `curl http://IP:4173/api/health` depuis le PC |
| Le micro ne fait rien | Permission refusée | Paramètres Android → Applications → Umbra IA → Autorisations → Micro |
| L'app reste blanche | Serveur lent à répondre (Render endormi) | Attendre 30 s et relancer |
| Texte trop petit | Zoom WebView | Pincer pour zoomer, ou passer en mode paysage |

---

## 10. Et l'iPhone ?

Capacitor compile aussi pour iOS, mais il faut **un Mac avec Xcode** et un
compte Apple Developer (99 $/an) pour installer sur un iPhone autre que le tien.
En attendant, ouvre Umbra dans Safari → **Partager** → **Sur l'écran
d'accueil** : tu obtiens une PWA qui ressemble beaucoup à l'APK.

Voir [INSTALL-MOBILE.md](INSTALL-MOBILE.md) pour la version PWA.
