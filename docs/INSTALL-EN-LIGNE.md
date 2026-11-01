# 🌍 Mettre Umbra en ligne (protégée par mot de passe)

Ce guide t'explique comment rendre ton Umbra accessible depuis ton téléphone,
ta tablette ou un autre ordinateur — **sans que personne d'autre puisse entrer**.

À la fin, tu auras une adresse du genre :

```
https://umbra-mon-nom.onrender.com
```

…protégée par un mot de passe que toi seul connais.

---

## 0. Ce que la protection fait exactement

| Sans mot de passe | Avec `UMBRA_PASSWORD` |
|---|---|
| L'app s'ouvre directement | Écran de connexion `login.html` |
| N'importe qui sur le réseau entre | Cookie de session signé (HMAC-SHA256) |
| — | Cookie `httpOnly`, `SameSite=Lax`, 30 jours |
| — | Blocage après **6 essais ratés** en 10 minutes |

> **Sans `UMBRA_PASSWORD`, Umbra refuse de démarrer en mode public.**
> C'est volontaire : une Umbra ouverte sur internet, c'est ton ordinateur aux mains du premier venu.

---

## 1. Générer un mot de passe solide

```bash
./scripts/generate-password.sh
```

Exemple de sortie :

```
🔐 Mot de passe d'accès à Umbra
    sable-faucon-silex-brume-5809

🔑 Secret de session
    743406fb9f90b0da69195311893053ebf6d6eae63a4dde3f4231e804b2952698
```

Quatre mots français + quatre chiffres : facile à retaper sur un téléphone,
difficile à deviner. Tu peux aussi inventer le tien — 16 caractères minimum.

---

## 2. Choisir son hébergement

Il y a quatre chemins. Du plus simple au plus « chez soi » :

| Option | Prix | Difficulté | Convient si… |
|---|---|---|---|
| **A. Render** | gratuit (ou 7 $/mois) | ⭐ | tu veux juste une adresse qui marche |
| **B. Railway** | ~5 $/mois | ⭐⭐ | tu veux des variables d'env. simples |
| **C. VPS Docker** | 4–6 €/mois | ⭐⭐⭐ | tu veux la persistance et ton domaine |
| **D. Ton PC + tunnel** | gratuit | ⭐⭐ | tu testes, tu ne laisses pas allumé |

---

### Option A — Render (le plus rapide)

1. Mets ce dossier sur GitHub (dépôt **privé** de préférence) :
   ```bash
   cd umbra-ia
   git init && git add . && git commit -m "Umbra 2.0"
   git remote add origin git@github.com:TON-COMPTE/umbra-ia.git
   git push -u origin main
   ```
2. Va sur <https://dashboard.render.com> → **New** → **Blueprint**.
3. Choisis le dépôt. Render lit `render.yaml` (à la racine) tout seul.
4. Il demande deux valeurs :
   - `UMBRA_PASSWORD` → colle ton mot de passe
   - `LLM_API_KEY` → ta clé Gemini (ou laisse vide = mode démo)
5. **Apply**. Compte 3 à 5 minutes pour le premier build.
6. Ton adresse : `https://umbra-ia-xxxx.onrender.com`.

> ⚠️ Offre gratuite : l'app **s'endort** après 15 minutes d'inactivité.
> Le premier réveil prend ~30 secondes. Le disque n'est pas persistant
> (les notes repartent de zéro à chaque redéploiement).

---

### Option B — Railway

```bash
npm i -g @railway/cli
railway login
cd umbra-ia
railway init
railway up
```

Puis dans le tableau de bord Railway → **Variables** :

```
UMBRA_PASSWORD        = ton-mot-de-passe
UMBRA_SESSION_SECRET  = le-secret-généré
UMBRA_PUBLIC_MODE     = 1
UMBRA_TOOLS_DISABLE   = run_python,browser_control,system_command
LLM_API_KEY           = ta-clé-gemini
```

Enfin → **Settings** → **Networking** → **Generate Domain**.
Railway détecte le `Dockerfile` automatiquement.

Pour garder les données, ajoute un **Volume** monté sur `/app/data`.

---

### Option C — Ton propre serveur (VPS Docker)

Sur un serveur Debian/Ubuntu avec Docker installé :

```bash
# 1. Récupérer le projet
git clone <ton-dépôt> umbra-ia && cd umbra-ia

# 2. Préparer la configuration
cp .env.deploy.example .env.deploy
nano .env.deploy          # colle UMBRA_PASSWORD et UMBRA_SESSION_SECRET

# 3. Lancer
docker compose --env-file .env.deploy up -d --build

# 4. Vérifier
curl -s localhost:4173/api/health
docker compose logs -f umbra
```

**Le mot de passe est obligatoire** : sans lui, `docker compose` s'arrête net
avec `UMBRA_PASSWORD: Définis UMBRA_PASSWORD dans .env.deploy`.

#### Mettre un vrai nom de domaine + HTTPS (Caddy, la voie simple)

```bash
sudo apt install caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<'CFG'
umbra.mondomaine.com {
    reverse_proxy 127.0.0.1:4173
}
CFG
sudo systemctl reload caddy
```

Caddy obtient le certificat Let's Encrypt tout seul. Rien d'autre à faire.

> Sur un VPS, tu peux **garder plus d'outils** qu'ailleurs : le serveur est à toi.
> Voir la section 4 « Quel niveau d'ouverture ? ».

---

### Option D — Ton PC, juste le temps d'un test (tunnel)

Utile pour vérifier depuis ton téléphone avant de payer quoi que ce soit.

```bash
# Terminal 1
UMBRA_PASSWORD=mon-test-1234 UMBRA_PUBLIC_MODE=1 npm start

# Terminal 2 (Cloudflare, gratuit, aucun compte)
cloudflared tunnel --url http://localhost:4173
```

Cloudflare affiche une adresse `https://xxx.trycloudflare.com` valable
quelques heures. **Ferme-la quand tu as fini.**

---

## 3. Variables d'environnement — la référence

### Sécurité (les plus importantes)

| Variable | Rôle | Exemple |
|---|---|---|
| `UMBRA_PASSWORD` | **Obligatoire en ligne.** Ouvre la protection par mot de passe. | `sable-faucon-silex-brume-5809` |
| `UMBRA_SESSION_SECRET` | Signe les cookies. Changement = tout le monde déconnecté. | `openssl rand -hex 32` |
| `UMBRA_PUBLIC_MODE` | `1` = verrouille tout ce qui touche la machine. | `1` |
| `UMBRA_TOOLS_DISABLE` | Outils coupés, séparés par des virgules. | `run_python,browser_control,system_command` |
| `UMBRA_ALLOW_SHELL` | Autorise `system_command`. **Laisse `0` en ligne.** | `0` |

### Cerveau

| Variable | Rôle | Défaut |
|---|---|---|
| `LLM_API_KEY` | Clé Gemini/OpenAI/OpenRouter. Vide = mode démo. | *(vide)* |
| `LLM_BASE_URL` | Endpoint compatible OpenAI. | Gemini |
| `LLM_MODEL` | Modèle utilisé. | `gemini-3.5-flash` |

### Identité & réseau

| Variable | Rôle | Défaut |
|---|---|---|
| `UMBRA_USER_NAME` | Comment Umbra t'appelle. | `Monsieur` |
| `UMBRA_TIMEZONE` | Fuseau horaire. | `Africa/Porto-Novo` |
| `PORT` / `HOST` | Écoute du serveur. | `4173` / `0.0.0.0` |

---

## 4. Quel niveau d'ouverture ?

Trois profils prêts à l'emploi.

### 🟢 Public prudent (recommandé en ligne)

```env
UMBRA_PUBLIC_MODE=1
UMBRA_TOOLS_DISABLE=run_python,browser_control,system_command
```

Umbra sait : chercher sur le web, lire une page, calculer, donner l'heure,
prendre des notes, se souvenir. Elle ne touche **pas** au serveur.
C'est ce que font `docker-compose.yml` et `render.yaml` par défaut.

### 🟡 Public outillé (petit serveur perso, utilisateur unique)

```env
UMBRA_PUBLIC_MODE=0
UMBRA_TOOLS_DISABLE=browser_control,system_command
```

Umbra peut exécuter du Python dans le conteneur. Le conteneur limite les dégâts,
pas un utilisateur mal intentionné qui aurait le mot de passe.

### 🔴 Tout ouvert (jamais sur internet)

```env
UMBRA_ALLOW_SHELL=1
UMBRA_SHELL_ALLOWLIST=ls,cat,df,uname
```

Réservé à une utilisation locale, derrière un mot de passe et un réseau de confiance.

> **Ce que le prompt système fait automatiquement :** quand un outil est coupé,
> Umbra *le sait* — elle ne promet pas d'exécuter du Python, elle annonce que
> l'administration l'a désactivé et propose une alternative. Pas de « je ne peux
> pas » vague, pas d'hallucination d'action.

---

## 5. Vérifier que tout est bien fermé

Une fois en ligne, trois commandes suffisent :

```bash
# 1. Doit répondre 302 vers /login (pas 200)
curl -i https://ton-adresse.onrender.com/ | head -3

# 2. Doit répondre 401
curl -i https://ton-adresse.onrender.com/api/tools | head -3

# 3. Doit répondre 200 (endpoint public, pour les sondes)
curl https://ton-adresse.onrender.com/api/health
```

Puis dans un navigateur : l'écran de connexion doit s'afficher, un mauvais mot
de passe doit être refusé, et le bon doit ouvrir l'app.

La suite automatisée couvre tout ça :

```bash
npm test   # 93 tests, dont ceux de l'authentification
```

---

## 6. Connecter l'APK Android à ton Umbra en ligne

Une fois l'adresse obtenue, ouvre l'application **Umbra IA** sur Android :

1. Au premier lancement, l'écran **« Connecter Umbra »** apparaît.
2. Saisis l'adresse, par exemple `umbra-ia-xxxx.onrender.com`
   (le `https://` est ajouté automatiquement).
3. Touche **Tester**, puis **Se connecter**.
4. Umbra demande le mot de passe → tu entres celui de l'étape 1.
5. L'app est connectée, elle se souvient de l'adresse.

Tu peux changer d'adresse plus tard : **⚙️ Réglages → Serveur Umbra**.

> Sur un réseau local (ton PC), écris l'IP directement : `192.168.1.20:4173`.
> Umbra bascule automatiquement en `http://` pour les adresses locales.

---

## 7. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `UMBRA_PASSWORD: Définis…` | Variable absente | `cp .env.deploy.example .env.deploy` puis remplir |
| Page blanche après connexion | Service worker d'une ancienne version | Vider le cache / navigation privée |
| « Session expirée » en boucle | Cookie refusé (HTTPS manquant) | Servir Umbra en HTTPS, pas en `http://` sur un domaine |
| 429 « Trop de tentatives » | 6 échecs en 10 min | Attendre 10 minutes, ou redémarrer le conteneur |
| L'app Android ne joint pas le serveur | Adresse sans `https://` | Écrire `umbra-ia-xxxx.onrender.com` |
| Le réveil Render prend 30 s | Offre gratuite endormie | Passer au plan Starter, ou accepter le délai |

---

## 8. Changer ou révoquer l'accès

- **Changer le mot de passe** : modifie `UMBRA_PASSWORD` puis redéploie.
  Toutes les sessions existantes tombent (le secret dérive du mot de passe).
- **Déconnecter tous les appareils sans changer le mot de passe** :
  change `UMBRA_SESSION_SECRET` et redéploie.
- **Couper complètement** : supprime le service (Render) ou
  `docker compose down` (VPS).

---

Bon hébergement. Umbra est chez toi, et sa porte a une serrure.
