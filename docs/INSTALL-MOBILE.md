# Installer Umbra IA sur téléphone (Android & iPhone)

Umbra existe sous **deux formes** sur téléphone :

| Forme | Comment | Quand la choisir |
|---|---|---|
| **APK Android** | fichier `apk/Umbra-IA-2.0.0.apk` à installer | tu veux une vraie app, dictée native, plein écran → [`INSTALL-APK.md`](INSTALL-APK.md) |
| **PWA** | depuis le navigateur, sans magasin | iPhone, ou Android sans autoriser « sources inconnues » |

Ce guide décrit la **PWA** (la voie universelle). Pour l'APK, va directement
sur [`INSTALL-APK.md`](INSTALL-APK.md).

La PWA s'installe depuis le navigateur, sans App Store, sans compte, sans câble
USB. Elle occupe moins de 2 Mo et fonctionne hors-ligne (les outils réseau, eux,
ont besoin d'internet).

---

## A. Le point important à comprendre

L'interface Umbra est une page web **servie par l'ordinateur**. Pour l'utiliser
sur ton téléphone :

```
[ Téléphone ] ──Wi-Fi──▶ [ Ordinateur : npm start → port 4173 ] ──▶ outils, fichiers
```

- L'ordinateur doit être **allumé** et sur le **même Wi-Fi**.
- Le navigateur piloté par Umbra reste **sur l'ordinateur** (c'est lui qui clique).
- Le téléphone devient une télécommande intelligente : micro, dictée, réponses.

> Tu veux Umbra **sans ordinateur allumé** ? Guide dédié :
> [`INSTALL-EN-LIGNE.md`](INSTALL-EN-LIGNE.md) — Dockerfile + mot de passe
> obligatoire, Render / Railway / Fly.io / VPS, en 15 minutes.

---

## B. Android — installation en 4 étapes

1. Sur l'ordinateur : `cd umbra-ia && npm start`.
2. Note l'adresse « Réseau » affichée dans le terminal
   (ex. `http://192.168.1.20:4173`). Si tu ne la vois pas :
   - Windows : `ipconfig` → « Adresse IPv4 »
   - macOS / Linux : `ifconfig | grep inet`
3. Sur le téléphone (Chrome), ouvre cette adresse.
4. Menu **⋮** → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).

Umbra apparaît avec son icône de croissant, en plein écran, sans barre d'adresse.

**Si la page ne s'ouvre pas :**
- Vérifie que les deux appareils sont sur le même Wi-Fi (pas le Wi-Fi invité).
- Le pare-feu Windows peut bloquer : autorise Node.js sur les réseaux privés.
- Teste `http://<ip>:4173/api/health` dans le navigateur du téléphone : si du JSON
  s'affiche, l'interface devrait fonctionner.

---

## C. iPhone / iPad — installation en 4 étapes

1. Démarre Umbra sur l'ordinateur (comme ci-dessus).
2. Ouvre l'adresse `http://192.168.1.20:4173` **dans Safari** (obligatoire).
3. Touche le bouton **Partager** (carré avec une flèche).
4. **Sur l'écran d'accueil** → **Ajouter**.

> La dictée (`🎙️`) fonctionne dans Safari. La lecture vocale (`🔊`) aussi.

---

## D. Micro et autorisations

- **Android/Chrome** : autorise le microphone quand le navigateur le demande.
- **iPhone** : Réglages → Safari → Microphone → Demander.
- La dictée utilise la reconnaissance vocale du système ; il faut une connexion.

---

## E. Variante « app native » (facultatif, plus avancé)

Si tu veux une vraie app Android installable (APK) au lieu d'une PWA :

```bash
npm start                       # serveur Umbra sur le PC
npx @bubblewrap/cli init --manifest http://localhost:4173/manifest.webmanifest
npx @bubblewrap/cli build       # produit app-release-signed.apk
```

L'APK pointe vers l'adresse que tu indiques : utilise l'IP locale de ton PC ou
ton URL d'hébergement si tu déploies Umbra en ligne.

Pour iOS, il faut un Mac + Xcode (voir le guide JARVIS, section « Et sur iPhone ? »)
ou passer par Capacitor.

---

## F. Héberger Umbra en ligne (accès partout, sans PC)

Le serveur n'a **aucune dépendance** : n'importe quel hébergeur Node 20 convient.

```bash
# Exemple Railway
npm i -g @railway/cli
railway init && railway up
```

Points d'attention avant d'exposer Umbra sur internet :

1. **Protège l'accès** : ajoute un mot de passe (variable `UMBRA_PASSWORD` +
   middleware) ou place Umbra derrière Cloudflare Access.
2. **Désactive les outils machine** (`run_python`, `browser_control`,
   `system_command`) tant que l'accès n'est pas privé : ils exécutent du code sur
   le serveur.
3. Garde `UMBRA_ALLOW_SHELL=0`.

Détails et variables : [`INSTALL-DESKTOP.md`](INSTALL-DESKTOP.md) §5.
