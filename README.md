# 🌙 Umbra IA 2.0 — ton assistant qui agit

> « Je parle, je cherche, je calcule, je pilote ton navigateur, j'écris des notes et j'exécute du Python. Je fais tout — sauf laver tes assiettes. »

Umbra IA est passée du stade de *chat* à celui d'**assistant personnel installable** :
ordinateur, téléphone, et une voix temps réel — en suivant l'architecture du guide
« Ton propre Jarvis » (LiveKit + Gemini Live + outils Python).

| | |
|---|---|
| **Version** | 2.0.0 |
| **Type** | PWA + application desktop (Electron) + **APK Android** + agent vocal (LiveKit) + version en ligne protégée par mot de passe |
| **Cerveau** | Gemini (gratuit) ou OpenAI / OpenRouter / Groq / Ollama — au choix |
| **Données** | 100 % locales (navigateur + fichiers sur ta machine) — ou ton propre serveur |
| **Tests** | 29 tests automatisés (`npm test`) — tous verts |

---

## 1. Démarrage en 60 secondes

```bash
cd umbra-ia
npm start
```

Ouvre **http://localhost:4173**. C'est tout : l'app démarre même sans clé API
(mode démo : Umbra répond par règles et **exécute réellement** ses outils).

**Pour la vraie intelligence** : icône ⚙️ **Réglages** → colle une clé
[Gemini gratuite](https://aistudio.google.com/apikey) → « Tester la connexion ».
La clé reste dans ton navigateur, elle n'est jamais stockée sur un serveur.

---

## 2. Installer Umbra (desktop & mobile)

### Sur ordinateur (Windows / macOS / Linux)
1. `npm start`
2. Dans Chrome ou Edge : icône **⊕ Installer** dans la barre d'adresse.
3. Umbra s'ouvre comme un logiciel : icône dans le dock, plein écran, hors-ligne.

### Vraie application de bureau (fenêtre native, sans navigateur)
```bash
npm install          # installe Electron
npm run desktop      # lance la fenêtre Umbra
npm run build:desktop  # produit un installeur (.exe, .dmg, .AppImage)
```
> Le serveur démarre **dans** l'application : un seul clic, rien d'autre à lancer.

### Sur téléphone
1. Démarre Umbra sur l'ordinateur.
2. Trouve l'IP locale de l'ordinateur (`ipconfig` / `ifconfig`) — ex. `192.168.1.20`.
3. Sur le téléphone, ouvre `http://192.168.1.20:4173` (même Wi-Fi).
4. **Android** : menu ⋮ → « Installer l'application ».
   **iPhone** : Partager → « Sur l'écran d'accueil ».

Tu obtiens une icône Umbra, en plein écran, avec micro et dictée.
Détails et dépannage : [`docs/INSTALL-MOBILE.md`](docs/INSTALL-MOBILE.md).

### Vraie application Android (fichier APK)

Un APK signé est fourni : **`apk/Umbra-IA-2.0.0.apk`** (3,9 Mo).

1. Copie le fichier sur le téléphone (câble, Drive, WhatsApp…), ou installe-le
   directement : `adb install -r apk/Umbra-IA-2.0.0.apk`.
2. Ouvre-le, autorise « installer depuis cette source » quand Android le demande.
3. Au premier lancement, saisis l'adresse de ton serveur Umbra
   (`192.168.1.20:4173` en local, ou ton URL en ligne) puis le mot de passe.

L'APK apporte en plus : **dictée vocale native Android**, plein écran réel,
barre de statut assortie, démarrage sans Chrome.
Procédure complète, signature et recompilation : [`docs/INSTALL-APK.md`](docs/INSTALL-APK.md).
Tester de bout en bout, pas à pas : [`docs/TESTER-APK.md`](docs/TESTER-APK.md).

### En ligne, accessible partout (protégée par mot de passe)

```bash
./scripts/generate-password.sh                 # mot de passe + secret de session
cp .env.deploy.example .env.deploy             # puis remplir les 2 valeurs
docker compose --env-file .env.deploy up -d --build
```

Umbra s'ouvre alors sur une page de connexion. Render, Railway, Fly.io et VPS :
recettes prêtes dans [`deploy/`](deploy/) — guide complet :
[`docs/INSTALL-EN-LIGNE.md`](docs/INSTALL-EN-LIGNE.md).

---

## 3. Les trois modes — « fais tout à ma place »

| Mode | Ce qu'Umbra fait | Quand l'utiliser |
|---|---|---|
| **Discussion** | Répond seulement. Aucun outil, aucune action. | Réfléchir, rédiger, expliquer |
| **Assisté** *(défaut)* | Utilise les outils, mais **demande confirmation** avant chaque action risquée. | Usage quotidien |
| **Autonome** | **Agit seul** : enchaîne les outils et rend compte à la fin. | « Fais-le pour moi, maintenant » |

En mode **Autonome**, dis simplement : *« Ouvre LeBonCoin, cherche un vélo à
Cotonou sous 50 000 F et note les trois meilleures annonces dans une note. »*
Umbra ouvre le navigateur, clique, lit, écrit la note — puis te raconte.

> ⚠️ Garde-fous : aucune opération bancaire, aucun paiement ; les suppressions
> demandent toujours confirmation, même en Autonome ; le mode Discussion coupe
> totalement les outils.

---

## 4. Les 11 outils (ses « mains »)

| Outil | Ce qu'il fait vraiment |
|---|---|
| 🔎 `web_search` | Recherche DuckDuckGo en direct (météo, actualité, prix…) |
| 📄 `fetch_page` | Ouvre une URL et lit le texte de la page |
| 🧮 `calculator` | Calcul exact (parseur maison, aucun `eval`) |
| 🕒 `get_current_datetime` | Date, heure, jour, fuseau de l'utilisateur |
| 🧠 `remember` / 🧽 `forget` | Mémoire persistante, modifiable et effaçable |
| 📝 `notes` | Carnet local en Markdown : lister / lire / écrire / compléter / supprimer |
| 🐍 `run_python` | Exécute un script Python sur ta machine (12 s max) |
| 🌐 `browser_control` | **Pilote un vrai Chrome** : ouvrir, lire, cliquer, saisir, reculer, capture |
| ↗️ `open_url` | Ouvre un lien dans ton navigateur |
| ⌨️ `system_command` | Commande shell — **désactivée par défaut**, allowlist explicite |

Chaque appel est affiché dans une carte dépliable (paramètres + résultat +
capture d'écran quand il y en a une) : tu vois exactement ce qu'Umbra a fait.

---

## 5. La voix (le « Jarvis » du guide)

Deux niveaux, tous deux inclus :

**a) Voix intégrée (aucune installation)** — bouton 🔊 (lecture des réponses) et
🎙️ (dictée) dans l'interface. Utilise la synthèse et la reconnaissance vocale du
navigateur. Marche partout, même sur téléphone.

**b) Agent vocal temps réel** — dossier `livekit/` : LiveKit Agents + **Gemini
Live**, avec caméra et partage d'écran. Conversation naturelle, interruption
possible, mêmes 10 outils que le chat (via `POST /api/tool`).
Voir [`livekit/README.md`](livekit/README.md) et [`docs/INSTALL-VOIX.md`](docs/INSTALL-VOIX.md).

```bash
cd livekit
cp .env.example .env.local   # clés LiveKit + Google
uv sync
lk agent dev
```

---

## 6. Ce qui a changé depuis la v1 (plan d'amélioration appliqué)

| # | Amélioration | État |
|---|---|---|
| 1 | **Crédits IA** → Umbra ne dépend plus de la passerelle Lovable : ta clé, ton quota, ton choix de modèle | ✅ |
| 2 | **Installable desktop + mobile** (PWA + Electron + icônes + hors-ligne) | ✅ |
| 3 | **Agir à la place de l'utilisateur** : modes Discussion / Assisté / Autonome + approbations | ✅ |
| 4 | **Mains réelles** : navigateur piloté, Python, notes, recherche, pages | ✅ |
| 5 | **Renommage, recherche et export** des conversations (fini les titres figés à 42 caractères) | ✅ |
| 6 | **Interface 100 % française**, y compris erreurs et états vides | ✅ |
| 7 | **Mémoire complète** : ajout, édition, suppression, oubli par Umbra | ✅ |
| 8 | **Réglages** : fournisseur, modèle, liste des modèles, test de connexion, vitesse de voix, prénom | ✅ |
| 9 | **Confidentialité** : page dédiée, export/import, effacement total, clé jamais écrite côté serveur | ✅ |
| 10 | **Zéro dépendance serveur** (Node 20 pur) + 15 tests automatisés | ✅ |
| 11 | **Voix temps réel LiveKit + Gemini Live** (guide JARVIS) | ✅ |
| 12 | Sous-domaine/URL propre | ⏳ à faire côté hébergement (voir §8) |

---

## 7. Structure du projet

```
umbra-ia/
├── server/            # API (Node pur, aucune dépendance)
│   ├── index.js       #   serveur HTTP, SSE, approbations
│   ├── llm.js         #   moteur (Gemini/OpenAI/compatible) + mode démo
│   ├── tools.js       #   les 11 outils
│   └── prompt.js      #   personnalité + règles de sécurité
├── web/               # application installable (PWA)
│   ├── index.html  styles.css  app.js
│   ├── manifest.webmanifest  sw.js  icons/  fonts/
├── desktop/           # Electron (fenêtre native, installeurs)
├── livekit/           # agent vocal temps réel (Python)
│   ├── src/agent.py  src/tools.py  src/prompt.py
├── data/              # notes/, screenshots/, python/ (créés à l'usage)
├── mobile/            # projet Capacitor → APK Android
│   ├── android/       #   projet natif (Gradle, manifeste, ressources)
│   ├── keystore/      #   clé de signature (à sauvegarder !)
│   └── scripts/       #   copie du web + génération icônes/splash
├── apk/               # Umbra-IA-2.0.0.apk (prêt à installer)
├── deploy/            # render.yaml, fly.toml, recettes d'hébergement
├── Dockerfile         # image de production (Node 20, sans dépendance)
├── docker-compose.yml # déploiement en une commande
├── scripts/           # generate-password.sh, make-icons.py…
├── tests/             # 29 tests (node --test)
└── docs/              # guides d'installation et plan détaillé
```

---

## 8. Aller plus loin

- **Héberger Umbra en ligne** (accès partout, sans PC allumé) :
  [`docs/INSTALL-EN-LIGNE.md`](docs/INSTALL-EN-LIGNE.md). Dockerfile, mot de
  passe obligatoire, quatre plateformes au choix, profils d'ouverture des outils.
- **Installer l'APK sur Android** : [`docs/INSTALL-APK.md`](docs/INSTALL-APK.md).
- **Revenir dans Lovable** : pousse ce dossier sur GitHub puis « Import from
  GitHub » dans Lovable ; l'URL pourra devenir `umbra-ia.lovable.app`.
- **Ajouter un outil** : une fonction dans `server/tools.js` (nom + description
  en français) → il apparaît dans le prompt, dans la liste `/api/tools` et dans
  l'agent vocal automatiquement.

---

## 9. Sécurité — à lire une fois

- Ne commite jamais `.env` (fichier déjà protégé par `.gitignore`).
- `system_command` est **désactivé** : pour l'activer, `UMBRA_ALLOW_SHELL=1` +
  `UMBRA_SHELL_ALLOWLIST=ls,cat,date`.
- La clé API saisie dans Réglages vit dans le `localStorage` de ton navigateur.
- Le navigateur piloté peut cliquer sur des liens : ne navigue pas avec Umbra
  sur des sites bancaires ou de paiement.
- Un modèle peut se tromper : vérifie ce qui compte.
- **En ligne**, `UMBRA_PASSWORD` est obligatoire : sans lui, pas de démarrage.
  Les cookies sont signés (HMAC-SHA256), `httpOnly`, et 6 essais ratés bloquent
  l'IP pendant 10 minutes (`npm test` le vérifie).
- En mode public, `run_python`, `browser_control` et `system_command` sont
  coupés **et retirés du prompt système** : Umbra ne promet pas une action
  qu'elle ne peut pas faire.

---

*Umbra IA 2.0 — construit à partir de l'étude de la v1 (projet Lovable) et du
guide « Ton propre Jarvis ». Tout est local, tout est à toi.*
