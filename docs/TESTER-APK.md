# ✅ Tester Umbra sur ton téléphone — pas à pas

> Tu as l'APK, la clé Gemini est branchée. Il ne manque qu'une chose :
> **une adresse que ton téléphone peut joindre.**
> La clé API vit sur le serveur, pas dans l'APK. L'APK est la fenêtre ; le
> serveur est la maison.

Deux chemins. Choisis selon ce que tu as sous la main.

| | Chemin A — ton PC | Chemin B — en ligne |
|---|---|---|
| Temps | 3 minutes | 15 minutes |
| Coût | gratuit | gratuit (ou 7 $/mois) |
| Le PC doit rester allumé | oui | non |
| Marche en 4G, hors de chez toi | non | oui |

---

## 🅰️ Chemin A — Ton ordinateur + Wi-Fi (le plus rapide)

### 1. Sur l'ordinateur

```bash
cd umbra-ia
npm start
```

Tu dois voir :

```
🌙  Umbra IA 2.0
Interface   http://localhost:4173
Réseau      http://192.168.1.20:4173   ← note cette adresse
Cerveau     ✅ gemini-3.5-flash
Outils      11 disponibles
```

Si `Cerveau` affiche autre chose que ✅, c'est que le fichier `.env` n'est pas lu :
vérifie qu'il est bien à côté de `package.json`.

### 2. Vérifier depuis le téléphone (avant d'installer)

Ouvre Chrome sur le téléphone et tape l'adresse « Réseau » :
`http://192.168.1.20:4173`

- **Ça s'ouvre** → parfait, l'APK fonctionnera.
- **Ça tourne dans le vide** → problème de réseau, voir § « Le téléphone ne voit pas le PC ».

### 3. Installer l'APK

Copie `apk/Umbra-IA-2.0.0.apk` sur le téléphone (câble USB, Drive, WhatsApp à
toi-même) ou, si `adb` est installé :

```bash
adb install -r apk/Umbra-IA-2.0.0.apk
```

Ouvre le fichier → Android demande « Autoriser depuis cette source » → **Paramètres**
→ activer → revenir → **Installer**.

### 4. Au premier lancement

Un écran « Umbra IA » s'affiche avec deux champs :

| Champ | Quoi mettre |
|---|---|
| Adresse | `192.168.1.20:4173` |
| Mot de passe | *(vide — ton serveur local n'en a pas)* |

Touche **Se connecter**. Ça bascule sur l'interface.

> **Pas besoin de taper `http://`** : une adresse IP est reconnue comme locale
> et préfixée automatiquement. Un nom de domaine, lui, passe en `https://`.

### 5. Tester les trois choses qui comptent

1. **Le cerveau** — écris « Combien font 17 × 23 ? » → *391*, et une carte
   **Calculatrice** apparaît sous la réponse. C'est Gemini qui a décidé d'appeler
   l'outil : si ça marche, toute la chaîne fonctionne.
2. **La dictée** — touche le micro 🎙️, autorise l'accès, dis « quelle heure
   est-il ». Le texte doit apparaître **pendant** que tu parles (résultats
   partiels), puis s'envoyer.
3. **La mémoire** — dis « retiens que je préfère les réponses courtes ». Ferme et
   rouvre l'app, demande « qu'est-ce que tu sais de moi ? ».

---

## 🅱️ Chemin B — En ligne (ton téléphone marche partout)

C'est la voie si tu n'as pas de PC à laisser allumé, ou si tu veux Umbra en 4G.
Compte 15 minutes, c'est gratuit.

### 1. Générer le mot de passe

```bash
./scripts/generate-password.sh
```

Note les deux valeurs affichées (`UMBRA_PASSWORD` et `UMBRA_SESSION_SECRET`).

### 2. Mettre le projet sur GitHub

```bash
cd umbra-ia
git init && git add . && git commit -m "Umbra 2.0"
# crée un dépôt privé sur github.com, puis :
git remote add origin git@github.com:TON-COMPTE/umbra-ia.git
git push -u origin main
```

> Le `.env` n'est **pas** envoyé : `.gitignore` le protège. Ta clé Gemini ne
> part jamais sur GitHub — tu la ressaisiras chez Render à l'étape 4.

### 3. Créer le service sur Render

1. <https://dashboard.render.com> → **New** → **Blueprint**
2. Choisis ton dépôt : Render lit `deploy/render.yaml` tout seul
3. Il demande deux valeurs — c'est normal, elles ne sont pas dans le code :
   - `UMBRA_PASSWORD` → colle le mot de passe généré
   - `LLM_API_KEY` → colle ta clé Gemini (`AQ.Ab8…`)
4. **Apply**. Premier build : 3 à 5 minutes.
5. Tu obtiens une adresse : `https://umbra-ia-xxxx.onrender.com`

### 4. Vérifier depuis un navigateur

Ouvre l'adresse : tu dois tomber sur une **page de connexion** (pas sur Umbra
directement). Entre ton mot de passe, l'app s'ouvre. C'est bon.

### 5. Configurer l'APK

Dans l'app : adresse = `umbra-ia-xxxx.onrender.com`, mot de passe = celui de
l'étape 1. **Se connecter**.

> ⚠️ Offre gratuite Render : le service s'endort après 15 min d'inactivité.
> Le premier réveil prend ~30 secondes. L'écran de connexion peut afficher
> « Impossible de joindre » : attends une minute et réessaie.

---

## 🔧 Le téléphone ne voit pas le PC ?

Trois causes, dans l'ordre de fréquence.

**1. Ce n'est pas le même Wi-Fi.** Le téléphone est en 4G, ou sur le Wi-Fi
« invités » qui isole les appareils. Vérifie que les deux sont sur le même réseau.

**2. Le pare-feu du PC bloque.** Sur Windows, au premier lancement, une fenêtre
demande « Autoriser Node.js » → coche **Réseaux privés**. Si tu l'as refusée :

```
Panneau de configuration → Système et sécurité → Pare-feu Windows Defender
→ Autoriser une application → Node.js → cocher « Privé »
```

Sur Linux (ufw) : `sudo ufw allow 4173/tcp`. Sur macOS : Réglages → Réseau →
Pare-feu → Options → autoriser Node.

**3. L'IP a changé.** Une adresse `192.168…` est souvent dynamique. Relis la
ligne « Réseau » du terminal. Si ça change tout le temps, réserve l'IP dans
l'interface de ta box.

Test rapide : depuis le téléphone, ouvre `http://IP:4173/api/health` dans Chrome.
Tu dois voir du JSON (`{"ok":true,…}`). Si tu vois ça, l'APK fonctionnera.

---

## 🐛 Si quelque chose cloche dans l'APK

| Ce que tu vois | Cause | Solution |
|---|---|---|
| « Impossible de joindre le serveur » | adresse fausse, ou PC éteint | Réglages → Serveur Umbra → corriger |
| « Mot de passe incorrect » | tu tapes le mot de passe du serveur **local** (vide) | laisse vide en local, remplis en ligne |
| « Session expirée » au bout d'un mois | jeton de 30 jours | ressaisis le mot de passe sur l'écran de connexion |
| Badge **DÉMO** au lieu d'**EN LIGNE** | pas de clé côté serveur | vérifie `LLM_API_KEY` dans `.env` / chez Render |
| Le micro ne réagit pas | permission refusée | Paramètres Android → Applications → Umbra IA → Autorisations → Micro |
| L'app se ferme au démarrage | ancienne version installée | désinstaller, réinstaller l'APK |
| Réponse mais pas d'outil | le modèle n'a pas jugé utile d'appeler | normal ; demande explicitement « utilise la calculatrice » |

**Astuce** : pour changer d'adresse serveur sans réinstaller, ouvre **☰ Réglages
→ Serveur Umbra**. Il y a aussi une case « Clé API » : elle est **optionnelle**
quand le serveur en a déjà une — la laisser vide évite d'exposer la clé sur le
téléphone.

---

## 🧪 Ce qui a déjà été vérifié (pour ta tranquillité)

Le parcours complet de l'APK a été simulé dans un navigateur avec la coquille
native (`window.Capacitor`), contre un serveur protégé par mot de passe :

```
écran de connexion affiché ......... ✔
mauvais mot de passe ............... refusé (« Mot de passe incorrect. »)
bon mot de passe ................... app ouverte, badge EN LIGNE
« Combien font 6*7 ? » ............. 42 + carte Calculatrice TERMINÉ
jeton de session stocké ............ ✔
erreurs JavaScript ................. 0
```

Et côté serveur (`npm test`) : **29 tests, 0 échec**, dont 14 sur
l'authentification (cookie, jeton Bearer, CORS, anti brute-force).

---

## Ce que tu as maintenant

- Une **vraie app Android** signée, à ton nom.
- Un **cerveau** : Gemini 3.5 Flash, clé branchée sur le serveur.
- **11 outils** qu'elle appelle réellement, vérifiés en direct.
- **Une serrure** : mot de passe, jeton, cookie, anti brute-force.

Il ne reste qu'à lui parler.
