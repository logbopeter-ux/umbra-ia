# Installer Umbra IA sur ordinateur

Trois niveaux, du plus simple au plus « vrai logiciel ».

---

## 1. PWA (30 secondes, recommandé pour commencer)

```bash
cd umbra-ia
npm start
```

Puis, dans **Chrome** ou **Edge** :

- icône **⊕ Installer** à droite de la barre d'adresse → **Installer** ;
- ou menu ⋮ → **Installer Umbra IA…**

Résultat : une icône Umbra dans le menu Démarrer / le Launchpad, une fenêtre
sans barre d'adresse, un fonctionnement hors-ligne (l'interface est mise en cache
par le service worker).

Sous **Firefox**, l'installation n'est pas proposée : utilise le raccourci vers
`http://localhost:4173`.

---

## 2. Application de bureau native (Electron)

Fenêtre native, menu français, raccourcis `Ctrl/Cmd + K` (nouvelle conversation),
`Ctrl/Cmd + ,` (réglages), liens externes ouverts dans le vrai navigateur.
Le serveur démarre **à l'intérieur** de l'application : aucune console à garder
ouverte.

```bash
npm install            # ~250 Mo une seule fois (Electron)
npm run desktop        # lance l'application
```

### Fabriquer un installeur

```bash
npm run build:desktop
```

| Système | Fichier produit (dossier `release/`) |
|---|---|
| Windows | `Umbra IA Setup 2.0.0.exe` (NSIS) |
| macOS | `Umbra IA-2.0.0.dmg` |
| Linux | `Umbra IA-2.0.0.AppImage`, `.deb` |

> ⚠️ Un installeur Windows doit être **fabriqué sur Windows** (idem macOS), et un
> installeur macOS n'est pas signé sans compte Apple Developer : au premier
> lancement, clic droit → **Ouvrir**.

---

## 3. Lancer en service permanent (optionnel)

### Linux — systemd

```ini
# ~/.config/systemd/user/umbra.service
[Unit]
Description=Umbra IA
After=network.target

[Service]
WorkingDirectory=%h/umbra-ia
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now umbra
```

### macOS — LaunchAgent

Crée `~/Library/LaunchAgents/app.umbra.ia.plist` avec `ProgramArguments`
`["/usr/local/bin/node", "/Users/<toi>/umbra-ia/server/index.js"]`, puis :

```bash
launchctl load ~/Library/LaunchAgents/app.umbra.ia.plist
```

### Windows — démarrage automatique

`Win + R` → `shell:startup` → glisse un raccourci vers `npm start`
(ou vers `Umbra IA.exe` si tu utilises l'app Electron).

---

## 4. Configuration (`.env`)

Copie `.env.example` en `.env` :

| Variable | Rôle | Défaut |
|---|---|---|
| `LLM_API_KEY` | clé du fournisseur (sinon mode démo) | — |
| `LLM_BASE_URL` | point d'accès compatible OpenAI | Gemini |
| `LLM_MODEL` | modèle utilisé | `gemini-3.5-flash` |
| `PORT` | port d'écoute | `4173` |
| `HOST` | interface réseau (`0.0.0.0` = accessible au téléphone) | `0.0.0.0` |
| `UMBRA_USER_NAME` | comment Umbra t'appelle | `Monsieur` |
| `UMBRA_TIMEZONE` | fuseau horaire | `Africa/Porto-Novo` |
| `UMBRA_ALLOW_SHELL` | autorise `system_command` | `0` |
| `UMBRA_SHELL_ALLOWLIST` | commandes autorisées | `ls,cat,echo,…` |

> Les réglages saisis dans l'interface (clé, modèle, prénom) **priment** sur le
> `.env` : ils sont envoyés à chaque requête, jamais écrits sur le disque du
> serveur.

---

## 5. Dépannage express

| Symptôme | Solution |
|---|---|
| « EADDRINUSE » | Un Umbra tourne déjà : change `PORT=4174` ou ferme l'autre |
| Le chip reste sur **démo** | Aucune clé : Réglages → colle la clé → « Tester la connexion » |
| « Erreur 429 » | Quota du fournisseur : attends une minute, ou change de modèle |
| « Erreur 404 » | Le nom du modèle n'existe pas : bouton **Lister** dans Réglages |
| Le navigateur piloté ne s'ouvre pas | `npm i playwright && npx playwright install chromium` |
| `run_python` échoue | Python 3 doit être dans le PATH (`python --version`) |
| Le téléphone ne voit rien | Pare-feu Windows → autoriser Node.js en réseau privé |
| L'ancienne version s'affiche | Recharge avec `Ctrl + Maj + R` (service worker) |

**Le réflexe universel** (comme dans le guide JARVIS) : copie le message d'erreur
complet dans un assistant de code avec « corrige ceci ».
