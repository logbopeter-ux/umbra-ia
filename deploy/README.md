# 🚀 Dossier `deploy/` — recettes d'hébergement

Un fichier par plateforme. Toutes les recettes supposent que tu as lu
**[docs/INSTALL-EN-LIGNE.md](../docs/INSTALL-EN-LIGNE.md)** et généré un mot de
passe avec `./scripts/generate-password.sh`.

| Fichier | Plateforme | Commande / geste |
|---|---|---|
| `render.yaml` | Render.com | Blueprint : Render lit le fichier tout seul |
| `fly.toml` | Fly.io | `fly launch --copy-config` puis `fly secrets set` |

Les autres options n'ont pas besoin de fichier :

- **VPS Docker** → `docker-compose.yml` à la racine du projet
- **Railway** → détecte le `Dockerfile` ; variables dans le tableau de bord
- **Tunnel local** → `cloudflared tunnel --url http://localhost:4173`

---

## Rappel : les quatre variables qui comptent

```env
UMBRA_PASSWORD=sable-faucon-silex-brume-5809      # obligatoire
UMBRA_SESSION_SECRET=<openssl rand -hex 32>
UMBRA_PUBLIC_MODE=1
UMBRA_TOOLS_DISABLE=run_python,browser_control,system_command
```

Sans `UMBRA_PASSWORD`, le serveur **refuse de démarrer** : c'est une garde-fou,
pas un oubli.

---

## Vérification après déploiement

```bash
BASE=https://ton-adresse
curl -s -o /dev/null -w "%{http_code}\n" $BASE/            # 302
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/tools   # 401
curl -s $BASE/api/health | head -c 120                      # ok:true
```
