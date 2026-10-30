# Donner une voix à Umbra (guide JARVIS → Umbra)

Le guide « Ton propre Jarvis » décrit 5 briques. Les voici, transposées à Umbra
IA — mêmes principes, mêmes outils, même gratuité.

| Brique du guide | Outil du guide | Dans Umbra IA |
|---|---|---|
| **Oreilles et bouche** | LiveKit Agents + Cloud | `livekit/src/agent.py` — agent temps réel |
| **Cerveau** | Gemini Live | `google.realtime.RealtimeModel` (même modèle, même voix `Charon`) |
| **Yeux** | Vidéo LiveKit | `video_input=True` → caméra + partage d'écran |
| **Mains** | Outils Python (DuckDuckGo, Playwright) | 10 `function_tool` qui appellent le serveur Umbra (`/api/tool`) |
| **Visage** | Next.js (PC) + Flutter (mobile) | L'app Umbra installable (PWA) + Electron — déjà faite |

Autrement dit : **le guide fournit la voix, Umbra fournit le reste.**

---

## 1. Deux façons de parler à Umbra

### A. Voix intégrée — rien à installer

Dans l'interface web / desktop / mobile :

- 🔊 **Lecture vocale** : Umbra lit ses réponses (vitesse réglable dans Réglages).
- 🎙️ **Dictée** : tu parles, le texte s'écrit, l'envoi est automatique.

Fonctionne sur Chrome, Edge et Safari, sur ordinateur comme sur téléphone.
Limite : ce n'est pas une conversation duplex — tu parles, puis Umbra parle.

### B. Agent temps réel — la vraie expérience Jarvis

Conversation naturelle, interruptions, latence faible, caméra et partage d'écran.

```
[Micro/Navigateur] ⇄ LiveKit Cloud ⇄ Agent Python ⇄ Gemini Live
                                          │
                                          └── HTTP ─▶ Umbra (localhost:4173) ─▶ outils
```

#### Prérequis

- Python 3.10+ et [`uv`](https://docs.astral.sh/uv)
- Un compte LiveKit Cloud (gratuit, 1 000 minutes/mois)
- Une clé Gemini (gratuite) — https://aistudio.google.com/apikey

#### Installation

```bash
cd umbra-ia/livekit
cp .env.example .env.local      # colle tes 4 clés
uv sync                          # installe livekit-agents + plugins
lk agent dev                     # ou : uv run python src/agent.py dev
```

Le terminal affiche un lien (playground LiveKit) : ouvre-le, autorise le micro,
parle. `Ctrl + C` pour arrêter.

**Le serveur Umbra doit tourner** (`npm start` dans `umbra-ia/`) : c'est lui qui
exécute les outils sur ta machine.

#### Ce qu'Umbra sait faire à la voix

| Tu dis… | Umbra utilise… |
|---|---|
| « Quel temps fera-t-il ce soir à Cotonou ? » | `search_web` → résumé parlé |
| « Note un rendez-vous jeudi à 15 h chez le dentiste » | `take_note` |
| « Combien font 18 % de 1 250 ? » | `calculate` |
| « Ouvre example.com et dis-moi ce qu'il y a dessus » | `control_browser` (goto → read) |
| « Retiens que je préfère les réponses courtes » | `remember` |
| « Quelles notes j'ai ? » | `list_notes` |
| « Lance un script Python qui compte jusqu'à 10 » | `run_python` |

#### Personnaliser la voix

Dans `livekit/.env.local` :

```env
UMBRA_LIVE_VOICE=Charon        # grave et posée
# autres : Puck, Kore, Fenrir, Aoede, Leda, Orus, Zephyr, Enceladus, Iapetus…
UMBRA_LIVE_TEMPERATURE=0.8     # 0.4 sage et précis · 1.0 libre et drôle
UMBRA_USER_NAME=Monsieur       # ou Madame, ou ton prénom
```

Écoute toutes les voix dans Google AI Studio (rubrique Gemini Live).

#### Mode console (sans LiveKit Cloud)

```bash
cd umbra-ia/livekit
uv run python src/agent.py console
```

Tu parles dans le terminal ; les outils HTTP fonctionnent normalement.

---

## 2. Passer du guide à Umbra : ce qui change

| Le guide | Umbra IA | Pourquoi |
|---|---|---|
| Tools écrits dans `tools.py` de l'agent | Tools dans `server/tools.js`, appelés via `/api/tool` | **Une seule source de vérité** : la voix et le texte partagent exactement les mêmes capacités |
| Interface Next.js séparée (`frontend/`) | L'app Umbra (PWA/Electron) | Rien à maintenir en double, installable sur mobile |
| App Flutter + câble USB | PWA installée depuis le navigateur | Pas de SDK Android, pas de câble, marche sur iPhone |
| Recherche DuckDuckGo via `ddgs` | `web_search` maison (DDG Lite, sans clé) | Aucune dépendance Python, fonctionne aussi côté serveur |
| Playwright dans l'agent | `browser_control` dans le serveur | La capture d'écran remonte dans le chat, visible sur téléphone |

---

## 3. Sécurité (à respecter)

- Ne montre jamais `.env` / `.env.local` à l'écran et ne les publie jamais.
- Umbra ne lit jamais une clé à voix haute.
- Ne donne pas à Umbra l'accès à la banque, au Mobile Money ou aux moyens de
  paiement — même en mode Autonome.
- Avant d'ajouter un outil « sensible », passe d'abord par le mode **Assisté**.

---

## 4. Aller plus loin : le programme « un outil par semaine »

Comme dans le guide, chaque semaine un nouvel outil — ici, une fonction dans
`server/tools.js` suffit (elle apparaît ensuite partout : chat, voix, API).

| Semaine | Outil | Description à écrire dans le code |
|---|---|---|
| 1 | `calendar` | « Ajoute un rendez-vous avec date, heure et objet dans le fichier agenda. » |
| 2 | `mail` | « Résume les e-mails non lus de la journée. » (IMAP, mot de passe d'application) |
| 3 | `dictation` | « Enregistre une note dictée dans le dossier notes. » (déjà couvert par `notes`) |
| 4 | `whatsapp_draft` | « Prépare un brouillon de réponse à partir de ma base de prix. » |

Méthode : **nom clair + description claire + règle dans le prompt** → puis
`tools=[...]` côté agent vocal (rien à faire, il lit `/api/tools`).
