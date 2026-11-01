# 🚀 Dossier `deploy/` — recettes d'hébergement

Les fichiers de configuration vivent désormais **à la racine du projet**, là où
les plateformes les cherchent. Il n'y a plus qu'une seule version de chacun :
c'est ce qui évite de déployer une configuration périmée.

| Fichier (racine) | Plateforme | Geste |
|---|---|---|
| `render.yaml` | Render.com | Blueprint : Render lit le fichier tout seul |
| `fly.toml` | Fly.io | `fly launch --copy-config` puis `fly secrets set` |
| `Dockerfile` | VPS, Railway, Cloud Run | `docker build -t umbra-ia .` |
| `docker-compose.yml` | VPS Docker | `docker compose up -d` |

Marche à suivre détaillée pour une mise à jour du dépôt puis un déploiement
Render : **[docs/DEPLOYER-RENDER.md](../docs/DEPLOYER-RENDER.md)**.

Les autres options n'ont pas besoin de fichier :

- **Railway** → détecte le `Dockerfile` ; variables dans le tableau de bord
- **Tunnel local** → `cloudflared tunnel --url http://localhost:4173`

---

## Rappel : les quatre variables qui comptent

| Variable | Rôle |
|---|---|
| `UMBRA_PASSWORD` | la serrure. Sans elle, rien ne s'ouvre en public |
| `UMBRA_SESSION_SECRET` | signe les sessions ; ne pas la changer sans raison |
| `LLM_API_KEY` | le cerveau (Gemini). Sans elle : mode démo |
| `LLM_FALLBACKS` | les secours, dans l'ordre. Un fournisseur sans clé est ignoré |

Les autres sont documentées dans `.env.deploy.example`.
