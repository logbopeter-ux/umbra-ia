/**
 * Umbra IA — Moteur de langage
 * Compatible avec toute API « OpenAI-compatible » :
 *   • Google Gemini (endpoint /v1beta/openai) — gratuit avec une clé AI Studio
 *   • Anthropic Claude (endpoint https://api.anthropic.com/v1 — couche de
 *     compatibilité OpenAI, vérifiée : elle accepte /chat/completions + outils)
 *   • Groq (https://api.groq.com/openai/v1) — très rapide, modèles open-weights
 *   • OpenAI, OpenRouter, Mistral, Ollama local…
 * Sans clé : MODE DÉMO local (aucune dépendance réseau).
 */

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-3.5-flash';

export function llmConfig(overrides = {}) {
  const baseUrl = (overrides.baseUrl || process.env.LLM_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const apiKey = overrides.apiKey || process.env.LLM_API_KEY || '';
  const model = overrides.model || process.env.LLM_MODEL || DEFAULT_MODEL;
  return { baseUrl, apiKey, model, live: Boolean(apiKey) };
}

/* ─────────────────────────── Appel réel (streaming + outils) ─────────────────────────── */

/** Le fournisseur est-il Anthropic (couche de compatibilité OpenAI) ? */
export const isAnthropic = (baseUrl = '') => /anthropic\.com/i.test(baseUrl);

/** Serveur local (Ollama, LM Studio, vLLM…) : pas de clé, pas de quota. */
export const isLocal = (baseUrl = '') =>
  /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal/i.test(String(baseUrl));

const DEFAULT_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 8192);

/**
 * Cerveaux connus. `keyEnv` indique la variable d'environnement qui porte la
 * clé — c'est ce qui permet au serveur d'utiliser plusieurs fournisseurs à la
 * fois (principal + secours) sans que l'utilisateur ait à les ressaisir.
 */
export const PRESETS = {
  gemini: {
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash',
    keyEnv: 'LLM_API_KEY',
    vision: true,
  },
  claude: {
    label: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    keyEnv: 'ANTHROPIC_API_KEY',
    vision: true,
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    keyEnv: 'GROQ_API_KEY',
    // gpt-oss est un modèle texte : il ne voit pas les images.
    vision: false,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyEnv: 'OPENAI_API_KEY',
    vision: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-3.5-flash',
    keyEnv: 'OPENROUTER_API_KEY',
    vision: true, // dépend du modèle, surchargeable plus bas
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    keyEnv: 'OLLAMA_API_KEY', // facultative : Ollama n'en demande pas
    keyless: true,
    local: true,
    vision: false, // llama3.1 est un modèle texte ; voir modelVoit()
  },
};

/** Ordre de préférence quand l'utilisateur n'a rien configuré. */
export const AUTO_ORDER = ['groq', 'claude', 'openai', 'openrouter', 'ollama'];

/** Retrouve le nom d'un preset à partir de son URL. */
function nameFromUrl(baseUrl = '') {
  const found = Object.entries(PRESETS).find(([, p]) => p.baseUrl === String(baseUrl).replace(/\/+$/, ''));
  return found ? found[0] : 'custom';
}

/**
 * Sonde le serveur Ollama local. Renvoie true s'il répond.
 * On l'interroge une fois au démarrage puis périodiquement : inutile
 * d'essayer un cerveau local éteint à chaque message.
 */
export function ollamaBaseUrl(env = process.env) {
  return (env.LLM_URL_OLLAMA || PRESETS.ollama.baseUrl).replace(/\/+$/, '');
}

export async function probeOllama(baseUrl = ollamaBaseUrl(), timeoutMs = 1200) {
  const racine = String(baseUrl).replace(/\/v1\/?$/, '');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${racine}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Modèles réellement installés sur l'Ollama local (vide si absent). */
export async function ollamaModels(baseUrl = ollamaBaseUrl()) {
  const racine = String(baseUrl).replace(/\/v1\/?$/, '');
  try {
    const res = await fetch(`${racine}/api/tags`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.models || []).map((m) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}

/** Le fournisseur a-t-il de quoi fonctionner ? (clé présente, ou sans clé) */
function disponible(nom, env, available) {
  const preset = PRESETS[nom];
  if (!preset) return false;
  // Ollama : actif si la sonde est positive ET que personne ne l'a coupé.
  if (preset.local) return env.OLLAMA_ENABLED !== '0' && available?.ollama !== false;
  return Boolean(env[preset.keyEnv]);
}

/** Fabrique une entrée de chaîne à partir d'un preset. */
function entree(nom, env) {
  const preset = PRESETS[nom];
  const modele = env[`LLM_MODEL_${nom.toUpperCase()}`] || preset.model;
  // URL surchargeable : proxy d'entreprise, passerelle compatible, tests…
  const baseUrl = (env[`LLM_URL_${nom.toUpperCase()}`] || preset.baseUrl).replace(/\/+$/, '');
  const apiKey = preset.keyless ? env[preset.keyEnv] || '' : env[preset.keyEnv];
  return {
    name: nom,
    label: preset.label,
    baseUrl,
    model: modele,
    apiKey,
    local: Boolean(preset.local),
    vision: modelVoit(nom, modele),
  };
}

/**
 * Ce cerveau peut-il regarder une image ?
 * Un modèle local `llava` ou `qwen2.5vl` voit ; `llama3.1` non. OpenAI et
 * OpenRouter dépendent du modèle choisi : on se fie au nom.
 */
export function modelVoit(nom, modele = '') {
  const m = String(modele).toLowerCase();
  if (/llava|bakllava|moondream|minicpm-v|vision|vl\b|-vl|gemma3|llama4|qwen2\.5vl|qwen3-vl/.test(m)) return true;
  const preset = PRESETS[nom];
  if (!preset) return true; // passerelle inconnue : on tente, le cerveau suivant prendra le relais
  if (nom === 'openai' || nom === 'openrouter' || nom === 'custom') {
    return /gpt-4|gpt-5|o1|o3|o4|vision|gemini|claude|sonnet|opus|haiku|pixtral|llama-3\.2-(11|90)b|qwen2\.5-vl/.test(m) || Boolean(preset.vision);
  }
  return Boolean(preset.vision);
}

/**
 * Construit la chaîne de cerveaux — **sans configuration manuelle**.
 *
 *   1. le cerveau principal (clé saisie dans l'interface, sinon variables d'env) ;
 *   2. les secours, dans cet ordre :
 *        a. LLM_FALLBACKS s'il est défini (choix explicite de l'utilisateur) ;
 *        b. sinon AUTO_ORDER, en ne gardant que les fournisseurs réellement
 *           utilisables (clé présente, ou Ollama local qui répond).
 *
 * Un secours sans clé est simplement ignoré : Umbra n'échoue pas, elle continue.
 * Ollama ferme la marche : local, gratuit, jamais de quota.
 */
export function buildChain({ config = {}, env = process.env, fallbacks, available } = {}) {
  const chain = [];

  // ── 1. cerveau principal ──
  const clePerso = config.apiKey;
  const cleEnv = env.LLM_API_KEY;
  if (clePerso || cleEnv) {
    const baseUrl = String((clePerso ? config.baseUrl : env.LLM_BASE_URL) || PRESETS.gemini.baseUrl).replace(/\/+$/, '');
    const nom = nameFromUrl(baseUrl);
    const preset = PRESETS[nom];
    const modele = (clePerso ? config.model : env.LLM_MODEL) || preset?.model || '';
    chain.push({
      name: nom,
      label: preset?.label || 'Personnalisé',
      baseUrl,
      model: modele,
      apiKey: clePerso || cleEnv,
      vision: modelVoit(nom, modele),
    });
  }

  // ── 2. secours ──
  const explicite = fallbacks ?? env.LLM_FALLBACKS;
  const liste = String(explicite || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  // Sans liste explicite : on découvre tout seul ce qui est utilisable.
  const noms = liste.length ? liste : AUTO_ORDER.filter((n) => disponible(n, env, available));

  for (const nom of noms) {
    const preset = PRESETS[nom];
    if (!preset) continue;
    if (!disponible(nom, env, available)) continue;
    chain.push(entree(nom, env));
  }

  // Filet de sécurité : Ollama ferme TOUJOURS la marche, même si l'utilisateur
  // a donné une liste explicite. Local, gratuit, sans quota : c'est le dernier
  // rempart avant le mode démo. Désactivable avec OLLAMA_ENABLED=0.
  if (disponible('ollama', env, available) && !chain.some((c) => c.name === 'ollama')) {
    chain.push(entree('ollama', env));
  }

  // dédoublonnage (même URL + même modèle)
  const vus = new Set();
  return chain.filter((c) => {
    const id = `${c.baseUrl}|${c.model}`;
    if (vus.has(id)) return false;
    vus.add(id);
    return true;
  });
}

/** Un échec justifie-t-il d'essayer le cerveau suivant ? */
export function isRetryable(status) {
  // 429 quota, 5xx panne, 401/403 clé refusée, 404 modèle retiré, réseau (status absent)
  return status == null || status === 429 || status === 401 || status === 403 || status === 404 || status >= 500;
}

/**
 * Construit le corps envoyé au fournisseur.
 * Exporté pour être testable sans réseau.
 *
 * Deux particularités d'Anthropic :
 *   • `max_tokens` est obligatoire (l'API refuse la requête sans lui) ;
 *   • `temperature` doit rester dans [0, 1] (au-delà, elle est écrêtée côté
 *     serveur — autant l'écrêter nous-mêmes pour que le comportement soit
 *     identique partout).
 */
/**
 * Adapte les messages au cerveau qui va répondre.
 * Les images ne sont transmises qu'aux modèles capables de les voir ; les
 * autres reçoivent une note à la place, plutôt qu'une erreur 400.
 */
export function adapterMessages(messages, config) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const textes = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const images = m.content.filter((b) => b.type === 'image_url');
    if (!images.length) return { ...m, content: textes };
    if (config?.vision) return m;
    const note = images.length === 1 ? '[Une image est jointe, mais ce cerveau ne voit pas les images.]' : `[${images.length} images sont jointes, mais ce cerveau ne voit pas les images.]`;
    return { ...m, content: `${textes}\n\n${note}`.trim() };
  });
}

export function buildRequestBody(config, messages, tools, { temperature = 0.7, maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  const anthropic = isAnthropic(config.baseUrl);
  const body = {
    model: config.model,
    messages: adapterMessages(messages, config),
    stream: true,
    temperature: anthropic ? Math.min(Math.max(temperature, 0), 1) : temperature,
  };
  if (anthropic) body.max_tokens = maxTokens;
  if (tools?.length) {
    body.tools = tools;
    // Ollama (et quelques passerelles locales) rejettent `tool_choice` :
    // l'absence de ce champ équivaut déjà à « auto » côté OpenAI.
    if (!isLocal(config.baseUrl)) body.tool_choice = 'auto';
  }
  return body;
}

/** Traduit une réponse HTTP en erreur lisible, avec le nom du fournisseur. */
async function erreurHttp(res, config) {
  const text = await res.text().catch(() => '');
  let msg = `${config.label || 'Le fournisseur'} a répondu ${res.status}.`;
  try {
    const j = JSON.parse(text);
    msg = j.error?.message || j.message || msg;
  } catch {
    if (text) msg += ` ${text.slice(0, 300)}`;
  }

  if (res.status === 401 || res.status === 403) {
    msg += isAnthropic(config.baseUrl)
      ? ' Vérifie ta clé Claude (elle commence par « sk-ant- ») dans Réglages.'
      : ` Vérifie ta clé ${config.label || 'API'} dans Réglages.`;
  }
  if (res.status === 429) {
    // Le quota gratuit de Gemini est de 20 requêtes par JOUR et par modèle :
    // attendre une minute ne suffit pas, il faut changer de cerveau.
    msg += /gemini|generativelanguage/i.test(config.baseUrl)
      ? ' Quota gratuit Gemini épuisé (20 requêtes/jour).'
      : ` Quota ${config.label || 'du fournisseur'} atteint.`;
  }
  if (res.status === 404) msg += ` Le modèle « ${config.model} » existe-t-il ?`;

  const err = new Error(msg);
  err.status = res.status;
  err.retryable = isRetryable(res.status);
  return err;
}

/** Lit le flux SSE et reconstitue texte + appels d'outils. */
async function lireFlux(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const calls = [];

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;

    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onDelta?.(delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? calls.length;
        if (!calls[idx]) calls[idx] = { id: '', name: '', arguments: '', extra: null };
        // Gemini 3.x renvoie une signature de raisonnement qu'il faut réémettre
        // au tour suivant, sinon l'API répond 400 (function call is missing a
        // thought_signature).
        if (tc.extra_content) calls[idx].extra = tc.extra_content;
        if (tc.id) calls[idx].id = tc.id;
        if (tc.function?.name) calls[idx].name = tc.function.name;
        if (tc.function?.arguments) calls[idx].arguments += tc.function.arguments;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    for (const line of parts) handleLine(line);
  }
  if (buffer) handleLine(buffer);

  const toolCalls = calls
    .filter((c) => c && c.name)
    .map((c, i) => {
      let args = {};
      try {
        args = c.arguments ? JSON.parse(c.arguments) : {};
      } catch {
        args = {};
      }
      return { id: c.id || `call_${i}`, name: c.name, arguments: args, raw: c.arguments, extra: c.extra || null };
    });

  return { content, toolCalls };
}

/**
 * Appelle le premier cerveau disponible.
 *
 * Si un fournisseur échoue AVANT d'avoir écrit le moindre caractère (quota,
 * panne, clé refusée, réseau), on bascule silencieusement sur le suivant et
 * `onFailover` prévient l'interface. Si l'échec survient en cours de réponse,
 * on ne rejoue pas : l'utilisateur verrait deux débuts de phrase.
 */
export async function streamCompletion({
  config,
  chain,
  messages,
  tools,
  signal,
  onDelta,
  onFailover,
  fetchImpl = fetch,
}) {
  const cerveaux = chain?.length ? chain : config?.apiKey ? [config] : [];
  if (!cerveaux.length) throw new Error('Aucun cerveau configuré.');

  let derniereErreur;

  for (let i = 0; i < cerveaux.length; i++) {
    const cfg = cerveaux[i];
    const suivant = cerveaux[i + 1];
    let aParle = false;

    try {
      const body = buildRequestBody(cfg, messages, tools);

      let res;
      try {
        const entetes = { 'Content-Type': 'application/json' };
        // Ollama n'exige aucune clé : envoyer « Bearer » vide le perturbe.
        if (cfg.apiKey) entetes.Authorization = `Bearer ${cfg.apiKey}`;

        res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: entetes,
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        // panne réseau : on peut tenter le suivant
        const err = new Error(`${cfg.label || 'Le fournisseur'} est injoignable (${e.message}).`);
        err.retryable = true;
        err.reseau = true;
        throw err;
      }

      if (!res.ok) throw await erreurHttp(res, cfg);

      const out = await lireFlux(res, (t) => {
        aParle = true;
        onDelta?.(t);
      });

      return {
        ...out,
        provider: { name: cfg.name, label: cfg.label, model: cfg.model },
        fallbacks: i,
      };
    } catch (e) {
      derniereErreur = e;
      // On ne bascule que si (a) il reste quelqu'un, (b) rien n'a été affiché,
      // (c) l'erreur est de celles qu'un autre cerveau peut surmonter.
      const peutBasculer = Boolean(suivant) && !aParle && e.retryable !== false && e.name !== 'AbortError';
      if (!peutBasculer) throw e;
      onFailover?.({ de: cfg, vers: suivant, erreur: e.message });
    }
  }

  throw derniereErreur;
}

/* ─────────────────────────── MODE DÉMO (sans clé) ─────────────────────────── */

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function extractExpression(text) {
  const m = text.match(/([0-9][0-9\s+\-*/().,%^×÷]*[0-9)]|\d+)/);
  return m ? m[1].trim() : '';
}

function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s"'<>]+/i) || text.match(/\b([a-z0-9-]+\.(?:com|fr|org|net|io|app|dev|bj|co|edu|gov)(?:\/[^\s]*)?)\b/i);
  return m ? m[1] : '';
}

/**
 * Cerveau de secours : règles locales. Permet de tester Umbra (et tous les outils)
 * sans clé API. Il ne remplace pas un vrai modèle.
 */
export async function demoBrain({ messages, mode, emitDelta }) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  const question = lastUser?.content || '';
  const q = norm(question);

  // Étape 2 : un outil a déjà répondu → éventuellement enchaîner, puis répondre.
  if (toolMsgs.length) {
    const lastName = toolMsgs[toolMsgs.length - 1].name;
    const askedShot = /(capture|screenshot|ecran d ecran|ecran)/.test(q);
    const alreadyShot = toolMsgs.some((m) => /\[capture:/.test(String(m.content)));
    if (lastName === 'browser_control' && askedShot && !alreadyShot && toolMsgs.length === 1) {
      await streamText('Je prends une capture de la page.', emitDelta);
      return { content: '', toolCalls: [{ id: 'demo_shot', name: 'browser_control', arguments: { action: 'screenshot' } }] };
    }

    const last = toolMsgs[toolMsgs.length - 1];
    const name = process.env.UMBRA_USER_NAME || 'Monsieur';
    const raw = String(last.content || '').trim();
    const reply = `Voici ce que j'ai trouvé, ${name} :\n\n${trimToolResult(raw)}\n\n_— Umbra en mode démo (sans clé API, je raisonne par règles locales). Ajoute une clé dans Réglages pour une vraie conversation._`;
    await streamText(reply, emitDelta);
    return { content: reply, toolCalls: [] };
  }

  const demoNote = '\n\n_Mode démo : ajoute une clé API gratuite dans **Réglages** pour débloquer la vraie intelligence d\'Umbra._';

  // Recherche web
  if (/(cherche|recherche|actualite|meteo|quel temps|info sur|prix|combien coute|qui est|quand|nouvelle)/.test(q)) {
    const query = question.replace(/^(umba|umbra|jarvis)[,. ]*/i, '').replace(/^(cherche|recherche)\s*/i, '').trim() || question;
    if (mode !== 'discussion') {
      await streamText(`Je lance une recherche web sur « ${query} », ${process.env.UMBRA_USER_NAME || 'Monsieur'}.`, emitDelta);
      return { content: '', toolCalls: [{ id: 'demo_search', name: 'web_search', arguments: { query, max: 5 } }] };
    }
  }

  // Calcul
  if (/(calcul|combien fait|combien font|\d\s*[+\-*/x×]\s*\d)/.test(q)) {
    const expression = extractExpression(question);
    if (expression && mode !== 'discussion') {
      await streamText(`Je calcule « ${expression} ».`, emitDelta);
      return { content: '', toolCalls: [{ id: 'demo_calc', name: 'calculator', arguments: { expression } }] };
    }
  }

  // Date / heure
  if (/(quelle heure|quel jour|la date|aujourd hui c est|on est quel)/.test(q)) {
    if (mode !== 'discussion') {
      await streamText('Je vérifie la date et l\'heure.', emitDelta);
      return { content: '', toolCalls: [{ id: 'demo_date', name: 'get_current_datetime', arguments: {} }] };
    }
  }

  // Notes / mémoire
  if (/(retiens|souviens|memorise|note que|prends note)/.test(q)) {
    if (mode !== 'discussion') {
      await streamText('Je m\'en souviens.', emitDelta);
      return { content: '', toolCalls: [{ id: 'demo_mem', name: 'remember', arguments: { content: question } }] };
    }
  }

  // Notes / carnet
  if (/(prends? (une )?note|note intitul|ecris une note|note dans|ajoute.*note)/.test(q)) {
    const nameMatch = question.match(/(?:intitul[ée]e?|nomm[ée]e?|appel[ée]e?)\s*[«"']?([^»"',:]+)[»"']?/i);
    const contentMatch = question.match(/[:\-–]\s*([\s\S]+)$/);
    if (mode !== 'discussion') {
      const name = (nameMatch ? nameMatch[1] : 'note').trim();
      const content = (contentMatch ? contentMatch[1] : question).trim();
      await streamText(`Je note « ${name} » dans le carnet, ${process.env.UMBRA_USER_NAME || 'Monsieur'}.`, emitDelta);
      return { content: '', toolCalls: [{ id: 'demo_note', name: 'notes', arguments: { action: 'write', name, content } }] };
    }
  }

  // Lister les notes
  if (/(mes notes|liste.*notes|montre.*notes|carnet)/.test(q) && mode !== 'discussion') {
    await streamText('Je consulte le carnet.', emitDelta);
    return { content: '', toolCalls: [{ id: 'demo_notes_list', name: 'notes', arguments: { action: 'list' } }] };
  }

  // Python
  if (/(python|execute ce code|lance ce script)/.test(q) && mode !== 'discussion') {
    const codeMatch = question.match(/[:\n]([\s\S]+)$/);
    const code = codeMatch ? codeMatch[1].trim() : 'print("Bonjour depuis Umbra")';
    await streamText('J\'exécute ce code dans Python.', emitDelta);
    return { content: '', toolCalls: [{ id: 'demo_py', name: 'run_python', arguments: { code } }] };
  }

  // Navigateur piloté
  if (/(navigue|pilote|va sur .* et|clique|capture|screenshot|ce que tu vois)/.test(q)) {
    const url2 = extractUrl(question);
    if (url2 && mode !== 'discussion') {
      await streamText(`Je pilote le navigateur vers ${url2}.`, emitDelta);
      return { content: '', toolCalls: [{ id: 'demo_browser', name: 'browser_control', arguments: { action: 'goto', url: url2 } }] };
    }
  }

  // Ouvrir un site
  const url = extractUrl(question);
  if (url && /(ouvre|va sur|navigue|montre moi|affiche)/.test(q) && !/capture|screenshot/.test(q)) {
    if (mode !== 'discussion') {
      await streamText(`J'ouvre ${url}.`, emitDelta);
      return { content: '', toolCalls: [{ id: 'demo_open', name: 'open_url', arguments: { url } }] };
    }
  }

  // Réponse par défaut
  const name = process.env.UMBRA_USER_NAME || 'Monsieur';
  const replies = [
    `Je vous écoute, ${name}. En mode démo, je sais déjà chercher sur le web, calculer, ouvrir un site, retenir un souvenir, exécuter du Python et piloter un navigateur — passez en mode Assisté ou Autonome et demandez-moi l'action.`,
    `À votre service, ${name}. Sans clé API je fonctionne par règles : dites-moi « cherche… », « calcule… », « ouvre… », « retiens que… » et je m'exécute. Une clé gratuite dans Réglages me donnera toute mon intelligence.`,
    `C'est noté, ${name}. Pour une réponse complète et nuancée, ajoutez une clé Gemini (gratuite) dans Réglages : sinon, je reste un majordome… de démonstration.`,
  ];
  const reply = replies[Math.floor(Math.random() * replies.length)] + demoNote;
  await streamText(reply, emitDelta);
  return { content: reply, toolCalls: [] };
}


/** Met en forme le résultat brut d'un outil pour le mode démo. */
function trimToolResult(raw) {
  if (!raw) return '(aucun résultat)';
  const cleaned = raw
    .split('\n')
    .filter((l) => !/^\[capture:/.test(l.trim()))
    .join('\n')
    .replace(/\/screenshots\/[^\s)]+/g, '(image affichée ci-dessous)');
  const lines = cleaned.split('\n');
  const keep = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (/^Résultats pour/.test(l)) continue;
    if (/^\d+\.\s/.test(l)) keep.push(`**${l}**`);
    else if (/^https?:/.test(l)) keep.push(l);
    else keep.push(l);
    if (keep.length >= 14) break;
  }
  return keep.join('\n\n').slice(0, 1400);
}

async function streamText(text, emitDelta) {
  const chunks = text.match(/.{1,24}(\s|$)/gs) || [text];
  for (const c of chunks) {
    emitDelta?.(c);
    await new Promise((r) => setTimeout(r, 12));
  }
}

/* ─────────────────────────── Liste des modèles ─────────────────────────── */

export async function listModels(config) {
  const headers = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const res = await fetch(`${config.baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`Impossible de lister les modèles (${res.status}).`);
  const json = await res.json();
  const arr = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  return arr
    .map((m) => (m.id || m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
}
