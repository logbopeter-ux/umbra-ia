/**
 * Umbra IA — Moteur de langage
 * Compatible avec toute API « OpenAI-compatible » :
 *   • Google Gemini (endpoint /v1beta/openai) — gratuit avec une clé AI Studio
 *   • OpenAI, OpenRouter, Groq, Mistral, Ollama local…
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

export async function streamCompletion({ config, messages, tools, signal, onDelta }) {
  const body = {
    model: config.model,
    messages,
    stream: true,
    temperature: 0.7,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `Erreur ${res.status} du fournisseur IA.`;
    try {
      const j = JSON.parse(text);
      msg = j.error?.message || j.message || msg;
    } catch {
      if (text) msg += ` ${text.slice(0, 300)}`;
    }
    if (res.status === 401 || res.status === 403) msg += ' Vérifie ta clé API dans Réglages.';
    if (res.status === 429) msg += ' Quota atteint : attends une minute ou change de modèle.';
    if (res.status === 404) msg += ` Le modèle « ${config.model} » existe-t-il ? Ouvre Réglages → Modèles pour en choisir un autre.`;
    throw new Error(msg);
  }

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
  const res = await fetch(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) throw new Error(`Impossible de lister les modèles (${res.status}).`);
  const json = await res.json();
  const arr = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  return arr
    .map((m) => (m.id || m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
}
