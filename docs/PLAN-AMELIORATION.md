# Plan d'amélioration détaillé — appliqué à Umbra IA 2.0

Ce document reprend, point par point, le plan proposé après l'étude de la v1
(projet Lovable) et décrit **ce qui a été fait, comment, et comment le vérifier**.

---

## A. Diagnostic de la v1 (rappel)

| Problème constaté | Impact |
|---|---|
| `Crédits IA épuisés` sur la passerelle Lovable | App muette, non démontrable |
| App non installable (pas de manifeste, pas d'icône, pas de hors-ligne) | Impossible d'en faire un outil quotidien |
| Aucune action réelle : seulement texte + recherche | « Assistant » limité à la conversation |
| Titres figés à 42 caractères, pas de renommage ni d'export | Historique vite illisible |
| Pages 404/erreur et libellés d'outils en anglais | Rupture d'expérience |
| URL `your-pocket-tutor.lovable.app` | Incohérence de marque |
| 1 seule colonne JSON pour l'historique | Pas de recherche, pas d'export ciblé |

---

## B. Les 12 chantiers

### 1. Indépendance du cerveau (crédits IA)
**Fait.** Le serveur accepte **n'importe quel** endpoint compatible OpenAI :
Gemini (gratuit), OpenAI, OpenRouter, Groq, Mistral, Ollama local. La clé peut
venir du `.env` ou des Réglages (envoyée par en-têtes `x-llm-*`, jamais écrite
sur disque). Un **mode démo** local (règles) permet d'utiliser tous les outils
sans aucune clé.

*Vérifier :* `npm start` sans clé → chip « démo » ; Réglages → clé → « Tester la
connexion » affiche « Connecté · N modèles ».

### 2. Installable sur desktop et mobile
**Fait.** PWA complète : `manifest.webmanifest` (nom, icône, `display:
standalone`, raccourcis), service worker avec app shell hors-ligne, icônes
192/512/maskable/apple-touch, polices embarquées, meta iOS. Plus une app
**Electron** (fenêtre native + installeurs `.exe`/`.dmg`/`.AppImage`).

*Vérifier :* Chrome → « Installer l'application » ; `npm run desktop`.

### 3. Agir à la place de l'utilisateur
**Fait.** Trois modes (Discussion / Assisté / **Autonome**) sélectionnables dans
l'en-tête, injectés dans le prompt système et dans la boucle d'agent. En mode
Assisté, chaque outil marqué `risky` déclenche une **carte d'approbation**
(bouton Autoriser / Refuser, expiration 2 min). En Autonome, enchaînement
automatique jusqu'à 6 étapes d'outils.

*Vérifier :* mode Autonome → « Ouvre example.com et dis-moi ce que tu vois ».

### 4. Des mains réelles
**Fait.** 11 outils natifs : recherche web DDG (sans clé, parseur HTML),
lecture de page, calculatrice (parseur maison, pas d'`eval`), date/heure
localisée, mémoire (remember/forget), carnet Markdown, Python local (12 s max),
**Playwright** (goto/read/click/type/press/back/forward/scroll/screenshot/close),
ouverture d'URL, commande shell **désactivée par défaut** avec allowlist.

*Vérifier :* `npm test` (15 tests) ; carte d'outil dépliable dans le chat.

### 5. Historique utilisable
**Fait.** Renommage (double-clic ou ✎), suppression, **export Markdown** par
conversation, recherche instantanée dans la barre latérale, titrage automatique
sur 48 caractères.

### 6. Interface entièrement française
**Fait.** Plus une seule chaîne anglaise : états d'outils (« en cours… »,
« terminé », « échec »), modales, erreurs, page Confidentialité, menu Electron.

### 7. Mémoire complète et transparente
**Fait.** Page dédiée : ajout, édition en ligne, suppression unitaire, tout
effacer, compteur dans la barre latérale. Umbra peut ajouter/retirer un souvenir
via ses outils (`remember`/`forget`) ; l'interface applique l'action
(`client_action`) pour rester synchronisée.

### 8. Réglages sérieux
**Fait.** Fournisseur + URL + clé + modèle, **liste des modèles** récupérée en
direct, test de connexion, voix (activation, vitesse, test), prénom utilisé par
Umbra, export/import/effacement des données.

### 9. Confidentialité by design
**Fait.** Page dédiée expliquant ce qui sort de la machine ; données en
`localStorage` ; clé API jamais persistée côté serveur ; export sans la clé ;
`.gitignore` sur tous les `.env`.

### 10. Qualité technique
**Fait.** Serveur **zéro dépendance** (Node 20 pur : `http`, `fs`, `fetch`),
boucle d'agent maison avec SSE, séparation prompt/outils/LLM, 15 tests
automatisés (`node --test`), gestion d'erreurs explicite (401/404/429 traduits en
français).

### 11. Voix temps réel (guide JARVIS)
**Fait.** Agent LiveKit + Gemini Live (`livekit/`), caméra et partage d'écran,
10 outils vocaux en HTTP vers le serveur central. Voix `Charon`, ton
« majordome », prompt parlé (phrases courtes, pas de listes). Mode `console`
disponible sans LiveKit Cloud.

### 12. Marque et URL
**Reste à faire (hors code).** Choisir une URL propre (`umbra-ia.app` ou
`umbra-ia.lovable.app`) et y rediriger l'ancienne. Le code est prêt : le nom, les
métadonnées et les icônes sont déjà « Umbra IA ».

---

## C. Ce que ce chantier n'a pas fait (assumé)

| Point | Pourquoi |
|---|---|
| Synchronisation multi-appareils (compte) | Le local-first est un choix : pas de serveur, pas de fuite. Un compte peut s'ajouter plus tard (Supabase, comme la v1) |
| Apps natives App Store / Play Store | Une PWA s'installe sans store ; les stores exigent signature et revue |
| Exécution d'actions bancaires / paiements | Interdit par conception (sécurité) |
| Modèle « maison » | Umbra utilise le modèle que tu choisis : c'est un avantage, pas un manque |

---

## D. Vérifications effectuées

| Test | Résultat |
|---|---|
| `npm test` (15 tests : outils, API, SSE, PWA) | ✅ 15/15 |
| Recherche web réelle (DuckDuckGo) | ✅ résultats avec titres + extraits |
| Calcul, date, notes, Python | ✅ |
| Navigation pilotée (goto/read/screenshot/close) | ✅ Chromium |
| Approbation en mode Assisté | ✅ carte + boutons, action exécutée après accord |
| Mode Autonome sans confirmation | ✅ |
| PWA : manifeste, service worker, polices, icônes | ✅ |
| Interface mobile 390×844 | ✅ tiroir, compose, suggestions |
| Agent LiveKit | ✅ syntaxe validée ; exécution réelle nécessite tes clés LiveKit + Gemini |

---

## E. Suite logique (si tu veux aller plus loin)

1. **Héberger** Umbra (Railway/Render) + mot de passe → accès partout.
2. **Compte optionnel** (Supabase) pour synchroniser conversations et mémoire.
3. **Un outil par semaine** : agenda, e-mail, WhatsApp, veille de prix.
4. **Widgets** : `Ctrl+Espace` global sur desktop pour parler à Umbra depuis
   n'importe quelle application.
5. **Journal d'actions** : conserver l'historique de tout ce qu'Umbra a exécuté
   (utile en mode Autonome).
