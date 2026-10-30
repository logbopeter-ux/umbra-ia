# Umbra IA — agent vocal (LiveKit + Gemini Live)

La voix d'Umbra. Même cerveau de décision, mêmes outils que l'application web :
l'agent appelle le serveur Umbra local (`http://localhost:4173`) pour agir vraiment.

## Démarrage rapide

```bash
cd livekit
cp .env.example .env.local     # puis colle tes clés
uv sync                        # installe les dépendances Python
lk agent dev                   # ou : uv run python src/agent.py dev
```

Dans le terminal, `lk agent dev` affiche un lien de test : ouvre-le, autorise le
micro, parle. Pour arrêter : `Ctrl + C`.

> **L'application web doit tourner en parallèle** (`npm start` dans `umbra-ia/`) :
> c'est elle qui exécute les outils sur ta machine.

## Sans LiveKit Cloud

Les modes `console` (tu parles dans le terminal) et `dev` (playground web local)
sont fournis par la CLI LiveKit. Sans compte Cloud :

```bash
uv run python src/agent.py console   # conversation dans le terminal
```

En mode `console`, les outils HTTP continuent de fonctionner : le serveur Umbra
doit simplement être lancé.

## Variables utiles

| Variable | Rôle |
|---|---|
| `LIVEKIT_URL` / `_API_KEY` / `_API_SECRET` | identifiants LiveKit Cloud |
| `GOOGLE_API_KEY` | clé Gemini (gratuite sur aistudio.google.com) |
| `UMBRA_LIVE_MODEL` | modèle temps réel (`gemini-live-2.5-flash-preview`) |
| `UMBRA_LIVE_VOICE` | voix : `Charon` (grave, posée), `Puck`, `Kore`, `Fenrir`, `Aoede`… |
| `UMBRA_VOICE_AUTOCONFIRM` | `1` = actions directes, `0` = confirmation orale |

## Les 10 outils vocaux

`search_web`, `read_page`, `calculate`, `current_datetime`, `remember`,
`take_note`, `list_notes`, `run_python`, `control_browser`, `open_url`.

Chacun est une enveloppe HTTP de 3 lignes vers `/api/tool` : une seule source de
vérité avec l'application web, donc aucun risque de divergence.
