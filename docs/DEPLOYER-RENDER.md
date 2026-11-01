# 🚀 Mettre à jour GitHub puis déployer sur Render

Ce guide fait passer votre dépôt de la version précédente à **Umbra IA 2.1.1**, puis
la met en ligne sur Render en déploiement manuel. Comptez **dix minutes**, dont
trois d'attente pendant la construction.

---

## Avant de commencer : ce qui change

| Nouveau en 2.1 | Où |
|---|---|
| Pièces jointes : photos, PDF, Word, Excel, PowerPoint, EPUB, texte, code | `server/fichiers.js` *(nouveau)*, `web/`, `server/index.js` |
| Vision : les images sont réellement regardées | `server/llm.js`, `server/prompt.js` |
| Bouton « aller à la ligne » séparé de l'envoi | `web/` |
| Téléchargement de l'APK depuis le serveur (`/apk`) | `server/index.js` |
| Ollama en dernier recours, chaîne 100 % automatique | `server/llm.js`, `server/index.js` |
| 93 tests, docs `FICHIERS.md` et `MAJ-APK.md` | `tests/`, `docs/` |

**Rien de nouveau à installer.** Le serveur reste en Node pur, sans une seule
dépendance npm. C'est ce qui rend le déploiement Render si simple : pas de
`npm install` à craindre, pas de version de paquet à surveiller.

---

## Étape 1 — Récupérer le nouveau code

### ⚡ Le chemin court : le script

Le dossier livré contient **`maj-depot-github.sh`**, à sa racine. Il fait tout :
il récupère ton dépôt, remplace son contenu, vérifie qu'aucune clé n'a fui,
lance les 93 tests, puis pousse le commit.

```bash
./maj-depot-github.sh https://github.com/TON-COMPTE/umbra-ia.git
```

En cas de refus des tests ou d'une clé détectée, **il s'arrête sans rien
pousser**. Ton historique et tes branches sont conservés : il ajoute un commit,
il n'écrase pas le dépôt.

Si `git` refuse l'authentification, utilise l'adresse SSH (`git@github.com:…`)
ou un jeton d'accès personnel à la place du mot de passe.

### Le chemin manuel

Les mêmes étapes, à la main, si tu préfères voir ce qui se passe.

Le code complet est dans le fichier **`UMBRA-REPO-BASE64.txt`** (91 fichiers).
C'est un texte : il se copie, se colle et se vérifie, contrairement à une archive.

#### Sur votre ordinateur, à côté de votre dépôt cloné

```bash
# 1. reconstituer le dossier
awk '/^-----BEGIN UMBRA ARCHIVE-----$/{f=1;next} /^-----END UMBRA ARCHIVE-----$/{f=0} f' \
  UMBRA-REPO-BASE64.txt | base64 -d | tar xz -C umbra-ia-nouveau

# 2. vérifier que c'est bien la 2.1
grep '"version"' umbra-ia-nouveau/package.json
# → "version": "2.1.1"
ls umbra-ia-nouveau/server/fichiers.js
```

#### Puis remplacer le contenu de votre dépôt

```bash
cd umbra-ia              # votre dépôt cloné
rm -rf server web tests docs
cp -r ../umbra-ia-nouveau/* .
cp ../umbra-ia-nouveau/.dockerignore ../umbra-ia-nouveau/.gitignore . 2>/dev/null
```

> **Ne supprimez jamais `.git/`.** C'est lui qui relie le dossier à GitHub.
> Le `rm -rf` ci-dessus ne touche volontairement ni `.git`, ni `.env`, ni votre
> `data/` local.

#### Vérifier avant de pousser

```bash
git status --short          # liste des fichiers modifiés et ajoutés
npm test                    # doit afficher : # pass 93
```

Si les tests passent chez vous, ils passeront sur Render.

> **Sans terminal ?** GitHub accepte le glisser-déposer : sur la page du dépôt,
> bouton **Add file → Upload files**, puis glissez le contenu du dossier
> (pas le dossier lui-même). Les fichiers supprimés — comme l'ancien
> `deploy/render.yaml` — doivent être retirés à la main, sinon les deux
> configurations cohabitent à nouveau. GitHub Desktop fait la même chose avec
> une vraie interface, sans ligne de commande.

---

## Étape 2 — Pousser sur GitHub

```bash
git add -A
git commit -m "Umbra IA 2.1.1 — correctif du cache, vision, bouton retour à la ligne"
git push origin main
```

*(remplacez `main` par `master` si c'est le nom de votre branche)*

Sur GitHub, vérifiez trois choses dans l'onglet **Code** :

| À vérifier | Pourquoi c'est important |
|---|---|
| `server/fichiers.js` est présent | sans lui, aucun import ne se résout, le serveur ne démarre pas |
| `render.yaml` est à la **racine** | Render ne le lit pas ailleurs |
| `Dockerfile` est à la racine | même raison |

Un fichier oublié se voit immédiatement : le déploiement Render échouera au
démarrage avec `Cannot find module './fichiers.js'`.

---

## Étape 3 — Déployer sur Render

### Si le service existe déjà

1. Dashboard Render → votre service **umbra-ia**.
2. Onglet **Environment** : vérifiez que `UMBRA_PASSWORD` est bien renseigné
   (sans lui, l'instance serait ouverte à tous — le serveur vous le dira
   désormais au démarrage).
3. Bouton **Manual Deploy** → **Deploy latest commit**.
4. Suivez les journaux en direct : `Docker build`, puis `Starting service`.

La première construction prend **2 à 4 minutes** (téléchargement de l'image Node,
copie du code). Les suivantes, une minute environ : Render met les couches en
cache.

### Si vous créez le service pour la première fois

1. Poussez le dépôt sur GitHub (privé de préférence).
2. Dashboard Render → **New** → **Blueprint**.
3. Choisissez votre dépôt : Render lit `render.yaml` et propose le service.
4. Il vous demande les valeurs marquées `sync: false` :
   - **`UMBRA_PASSWORD`** — obligatoire, c'est la serrure de votre Umbra
   - **`LLM_API_KEY`** — votre clé Gemini (facultative : sans elle, mode démo)
   - `GROQ_API_KEY`, `ANTHROPIC_API_KEY` — facultatives, pour les secours
   - `UMBRA_APK_URL` — inutile en temps normal, voir plus bas
5. **Apply**. Le déploiement démarre.

### Ce que Render vous donne

Une adresse du type `https://umbra-ia-xxxx.onrender.com`, en HTTPS, avec un
certificat géré automatiquement. C'est cette adresse que vous mettez dans l'APK
(Réglages → Serveur Umbra).

---

## Étape 4 — Vérifier que ça tourne

Trois contrôles, dans l'ordre.

```bash
# 1. le serveur répond et annonce la bonne version
curl -s https://umbra-ia-xxxx.onrender.com/api/health | head -c 200
# → {"ok":true,"version":"2.1.0",...}
```

```bash
# 2. la page de connexion s'affiche
curl -s -o /dev/null -w "%{http_code}\n" https://umbra-ia-xxxx.onrender.com/login
# → 200
```

3. Ouvrez l'adresse dans le navigateur : le mot de passe est demandé, puis
   l'interface apparaît avec le **trombone** à gauche du champ et le **bouton ↵**.

Puis le test qui compte : joignez un PDF, écrivez « résume ce document », envoyez.

> ⏱️ **Le premier appel est lent.** L'offre gratuite met le service en veille
> après 15 minutes sans visite. La première requête réveille la machine :
> comptez 30 à 50 secondes. Les suivantes sont immédiates.

---

## Ce qui marche, ce qui ne marche pas en ligne

| Fonction | En ligne sur Render |
|---|---|
| Conversation, mémoire, modes Discussion/Assisté/Autonome | ✅ |
| Pièces jointes : images, PDF, Word, Excel, PowerPoint, texte | ✅ |
| Vision par Gemini ou Claude | ✅ |
| Bascule automatique entre cerveaux | ✅ |
| Recherche web, lecture de page, calcul, notes | ✅ |
| Exécution de Python, pilotage du navigateur, commandes système | ❌ désactivés (sécurité) |
| Ollama | ❌ désactivé (aucun serveur local en ligne) |
| Conversations | ✅ conservées — elles vivent dans le navigateur |
| Pièces jointes et notes | ⚠️ perdues à chaque redéploiement (disque éphémère) |

### L'APK depuis Render

L'APK n'est **pas** embarqué dans l'image Docker : 3,9 Mo inutiles sur un serveur.

**Vous n'avez rien à configurer.** L'adresse `/apk` de votre serveur redirige le
téléphone vers la bonne version, après le mot de passe. Umbra déduit l'adresse
de sa propre version : la version 2.1.1 cherche le tag `v2.1.1` et le fichier
`Umbra-IA-2.1.1.apk`. À la version suivante, l'adresse change toute seule.

Il suffit donc que chaque mise à jour soit publiée sur GitHub avec :

```
tag    : v2.1.1
fichier: Umbra-IA-2.1.1.apk
```

Si le fichier d'une version n'est pas encore publié, Umbra essaie la dernière
version disponible, puis demande à GitHub la liste des fichiers joints. En
dernier recours seulement, `/apk` explique que rien n'est publié — jamais une
erreur serveur.

Pour imposer une autre adresse (Drive, Dropbox, hébergeur maison), renseignez
`UMBRA_APK_URL` : elle a toujours la priorité.

### Garder les fichiers (7 $/mois)

Sur l'offre gratuite, le disque est remis à zéro à chaque déploiement : vos notes
et vos pièces jointes disparaissent, vos conversations non (elles sont dans le
navigateur). Pour les garder, dans `render.yaml` :

```yaml
    disk:
      name: umbra-data
      mountPath: /app/data
      sizeGB: 1
```

Passez alors le plan à `starter`, commitez, redéployez.

Aucune autre manipulation : au démarrage, `docker-entrypoint.sh` s'exécute en
root quelques instants pour redonner `/app/data` à l'utilisateur applicatif
(un disque Render appartient à root), puis abandonne immédiatement ses
privilèges avec `su-exec`. Sans disque monté, ce script ne change rien.

---

## En cas d'échec du déploiement

| Message dans les journaux Render | Cause | Correction |
|---|---|---|
| `Cannot find module './fichiers.js'` | fichier non poussé sur GitHub | revérifier `git status`, repousser |
| `Cannot find file: /app/Dockerfile` | `dockerfilePath` erroné | le Dockerfile doit être à la racine du dépôt |
| `Exited with status 1` au démarrage | variable manquante ou port occupé | lire la ligne juste au-dessus : elle nomme la variable |
| `Port scan timeout` | le serveur n'écoute pas sur `$PORT` | vérifier qu'il démarre bien : `HOST=0.0.0.0` et `process.env.PORT` sont déjà gérés |
| Page blanche après connexion | `UMBRA_PUBLIC_MODE` mal orthographié | doit valoir `1` |
| `502` après 30 s | service en veille qui se réveille | attendre, recharger |
| Mot de passe refusé en boucle | cookie `Secure` bloqué | accéder en **https**, jamais en `http` |

Pour lire les journaux : Dashboard → votre service → **Logs**. Les lignes
`[umbra]` viennent de l'application, les autres de la plateforme.

---

## La routine des prochaines mises à jour

```bash
# 1. remplacer le code dans le dépôt cloné
# 2. vérifier
npm test
# 3. pousser
git add -A && git commit -m "Umbra IA x.y.z" && git push
# 4. Render → Manual Deploy → Deploy latest commit
```

`autoDeploy` est réglé sur `false` dans `render.yaml` : **rien ne part sans votre
clic**. Si vous préférez que chaque `git push` déclenche un déploiement, passez-le
à `true` — pratique, mais un commit à moitié terminé se retrouve alors en ligne.
