# 🧠 Les cerveaux d'Umbra — choisir son modèle

Umbra est un majordome, pas un modèle. Elle change de cerveau quand tu veux,
sans réinstaller, sans perdre sa mémoire ni ses notes.

Tout passe par le même format : **API compatible OpenAI** (`/chat/completions`).
Il suffit donc de trois valeurs — une URL, une clé, un nom de modèle.

---

## Changer de cerveau en 30 secondes

Dans l'application : **⚙️ Réglages → Cerveau**

1. **Fournisseur** : choisis dans la liste. L'URL et le modèle se remplissent seuls.
2. **Clé API** : colle la tienne (elle reste sur ton appareil, jamais sur le serveur).
3. **Modèle** : garde celui proposé, ou touche **Lister** pour voir ce que ta clé
   a réellement le droit d'utiliser.
4. **Tester la connexion** → puis envoie un message.

Le badge en haut de l'écran passe de **DÉMO** à **EN LIGNE** quand une clé est
active.

---

## Les six fournisseurs

| Fournisseur | Modèle par défaut | Prix indicatif (entrée / sortie par million de jetons) | À savoir |
|---|---|---|---|
| **Google Gemini** | `gemini-3.5-flash` | gratuit (offre AI Studio) | le meilleur point de départ ; outils fiables |
| **Anthropic Claude** | `claude-sonnet-5-5` | ~2 $ / 10 $ | excellente écriture et raisonnement ; `max_tokens` obligatoire |
| **Groq** | `openai/gpt-oss-120b` | ~0,15 $ / 0,60 $ | le plus rapide du marché ; outils supportés |
| **OpenAI** | `gpt-4o-mini` | ~0,15 $ / 0,60 $ | la référence historique |
| **OpenRouter** | `google/gemini-3.5-flash` | variable | un seul compte pour tous les modèles |
| **Ollama** | `llama3.1` | gratuit (local) | 100 % hors ligne, aucune clé |

> Les prix changent souvent : vérifie chez le fournisseur avant de t'engager.

---

## Où trouver les clés

| Fournisseur | Page |
|---|---|
| Gemini | <https://aistudio.google.com/apikey> — gratuit, sans carte bancaire |
| Claude | <https://console.anthropic.com/settings/keys> — crédit à l'usage |
| Groq | <https://console.groq.com/keys> — offre gratuite généreuse |
| OpenAI | <https://platform.openai.com/api-keys> |
| OpenRouter | <https://openrouter.ai/keys> |
| Ollama | rien à payer : `ollama pull llama3.1` en local |

Les clés commencent par : `AIza…` (Gemini), `sk-ant-…` (Claude), `gsk_…` (Groq),
`sk-…` (OpenAI), `sk-or-…` (OpenRouter).

---

## Ce qu'Umbra sait faire avec chaque cerveau

Les **11 outils** ne dépendent pas du modèle : c'est le serveur qui les exécute.
Seule change la qualité de la décision « dois-je appeler un outil, et avec quels
arguments ».

| Fournisseur | Outils (function calling) | Streaming | Remarque |
|---|---|---|---|
| Gemini | ✅ | ✅ | demande une signature de raisonnement réémise (géré) |
| Claude | ✅ | ✅ | `max_tokens` obligatoire, température ≤ 1 (géré) |
| Groq | ✅ | ✅ | certains modèles ne font pas d'appels parallèles |
| OpenAI | ✅ | ✅ | — |
| OpenRouter | ✅ | ✅ | dépend du modèle choisi |
| Ollama | ⚠️ selon le modèle | ✅ | `llama3.1` et `qwen2.5` sont fiables |

Umbra compense les différences pour toi. Exemple concret, côté serveur :

```javascript
// server/llm.js
const anthropic = isAnthropic(config.baseUrl);
temperature: anthropic ? Math.min(Math.max(temperature, 0), 1) : temperature,
if (anthropic) body.max_tokens = maxTokens;   // sans ça : 400 Bad Request
```

---

## Configurer sur un serveur (Render, VPS…)

Quand Umbra tourne en ligne, la clé se met dans les variables d'environnement —
jamais dans le code.

```env
# Claude
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_MODEL=claude-sonnet-5-5
LLM_API_KEY=sk-ant-…

# … ou Groq
# LLM_BASE_URL=https://api.groq.com/openai/v1
# LLM_MODEL=openai/gpt-oss-120b
# LLM_API_KEY=gsk_…

# … ou Gemini
# LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
# LLM_MODEL=gemini-3.5-flash
# LLM_API_KEY=AIza…
```

Redémarre : le bandeau du terminal affiche le cerveau retenu.

```
Cerveau     ✅ claude-sonnet-5-5
```

---

## Quelques réglages utiles

| Variable | Effet | Défaut |
|---|---|---|
| `LLM_MAX_TOKENS` | longueur maximale d'une réponse (Claude uniquement) | `8192` |
| `LLM_MODEL` | modèle par défaut | `gemini-3.5-flash` |
| `LLM_BASE_URL` | fournisseur | Gemini |

> ⚠️ `temperature` est fixée à `0.7` dans le code : c'est le bon compromis pour
> un assistant (assez créatif pour écrire, assez stable pour utiliser un outil).
> Au-delà de `1`, Claude écrête silencieusement — Umbra le fait avant lui pour que
> le comportement soit identique partout.

---

## Combien ça coûte vraiment ?

Un échange typique avec un outil = ~1 500 jetons en entrée, ~200 en sortie.

| Cerveau | Coût d'un échange | 1 000 échanges |
|---|---|---|
| Gemini (gratuit) | 0 $ | 0 $ |
| Groq `gpt-oss-120b` | ~0,0004 $ | ~0,40 $ |
| Claude Haiku 5.5 | ~0,0002 $ | ~0,20 $ |
| Claude Sonnet 5.5 | ~0,005 $ | ~5 $ |
| Claude Opus 5.5 | ~0,01 $ | ~10 $ |

Pour un usage quotidien, **Gemini gratuit** suffit. Claude prend le relais quand
tu veux de la prose soignée ; Groq quand tu veux une réponse instantanée.

---

## En cas de problème

| Message | Cause | Solution |
|---|---|---|
| `401` / « clé invalide » | clé fausse, expirée, ou d'un autre fournisseur | vérifie le préfixe (`sk-ant-`, `gsk_`, `AIza`) |
| `404` + « modèle » | nom de modèle retiré | Réglages → **Lister** → choisis dans la liste |
| `429` | quota atteint | attends une minute, ou change de modèle |
| `503 high demand` | modèle saturé côté fournisseur | réessaie, ou prends un autre modèle |
| Réponse vide | `max_tokens` trop bas pour un modèle « raisonneur » | monte `LLM_MAX_TOKENS` |
| Umbra ignore ses outils | modèle sans function calling | voir le tableau ci-dessus |

---

*Un bon majordome ne dépend pas d'une seule langue. Umbra non plus.*

---

## 🔁 Le basculement automatique — « un vrai Jarvis ne s'arrête pas »

Un majordome qui dit « mon quota est épuisé, débrouillez-vous » n'est pas un
majordome. Umbra enchaîne donc seule sur le cerveau suivant.

### Comment ça marche

```
Message de l'utilisateur
        │
        ▼
   Gemini (principal)
        │ 429 — quota épuisé
        ▼
   Groq (secours)  ────►  réponse affichée
        │
        └─► Groq reste « collant » pour les tours suivants
```

Ce qui déclenche une bascule :

| Situation | Pourquoi on bascule |
|---|---|
| **429** quota épuisé | le fournisseur ne répondra pas avant demain |
| **401 / 403** clé refusée | inutile d'insister, une autre clé fera l'affaire |
| **404** modèle retiré | le modèle a été supprimé entre deux versions |
| **5xx** panne serveur | incident côté fournisseur |
| **réseau** injoignable | coupure, DNS, pare-feu |

Ce qui **ne** déclenche **pas** de bascule :

- une **erreur 400** (requête mal formée) — un autre cerveau échouerait pareil ;
- un échec **après le début de la réponse** — on ne rejoue pas, sinon vous
  verriez deux débuts de phrase ;
- une **annulation** volontaire (bouton Stop).

### Le cerveau devient « collant »

Après une bascule, Umbra ne retente pas le fournisseur défaillant à chaque
message. Groq reste en tête de liste pour la suite de la conversation. Le
lendemain, au redémarrage, Gemini reprend sa place naturellement.

### Ce que vous voyez

Un discret bandeau en bas de l'écran :

> *« Gemini indisponible — Groq prend le relais. »*

Et l'info-bulle du badge **EN LIGNE** indique le cerveau réellement utilisé :

> Cerveau : Groq (openai/gpt-oss-120b)
> Secours automatique : Groq

La conversation continue, sans erreur visible, sans rien à reconfigurer.

### Le configurer

Trois lignes suffisent dans `.env` :

```env
LLM_FALLBACKS=groq,claude        # ordre des secours
GROQ_API_KEY=gsk_…
ANTHROPIC_API_KEY=sk-ant-…
```

Un secours sans clé est simplement ignoré. Umbra reste donc silencieux si vous
n'avez pas de compte Groq.

> 💡 **Sans quitter l'application** : le serveur peut détenir les clés
> (dans `.env`) et l'interface n'en saisit aucune. C'est le mode recommandé
> pour l'APK — la clé reste sur le serveur, le téléphone n'a rien à stocker.

### Vérifier que ça marche vraiment

```bash
npm test
```

Le test `tests/failover.test.js` lance deux faux fournisseurs — l'un répond
`429`, l'autre un vrai flux — et vérifie que la réponse arrive quand même :

```
✔ /api/health expose la chaîne des cerveaux
✔ le quota du principal n'empêche pas la réponse : le secours prend le relais
✔ le cerveau de secours devient « collant » : il répond seul au tour suivant
```

En tout : **93 tests**, dont 14 sur la seule bascule (faux `fetch` et vrais serveurs locaux, sans réseau).

---

## Le vrai Jarvis, en résumé

| Sans bascule | Avec bascule |
|---|---|
| quota épuisé → conversation morte | quota épuisé → Groq répond |
| panne Gemini → message d'erreur | panne Gemini → Claude répond |
| il faut changer de modèle à la main | Umbra choisit seule |
| la clé doit être sur le téléphone | la clé reste sur le serveur |

**Un cerveau qui défaille n'est plus un incident. C'est un repli.**

---

## 🏠 Ollama — le cerveau qui ne tombe jamais

Dernier maillon de la chaîne, et le plus important : **un modèle qui tourne sur
ta machine**. Pas de clé, pas de compte, pas de quota, pas d'internet.

### Installation

```bash
# Linux / macOS
curl -fsSL https://ollama.com/install.sh | sh

# puis un modèle (4 Go à 8 Go selon la taille)
ollama pull llama3.1        # 4,7 Go — bon équilibre
ollama pull qwen2.5:7b      # alternative solide en français
ollama pull llama3.2:3b     # 2 Go — pour une machine modeste
```

Rien d'autre à faire : **Umbra détecte Ollama toute seule**. Au démarrage, le
serveur sonde `http://localhost:11434`. S'il répond, Ollama est ajouté en fin de
chaîne ; sinon il est ignoré sans bruit.

```
  Ollama      ✅ détecté (llama3.1:latest, qwen2.5:7b)
```

### La cascade complète

```
Gemini  ──429 quota──▶  Groq  ──429 quota──▶  Ollama  ──▶  réponse
                                                        (local, gratuit)
```

Vérifié en conditions réelles avec trois faux fournisseurs :

```
  bascule Personnalisé → Groq
  bascule Groq → Ollama
  réponse : Même sans internet, Monsieur, je reste à votre service.
```

### Ce qu'Ollama change vraiment

| Situation | Sans Ollama | Avec Ollama |
|---|---|---|
| Quota Gemini épuisé | Groq prend le relais (si clé) | idem, puis Ollama |
| Aucune clé du tout | mode démo | **vraie conversation en local** |
| Coupure internet | Umbra muette | **Umbra répond quand même** |
| Avion, train, zone blanche | — | **Umbra fonctionne** |
| Données sensibles | partent chez un fournisseur | **ne quittent jamais la machine** |

> 💡 **Sans aucune clé API**, Umbra bascule directement sur Ollama et devient un
> assistant complet, entièrement hors ligne. Ses 11 outils continuent de
> fonctionner (recherche web mise à part, évidemment).

### Réglages

| Variable | Effet | Défaut |
|---|---|---|
| `OLLAMA_ENABLED` | `0` pour désactiver complètement | actif |
| `LLM_URL_OLLAMA` | adresse du serveur Ollama | `http://localhost:11434/v1` |
| `LLM_MODEL_OLLAMA` | modèle utilisé | `llama3.1` |

Sur une machine modeste, `llama3.2:3b` répond plus vite. Sur une machine
confortable, `qwen2.5:14b` écrit un français nettement meilleur.

### Une limite à connaître

Tous les modèles locaux ne savent pas appeler des outils. `llama3.1`, `qwen2.5`
et `mistral-nemo` le font correctement ; les très petits modèles (3B et moins)
préfèrent souvent répondre de mémoire. Umbra s'en accommode : elle répond,
simplement sans exécuter d'action.

---

## Récapitulatif : la chaîne par défaut

Sans aucune configuration, voici ce qu'Umbra construit toute seule :

| Ordre | Cerveau | Condition pour être dans la chaîne |
|---|---|---|
| 1 | Gemini | une clé `LLM_API_KEY` |
| 2 | Groq | une clé `GROQ_API_KEY` |
| 3 | Claude | une clé `ANTHROPIC_API_KEY` |
| 4 | OpenAI | une clé `OPENAI_API_KEY` |
| 5 | OpenRouter | une clé `OPENROUTER_API_KEY` |
| 6 | **Ollama** | que le serveur local réponde |

Un fournisseur sans clé n'apparaît pas. Ollama est toujours le dernier — même si
tu as défini `LLM_FALLBACKS` à la main, il ferme la marche.

**Et si tout tombe ?** Umbra passe en mode démo : ses outils fonctionnent
encore (calcul, notes, mémoire, date), seule la conversation devient mécanique.
À ce stade, ce n'est plus un problème de cerveau : c'est une coupure générale.
