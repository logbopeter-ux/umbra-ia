/* ============================================================
   Umbra IA — application (vanilla JS, sans build)
   ============================================================ */

/* ─────────────── Stockage & état ─────────────── */

/* ─────────────── Serveur (utile pour l'APK / la version installée) ─────────────── */

const SERVER_KEY = 'umbra.v2.server';

function getServer() {
  try {
    return (localStorage.getItem(SERVER_KEY) || '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function setServer(url) {
  try {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (clean) localStorage.setItem(SERVER_KEY, clean);
    else localStorage.removeItem(SERVER_KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Préfixe une route par le serveur configuré (vide = même origine). */
const apiUrl = (p) => `${getServer()}${p}`;

/**
 * Options de requête adaptées au mode connecté.
 * Quand l'interface est embarquée dans l'APK et pointe vers un serveur distant,
 * la requête est cross-origin : sans `credentials: 'include'`, le navigateur
 * n'envoie pas le cookie de session et tout répond 401.
 */
const TOKEN_KEY = 'umbra.v2.token';

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Options de requête adaptées au mode connecté.
 * Quand l'interface est embarquée dans l'APK et pointe vers un serveur distant,
 * la requête est cross-origin : le cookie de session (SameSite=Lax) ne circule
 * pas, c'est donc le jeton renvoyé par /api/login qui authentifie.
 */
const net = (opts = {}) => {
  if (!getServer()) return opts;
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { ...opts, credentials: 'include', headers };
};

const isNativeShell = () =>
  Boolean(window.Capacitor?.isNativePlatform?.()) ||
  location.protocol === 'capacitor:' ||
  location.protocol === 'file:';

const INTERFACE_VERSION = '2.1.1';

const LS = {
  settings: 'umbra.v2.settings',
  threads: 'umbra.v2.threads',
  memories: 'umbra.v2.memories',
  current: 'umbra.v2.current',
};

const PROVIDERS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash',
    keyHint: 'AIza… (clé Gemini gratuite)',
    models: ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'],
  },
  claude: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    keyHint: 'sk-ant-… (clé Anthropic)',
    models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-4-6'],
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyHint: 'sk-… (clé OpenAI)',
    models: ['gpt-4o-mini', 'gpt-4o'],
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    keyHint: 'gsk_… (clé Groq, gratuite)',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b'],
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-3.5-flash',
    keyHint: 'sk-or-… (clé OpenRouter)',
    models: ['google/gemini-3.5-flash', 'anthropic/claude-sonnet-5.5', 'openai/gpt-4o-mini'],
  },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keyHint: 'laisser vide', models: [] },
  custom: { baseUrl: '', model: '', keyHint: '', models: [] },
};

/** Noms lisibles des fournisseurs (pour le bandeau d'état). */
const LIBELLES = {
  gemini: 'Gemini',
  claude: 'Claude',
  groq: 'Groq',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  custom: 'Personnalisé',
};

const DEFAULT_SETTINGS = {
  provider: 'gemini',
  baseUrl: PROVIDERS.gemini.baseUrl,
  apiKey: '',
  model: PROVIDERS.gemini.model,
  voiceReplies: false,
  voiceRate: 1,
  userName: 'Monsieur',
  mode: 'assisted',
};

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    toast('Stockage plein : impossible de sauvegarder.', 'error');
  }
};

const state = {
  settings: { ...DEFAULT_SETTINGS, ...load(LS.settings, {}) },
  threads: load(LS.threads, []),
  memories: load(LS.memories, []),
  currentId: load(LS.current, null),
  health: null,
  streaming: false,
  controller: null,
  pending: [], // pièces jointes en attente d'envoi
  uploading: 0,
};

const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const nowHHMM = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/* ─────────────── Utilitaires ─────────────── */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
  return out;
}

/** Rendu Markdown minimal mais solide (titres, listes, code, tableaux, citations). */
function renderMarkdown(text) {
  const blocks = [];
  let src = String(text ?? '').replace(/```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
    blocks.push({ lang: lang || 'code', code: code.replace(/\n$/, '') });
    return `\u0000B${blocks.length - 1}\u0000`;
  });

  const lines = src.split('\n');
  const out = [];
  let listType = null;
  let para = [];
  let table = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushTable = () => {
    if (table.length) {
      const rows = table.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      const cells = rows.map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      if (cells.length) {
        const head = cells[0].map((c) => `<th>${inline(c)}</th>`).join('');
        const body = cells
          .slice(1)
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('');
        out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      }
      table = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (/^\u0000B\d+\u0000$/.test(line.trim())) {
      flushPara(); flushList(); flushTable();
      out.push(line.trim());
      continue;
    }
    if (!line.trim()) {
      flushPara(); flushList(); flushTable();
      continue;
    }
    if (/^\|.*\|$/.test(line.trim())) {
      flushPara(); flushList();
      table.push(line.trim());
      continue;
    }
    flushTable();

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const lvl = Math.min(h[1].length, 3);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara(); flushList();
      out.push('<hr>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara(); flushList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (listType !== want) {
        flushList();
        out.push(`<${want}>`);
        listType = want;
      }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara(); flushList(); flushTable();

  let html = out.join('\n');
  html = html.replace(/\u0000B(\d+)\u0000/g, (m, i) => {
    const b = blocks[Number(i)];
    return `<pre><div class="code-head"><span>${escapeHtml(b.lang)}</span><button type="button" class="icon-btn tiny" data-copy>Copier</button></div><code>${escapeHtml(b.code)}</code></pre>`;
  });
  return html;
}

/** Version texte brut (pour la synthèse vocale). */
function plainText(md) {
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#*_>|-]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

/* ─────────────── Conversations ─────────────── */

function currentThread() {
  return state.threads.find((t) => t.id === state.currentId) || null;
}

function ensureThread() {
  let t = currentThread();
  if (!t) {
    t = { id: uid(), title: 'Nouvelle conversation', messages: [], updatedAt: Date.now() };
    state.threads.unshift(t);
    state.currentId = t.id;
    persistThreads();
  }
  return t;
}

function persistThreads() {
  state.threads = state.threads.slice(0, 200);
  save(LS.threads, state.threads);
  save(LS.current, state.currentId);
}

function newThread() {
  if (state.streaming) stopStreaming();
  const t = { id: uid(), title: 'Nouvelle conversation', messages: [], updatedAt: Date.now() };
  state.threads.unshift(t);
  state.currentId = t.id;
  persistThreads();
  renderAll();
  $('input').focus();
}

function deleteThread(id) {
  state.threads = state.threads.filter((t) => t.id !== id);
  if (state.currentId === id) state.currentId = state.threads[0]?.id || null;
  persistThreads();
  if (!state.threads.length) ensureThread();
  renderAll();
}

function renameThread(id, title) {
  const t = state.threads.find((x) => x.id === id);
  if (!t) return;
  t.title = title.slice(0, 80) || 'Sans titre';
  persistThreads();
  renderThreads();
  renderHeader();
}

function exportThread(id) {
  const t = state.threads.find((x) => x.id === id);
  if (!t) return;
  const md = `# ${t.title}\n\n${t.messages
    .map((m) => `${m.role === 'user' ? '## Moi' : '## Umbra'}\n\n${m.content}`)
    .join('\n\n')}\n`;
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.title.replace(/[^\w\- ]+/g, '') || 'conversation'}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Conversation exportée.');
}

/* ─────────────── Rendu ─────────────── */

function renderThreads() {
  const query = ($('searchThreads').value || '').toLowerCase().trim();
  const list = state.threads.filter((t) => !query || t.title.toLowerCase().includes(query));
  const nav = $('threads');
  nav.innerHTML = '';

  if (!list.length) {
    nav.innerHTML = `<p class="thread-empty">${query ? 'Aucun résultat.' : 'Aucune conversation pour l’instant.'}</p>`;
    return;
  }

  for (const t of list) {
    const row = document.createElement('div');
    row.className = `thread${t.id === state.currentId ? ' active' : ''}`;
    row.dataset.id = t.id;

    const btn = document.createElement('button');
    btn.className = 'thread-title';
    btn.textContent = t.title;
    btn.title = t.title;
    btn.addEventListener('click', () => selectThread(t.id));
    btn.addEventListener('dblclick', () => startRename(row, t));

    const actions = document.createElement('div');
    actions.className = 'thread-actions';

    const ren = document.createElement('button');
    ren.className = 'icon-btn tiny';
    ren.innerHTML = '✎';
    ren.title = 'Renommer';
    ren.setAttribute('aria-label', `Renommer ${t.title}`);
    ren.addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(row, t);
    });

    const dl = document.createElement('button');
    dl.className = 'icon-btn tiny';
    dl.innerHTML = '⤓';
    dl.title = 'Exporter en Markdown';
    dl.setAttribute('aria-label', `Exporter ${t.title}`);
    dl.addEventListener('click', (e) => {
      e.stopPropagation();
      exportThread(t.id);
    });

    const del = document.createElement('button');
    del.className = 'icon-btn tiny';
    del.innerHTML = '🗑';
    del.title = 'Supprimer';
    del.setAttribute('aria-label', `Supprimer ${t.title}`);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Supprimer « ${t.title} » ?`)) deleteThread(t.id);
    });

    actions.append(ren, dl, del);
    row.append(btn, actions);
    nav.appendChild(row);
  }
}

function startRename(row, thread) {
  const input = document.createElement('input');
  input.className = 'thread-rename';
  input.value = thread.title;
  row.replaceChildren(input);
  input.focus();
  input.select();
  const commit = () => renameThread(thread.id, input.value.trim());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') renderThreads();
  });
  input.addEventListener('blur', commit);
}

function selectThread(id) {
  if (state.streaming) stopStreaming();
  state.currentId = id;
  persistThreads();
  closeSidebar();
  renderAll();
}

function renderHeader() {
  const t = currentThread();
  $('threadTitle').textContent = t ? t.title : 'Umbra IA';
  const chip = $('statusChip');
  const live = state.health?.live;
  chip.textContent = live ? 'en ligne' : 'démo';
  chip.className = `status-chip ${live ? 'live' : 'demo'}`;

  // Cerveau réellement actif : celui du serveur si l'on n'a pas sa propre clé.
  const actif = state.health?.active?.label || LIBELLES[state.settings.provider] || '';
  const modele = state.health?.active?.model || state.health?.model || state.settings.model;
  const secours = (state.health?.brains || []).slice(1).map((b) => b.label);

  if (!live) {
    chip.title = 'Aucune clé API : Umbra fonctionne en mode démonstration.';
  } else {
    const liste = secours.length ? `\nSecours automatique : ${secours.join(' → ')}` : '';
    chip.title = `Cerveau : ${actif || '?'} (${modele})${liste}`;
  }
}

function renderModes() {
  document.querySelectorAll('.mode').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.mode === state.settings.mode));
  });
  const hint = $('modeHint');
  const map = {
    discussion: "Mode discussion : Umbra répond seulement, il n'utilise aucun outil.",
    assisted: 'Mode assisté : Umbra agit, mais te demande avant chaque action risquée.',
    autonomous: "Mode autonome : Umbra exécute tout seul, sans confirmation. Il rend compte après.",
  };
  hint.textContent = map[state.settings.mode];
  hint.classList.toggle('auto', state.settings.mode === 'autonomous');
}

function renderCaps() {
  const tools = state.health?.tools || [];
  const icons = {
    web_search: '🔎', fetch_page: '📄', calculator: '🧮', get_current_datetime: '🕒',
    remember: '🧠', forget: '🧽', notes: '📝', run_python: '🐍',
    browser_control: '🌐', open_url: '↗️', system_command: '⌨️',
  };
  $('caps').innerHTML = tools
    .map((t) => `<span class="cap" title="${escapeHtml(t.description)}">${icons[t.name] || '•'} ${escapeHtml(t.label)}</span>`)
    .join('');
}

function renderAll() {
  renderThreads();
  renderHeader();
  renderModes();
  renderMemoryList();
  renderChat();
  $('memoryCount').textContent = String(state.memories.length);
}

/* ─────────────── Rendu du fil ─────────────── */

function renderChat() {
  const thread = currentThread();
  const box = $('messages');
  box.innerHTML = '';
  const hasMessages = Boolean(thread && thread.messages.length);
  $('welcome').hidden = hasMessages;
  box.hidden = !hasMessages;
  if (!hasMessages) return;

  for (const m of thread.messages) {
    box.appendChild(messageNode(m));
  }
  scrollToBottom();
}

function messageNode(m) {
  if (m.role === 'user') {
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const bulle = document.createElement('div');
    bulle.className = 'bubble';
    if (m.content) bulle.innerHTML = escapeHtml(m.content);
    const fichiers = blocPieces(m);
    if (fichiers) bulle.appendChild(fichiers);
    wrap.appendChild(bulle);
    return wrap;
  }

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.dataset.id = m.id;

  const img = document.createElement('img');
  img.src = '/icons/icon.svg';
  img.className = 'avatar';
  img.alt = '';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML = `<span class="msg-author">Umbra</span><span class="msg-time">${m.time || nowHHMM()}</span>`;

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const copy = document.createElement('button');
  copy.className = 'icon-btn';
  copy.innerHTML = '⧉';
  copy.title = 'Copier';
  copy.setAttribute('aria-label', 'Copier la réponse');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(m.content || '').then(() => toast('Copié.'));
  });
  const regen = document.createElement('button');
  regen.className = 'icon-btn';
  regen.innerHTML = '↻';
  regen.title = 'Régénérer';
  regen.setAttribute('aria-label', 'Régénérer la réponse');
  regen.addEventListener('click', () => regenerate(m.id));
  actions.append(copy, regen);
  meta.appendChild(actions);

  const content = document.createElement('div');
  content.className = 'prose';
  content.innerHTML = renderMarkdown(m.content || '');

  body.append(meta, content);

  if (Array.isArray(m.tools) && m.tools.length) {
    const holder = document.createElement('div');
    for (const t of m.tools) holder.appendChild(toolCard(t));
    body.appendChild(holder);
  }

  wrap.append(img, body);
  return wrap;
}

const TOOL_ICONS = {
  web_search: '🔎', fetch_page: '📄', calculator: '🧮', get_current_datetime: '🕒',
  remember: '🧠', forget: '🧽', notes: '📝', run_python: '🐍', browser_control: '🌐',
  open_url: '↗️', system_command: '⌨️',
};

function toolCard(t) {
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.dataset.toolId = t.id;

  const stateClass = t.state === 'running' ? 'running' : t.ok === false ? 'error' : 'ok';
  const stateLabel = t.state === 'running' ? 'en cours…' : t.ok === false ? 'échec' : 'terminé';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'tool-head';
  head.innerHTML = `
    <span class="tool-icon">${TOOL_ICONS[t.name] || '🔧'}</span>
    <span class="tool-label">${escapeHtml(t.label || t.name)}</span>
    <span class="tool-state ${stateClass}">${stateLabel}</span>
    <span class="tool-caret">›</span>`;
  head.addEventListener('click', () => card.classList.toggle('open'));

  const body = document.createElement('div');
  body.className = 'tool-body';

  const args = JSON.stringify(t.args || {}, null, 2);
  if (args !== '{}') {
    body.insertAdjacentHTML('beforeend', `<div class="tool-sub">Paramètres</div><pre>${escapeHtml(args)}</pre>`);
  }
  if (t.summary) {
    body.insertAdjacentHTML('beforeend', `<div class="tool-sub">Résultat</div><pre>${escapeHtml(t.summary)}</pre>`);
  }
  if (t.image) {
    const shot = document.createElement('img');
    shot.className = 'tool-shot';
    shot.src = apiUrl(t.image);
    shot.alt = 'Capture du navigateur';
    body.appendChild(shot);
  }

  card.append(head, body);
  if (t.state === 'running' || t.ok === false) card.classList.add('open');
  return card;
}

function scrollToBottom() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}


/* ─────────────── Pièces jointes (photos, PDF, documents) ─────────────── */

const LIMITE_PIECE = 25 * 1024 * 1024;
const ICONES_PIECE = { image: '🖼️', document: '📄', media: '🎬', inconnu: '📦' };

const poidsLisible = (o) => (o >= 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

/** URL d'une pièce jointe stockée sur le serveur (les <img> ne portent pas d'en-tête). */
function urlPiece(f) {
  if (!f?.id) return f?.apercuUrl || '';
  const base = apiUrl(`/api/fichiers/${encodeURIComponent(f.id)}`);
  const t = getToken();
  return t ? `${base}?t=${encodeURIComponent(t)}` : base;
}

function fichierVersDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(file);
  });
}

function chargerImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    img.src = url;
  });
}

/**
 * Les photos de téléphone pèsent 4 à 8 Mo et 4000 px de large : inutile de les
 * envoyer tel quel. On les réduit à 1600 px (au-delà, aucun modèle ne gagne en
 * détail) — l'envoi passe de plusieurs secondes à un instant.
 */
async function preparerImage(file) {
  const brut = await fichierVersDataUrl(file).catch(() => null);
  if (!brut) return null;
  if (file.size <= 700 * 1024) return { dataUrl: brut, mime: file.type || 'image/jpeg' };

  const img = await chargerImage(file).catch(() => null);
  if (!img || !img.width) return { dataUrl: brut, mime: file.type || 'image/jpeg' };

  const max = 1600;
  const echelle = Math.min(1, max / Math.max(img.width, img.height));
  if (echelle === 1 && file.size <= 2 * 1024 * 1024) return { dataUrl: brut, mime: file.type || 'image/jpeg' };

  const toile = document.createElement('canvas');
  toile.width = Math.round(img.width * echelle);
  toile.height = Math.round(img.height * echelle);
  const ctx = toile.getContext('2d');
  ctx.drawImage(img, 0, 0, toile.width, toile.height);
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return { dataUrl: toile.toDataURL(mime, 0.86), mime };
}

function retirerPiece(id) {
  const f = state.pending.find((x) => x.id === id);
  state.pending = state.pending.filter((x) => x.id !== id);
  renderPieces();
  // Libère le fichier côté serveur s'il a déjà été envoyé et n'est pas utilisé.
  if (f?.serveur) fetch(apiUrl(`/api/fichiers/${encodeURIComponent(f.id)}`), net({ method: 'DELETE' })).catch(() => {});
}

function renderPieces() {
  const zone = $('pieces');
  if (!zone) return;
  zone.innerHTML = '';
  zone.hidden = state.pending.length === 0;

  for (const f of state.pending) {
    const carte = document.createElement('div');
    carte.className = `piece${f.enCours ? ' envoi' : ''}`;

    const apercu = f.apercuUrl || (f.categorie === 'image' && f.serveur ? urlPiece(f) : '');
    if (apercu) {
      const img = document.createElement('img');
      img.className = 'piece-thumb';
      img.src = apercu;
      img.alt = '';
      carte.appendChild(img);
    } else {
      const ico = document.createElement('div');
      ico.className = 'piece-ico';
      ico.textContent = ICONES_PIECE[f.categorie] || '📄';
      carte.appendChild(ico);
    }

    const txt = document.createElement('div');
    txt.className = 'piece-txt';
    const nom = document.createElement('span');
    nom.className = 'piece-nom';
    nom.textContent = f.nom || 'fichier';
    nom.title = f.nom || '';
    const meta = document.createElement('span');
    meta.className = 'piece-meta';
    meta.textContent = f.enCours ? 'envoi…' : [f.info, poidsLisible(f.taille)].filter(Boolean).join(' · ');
    txt.append(nom, meta);
    carte.appendChild(txt);

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'piece-x';
    x.textContent = '✕';
    x.title = 'Retirer';
    x.setAttribute('aria-label', `Retirer ${f.nom || 'le fichier'}`);
    x.addEventListener('click', () => retirerPiece(f.id));
    carte.appendChild(x);

    zone.appendChild(carte);
  }
}

/** Envoie un fichier au serveur, qui en extrait le texte (ou garde l'image). */
async function ajouterFichier(file) {
  if (!file) return;
  if (file.size > LIMITE_PIECE) {
    toast(`${file.name} dépasse 25 Mo : impossible de l'envoyer.`, 'error');
    return;
  }

  const local = `local-${uid()}`;
  const estImage = String(file.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|avif)$/i.test(file.name);
  const provisoire = { id: local, nom: file.name, taille: file.size, categorie: estImage ? 'image' : 'document', enCours: true };
  state.pending.push(provisoire);
  state.uploading++;
  $('clipBtn').classList.add('busy');
  renderPieces();

  try {
    let dataUrl;
    let mime = file.type || 'application/octet-stream';
    if (estImage) {
      const prep = await preparerImage(file);
      if (!prep) throw new Error('Image illisible.');
      dataUrl = prep.dataUrl;
      mime = prep.mime;
      provisoire.apercuUrl = dataUrl;
      provisoire.taille = Math.round((dataUrl.length * 3) / 4);
      renderPieces();
    } else {
      dataUrl = await fichierVersDataUrl(file);
    }

    const res = await fetch(apiUrl('/api/fichiers'), net({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...llmHeaders() },
      body: JSON.stringify({ nom: file.name, mime, data: String(dataUrl).split(',')[1] || '' }),
    }));

    if (handleUnauthorized(res)) return;
    const meta = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(meta.error || `Envoi impossible (${res.status}).`);

    Object.assign(provisoire, meta, { id: meta.id, enCours: false, serveur: true });
    if (meta.categorie !== 'image') provisoire.apercuUrl = '';
    if (meta.avertissement) toast(meta.avertissement, 'info');
  } catch (e) {
    state.pending = state.pending.filter((x) => x.id !== local);
    toast(e.message || "Impossible d'ajouter ce fichier.", 'error');
  } finally {
    state.uploading = Math.max(0, state.uploading - 1);
    if (!state.uploading) $('clipBtn').classList.remove('busy');
    renderPieces();
  }
}

function ajouterFichiers(list) {
  const fichiers = [...(list || [])];
  if (!fichiers.length) return;
  const images = state.pending.filter((f) => f.categorie === 'image').length;
  let restantes = 6 - images;
  for (const f of fichiers) {
    const estImage = String(f.type || '').startsWith('image/');
    if (estImage && restantes-- <= 0) {
      toast('Six images au maximum par message.', 'info');
      continue;
    }
    ajouterFichier(f);
  }
}

/** Affiche les pièces jointes d'un message dans l'historique. */
/** Ouvre une image en grand, sans quitter Umbra. */
function agrandirImage(src, nom = '') {
  if (!src) return;
  const voile = document.createElement('div');
  voile.className = 'lightbox';
  const img = document.createElement('img');
  img.src = src;
  img.alt = nom;
  const fermer = document.createElement('button');
  fermer.className = 'lightbox-x';
  fermer.textContent = '✕';
  fermer.setAttribute('aria-label', 'Fermer');
  voile.append(img, fermer);
  const sortir = () => voile.remove();
  voile.addEventListener('click', (e) => {
    if (e.target === voile || e.target === fermer) sortir();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      sortir();
      document.removeEventListener('keydown', esc);
    }
  });
  document.body.appendChild(voile);
}

function blocPieces(m) {
  const liste = Array.isArray(m.attachments) ? m.attachments : [];
  if (!liste.length) return null;
  const boite = document.createElement('div');
  boite.className = 'msg-files';
  for (const f of liste) {
    if (f.categorie === 'image') {
      const img = document.createElement('img');
      img.className = 'msg-file-shot';
      img.src = urlPiece(f);
      img.alt = f.nom || 'image jointe';
      img.title = `${f.nom || 'image'} — cliquer pour agrandir`;
      img.loading = 'lazy';
      img.addEventListener('click', () => agrandirImage(img.src, f.nom));
      boite.appendChild(img);
    } else {
      const carte = document.createElement('div');
      carte.className = 'piece';
      const ico = document.createElement('div');
      ico.className = 'piece-ico';
      ico.textContent = ICONES_PIECE[f.categorie] || '📄';
      const txt = document.createElement('div');
      txt.className = 'piece-txt';
      const nom = document.createElement('span');
      nom.className = 'piece-nom';
      nom.textContent = f.nom || 'fichier';
      const meta = document.createElement('span');
      meta.className = 'piece-meta';
      meta.textContent = [f.info, f.taille ? poidsLisible(f.taille) : ''].filter(Boolean).join(' · ');
      txt.append(nom, meta);
      carte.append(ico, txt);
      boite.appendChild(carte);
    }
  }
  return boite;
}

/* ─────────────── Envoi & streaming ─────────────── */

function setStreaming(on) {
  state.streaming = on;
  $('sendBtn').hidden = on;
  $('stopBtn').hidden = !on;
  $('composerHint').textContent = on
    ? 'Umbra travaille… clique sur ■ pour arrêter.'
    : 'Entrée pour envoyer · Maj+Entrée ou ↵ pour aller à la ligne · 📎 pour joindre une photo, un PDF, un document';
}

function stopStreaming() {
  state.controller?.abort();
  state.controller = null;
  setStreaming(false);
}

async function sendMessage(text) {
  const content = String(text || '').trim();
  const joints = state.pending.filter((f) => !f.enCours && f.serveur);
  if ((!content && !joints.length) || state.streaming) return;
  if (state.uploading) {
    toast('Un instant : le fichier est encore en cours d\'envoi.', 'info');
    return;
  }

  const thread = ensureThread();
  const userMsg = {
    id: uid(),
    role: 'user',
    content,
    time: nowHHMM(),
    ...(joints.length
      ? {
          attachments: joints.map((f) => ({
            id: f.id,
            nom: f.nom,
            mime: f.mime,
            taille: f.taille,
            categorie: f.categorie,
            info: f.info,
          })),
        }
      : {}),
  };
  thread.messages.push(userMsg);
  if (thread.messages.filter((m) => m.role === 'user').length === 1) {
    const titre = (content || joints[0]?.nom || 'Pièce jointe').replace(/\s+/g, ' ').trim();
    thread.title = titre.slice(0, 48) + (titre.length > 48 ? '…' : '');
  }
  state.pending = [];
  renderPieces();
  thread.updatedAt = Date.now();
  persistThreads();

  $('input').value = '';
  autoGrow();
  renderThreads();
  renderHeader();
  $('welcome').hidden = true;
  $('messages').hidden = false;

  $('messages').appendChild(messageNode(userMsg));

  const assistant = {
    id: uid(),
    role: 'assistant',
    content: '',
    tools: [],
    time: nowHHMM(),
  };
  thread.messages.push(assistant);
  const node = messageNode(assistant);
  $('messages').appendChild(node);
  const prose = node.querySelector('.prose');
  prose.classList.add('cursor');
  scrollToBottom();

  setStreaming(true);
  state.controller = new AbortController();

  const history = thread.messages
    .filter((m) => m.id !== assistant.id && (m.role === 'user' || m.role === 'assistant') && (m.content || m.attachments?.length))
    .map((m) => ({
      role: m.role,
      content: m.content || '',
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    }));

  try {
    const res = await fetch(apiUrl('/api/chat'), net({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...llmHeaders(),
      },
      body: JSON.stringify({
        messages: history,
        mode: state.settings.mode,
        memories: state.memories,
        userName: state.settings.userName,
      }),
      signal: state.controller.signal,
    }));

    if (handleUnauthorized(res)) return;

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Le serveur a répondu ${res.status}.`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pending = false;

    const paint = () => {
      prose.innerHTML = renderMarkdown(assistant.content);
      pending = false;
      scrollToBottom();
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const line = chunk.trim();
        if (!line.startsWith('data:')) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        handleEvent(ev, { assistant, prose, node, paint: () => { if (!pending) { pending = true; requestAnimationFrame(paint); } } });
      }
    }
    prose.classList.remove('cursor');
    paint();
  } catch (e) {
    prose.classList.remove('cursor');
    if (e.name === 'AbortError') {
      assistant.content += '\n\n_(arrêté)_';
    } else {
      assistant.content = assistant.content || '';
      // Un « Failed to fetch » brut ne dit rien : on le traduit.
      assistant.error =
        e instanceof TypeError
          ? `Impossible de joindre le serveur (${getServer() || 'local'}). Vérifie l'adresse dans Réglages.`
          : e.message;
      node.querySelector('.msg-body').insertAdjacentHTML(
        'beforeend',
        `<div class="approval"><p>⚠️ ${escapeHtml(assistant.error)}</p><p class="help">Vérifie ta clé et ton modèle dans Réglages, ou réessaie.</p></div>`,
      );
    }
    prose.innerHTML = renderMarkdown(assistant.content);
  } finally {
    setStreaming(false);
    state.controller = null;
    thread.updatedAt = Date.now();
    persistThreads();
    if (state.settings.voiceReplies && assistant.content) speak(plainText(assistant.content));
  }
}

function handleEvent(ev, ctx) {
  const { assistant, prose, node, paint } = ctx;

  switch (ev.type) {
    case 'start': {
      state.health = { ...(state.health || {}), live: ev.mode === 'live' };
      renderHeader();
      break;
    }
    case 'delta': {
      assistant.content += ev.text || '';
      paint();
      break;
    }
    case 'tool_start': {
      const tool = { id: ev.id, name: ev.name, label: ev.label, args: ev.args, state: 'running' };
      assistant.tools.push(tool);
      let holder = node.querySelector('.tools-holder');
      if (!holder) {
        holder = document.createElement('div');
        holder.className = 'tools-holder';
        node.querySelector('.msg-body').insertBefore(holder, prose.nextSibling);
      }
      holder.appendChild(toolCard(tool));
      scrollToBottom();
      break;
    }
    case 'approval': {
      showApproval(ev, node);
      break;
    }
    case 'approval_result': {
      const card = node.querySelector(`[data-approval="${ev.id}"]`);
      if (card) {
        card.innerHTML = `<p>${ev.approved ? '✅ Action confirmée.' : '🚫 Action refusée.'}</p>`;
        setTimeout(() => card.remove(), 2500);
      }
      break;
    }
    case 'tool_end': {
      const tool = assistant.tools.find((t) => t.id === ev.id);
      if (tool) {
        tool.ok = ev.ok;
        tool.summary = ev.summary;
        tool.state = 'done';
        if (ev.client_action?.type === 'show_image') tool.image = ev.client_action.src;
        const old = node.querySelector(`[data-tool-id="${ev.id}"]`);
        if (old) old.replaceWith(toolCard(tool));
      }
      if (ev.client_action) runClientAction(ev.client_action);
      scrollToBottom();
      break;
    }
    case 'failover': {
      // Un cerveau a lâché : on le signale sans interrompre la conversation.
      toast(`${ev.de} indisponible — ${ev.vers} prend le relais.`, 'info');
      assistant.failover = assistant.failover || [];
      assistant.failover.push({ de: ev.de, vers: ev.vers });
      break;
    }
    case 'error': {
      assistant.content += `\n\n⚠️ **${ev.message}**`;
      paint();
      break;
    }
    case 'done':
      break;
    default:
      break;
  }
}

function showApproval(ev, node) {
  const box = document.createElement('div');
  box.className = 'approval';
  box.dataset.approval = ev.id;
  box.innerHTML = `
    <p><b>Umbra veut lancer :</b> ${escapeHtml(ev.label || ev.name)}</p>
    <pre style="margin:0 0 10px;font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;color:var(--fg-muted)">${escapeHtml(JSON.stringify(ev.args || {}, null, 2))}</pre>
    <div class="row">
      <button type="button" class="btn btn-primary" data-approve>Autoriser</button>
      <button type="button" class="btn btn-ghost" data-deny>Refuser</button>
    </div>`;
  const respond = async (approved) => {
    box.querySelectorAll('button').forEach((b) => (b.disabled = true));
    await fetch(apiUrl('/api/approve'), net({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ev.id, approved }),
    })).catch(() => {});
  };
  box.querySelector('[data-approve]').addEventListener('click', () => respond(true));
  box.querySelector('[data-deny]').addEventListener('click', () => respond(false));
  node.querySelector('.msg-body').appendChild(box);
  scrollToBottom();
}

function runClientAction(action) {
  if (!action || !action.type) return;
  if (action.type === 'memory_add') {
    const content = String(action.content || '').trim();
    if (content && !state.memories.includes(content)) {
      state.memories.push(content);
      save(LS.memories, state.memories);
      renderMemoryList();
      $('memoryCount').textContent = String(state.memories.length);
      toast('Souvenir ajouté à la mémoire.');
    }
  }
  if (action.type === 'memory_remove') {
    const q = String(action.query || '').toLowerCase();
    const before = state.memories.length;
    state.memories = state.memories.filter((m) => !m.toLowerCase().includes(q));
    save(LS.memories, state.memories);
    renderMemoryList();
    $('memoryCount').textContent = String(state.memories.length);
    if (before !== state.memories.length) toast(`${before - state.memories.length} souvenir(s) oublié(s).`);
  }
  if (action.type === 'open_url' && action.url) {
    window.open(action.url, '_blank', 'noopener');
    toast('Lien ouvert dans un nouvel onglet.');
  }
}

function regenerate(assistantId) {
  const thread = currentThread();
  if (!thread || state.streaming) return;
  const idx = thread.messages.findIndex((m) => m.id === assistantId);
  if (idx < 0) return;
  const lastUser = [...thread.messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
  if (!lastUser) return;
  thread.messages = thread.messages.slice(0, idx);
  persistThreads();
  renderChat();
  sendMessage(lastUser.content);
}

/* ─────────────── Réglages / clé API ─────────────── */

function llmHeaders() {
  const s = state.settings;
  const h = {};
  if (s.apiKey) h['x-llm-key'] = s.apiKey;
  if (s.baseUrl) h['x-llm-base'] = s.baseUrl;
  if (s.model) h['x-llm-model'] = s.model;
  return h;
}

function saveSettings() {
  save(LS.settings, state.settings);
}

function fillSettingsForm() {
  const s = state.settings;
  $('serverUrl').value = getServer();
  $('providerSelect').value = s.provider;
  $('baseUrl').value = s.baseUrl;
  $('apiKey').value = s.apiKey;
  $('apiKey').placeholder = PROVIDERS[s.provider]?.keyHint || 'Clé API (stockée uniquement sur cet appareil)';
  $('model').value = s.model;
  $('voiceReplies').checked = s.voiceReplies;
  $('voiceRate').value = String(s.voiceRate);
  $('rateLabel').textContent = Number(s.voiceRate).toFixed(1);
  $('userName').value = s.userName;
}

function handleUnauthorized(res) {
  if (res && res.status === 401) {
    setToken('');
    if (isNativeShell()) {
      // Dans l'APK, on ne quitte pas l'application vers la page de connexion
      // du serveur (on perdrait la dictée native) : on réaffiche l'écran local.
      const screen = $('connectScreen');
      if (screen) {
        screen.hidden = false;
        const status = $('connectStatus');
        if (status) {
          status.className = 'connect-status err';
          status.textContent = 'Session expirée. Saisis à nouveau le mot de passe.';
        }
        $('connectPassword')?.focus();
      }
    } else {
      window.location.href = apiUrl('/login');
    }
    return true;
  }
  return false;
}

async function refreshHealth() {
  try {
    const res = await fetch(apiUrl('/api/health'), net({ headers: llmHeaders() }));
    state.health = await res.json();
  } catch {
    state.health = { live: false, tools: [] };
  }
  renderHeader();
  renderCaps();
  $('logoutBtn').hidden = !state.health?.auth;
}

/* ─────────────── Mémoire ─────────────── */

function renderMemoryList() {
  const list = $('memoryList');
  const items = state.memories;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<li class="memory-empty">Aucun souvenir pour l’instant.</li>';
    return;
  }
  items.forEach((m, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = m;

    const edit = document.createElement('button');
    edit.className = 'icon-btn tiny';
    edit.innerHTML = '✎';
    edit.title = 'Modifier';
    edit.addEventListener('click', () => {
      const input = document.createElement('input');
      input.value = m;
      li.replaceChildren(input);
      input.focus();
      const commit = () => {
        const v = input.value.trim();
        if (v) {
          state.memories[i] = v;
          save(LS.memories, state.memories);
        }
        renderMemoryList();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') renderMemoryList();
      });
      input.addEventListener('blur', commit);
    });

    const del = document.createElement('button');
    del.className = 'icon-btn tiny';
    del.innerHTML = '🗑';
    del.title = 'Supprimer';
    del.addEventListener('click', () => {
      state.memories.splice(i, 1);
      save(LS.memories, state.memories);
      renderMemoryList();
      $('memoryCount').textContent = String(state.memories.length);
    });

    li.append(span, edit, del);
    list.appendChild(li);
  });
}

/* ─────────────── Voix ─────────────── */

let recognition = null;
let listening = false;

/** Le WebView Android n'implémente pas SpeechRecognition : on passe par le plugin natif. */
const nativeSpeech = () =>
  window.Capacitor?.Plugins?.SpeechRecognition ||
  (window.Capacitor?.isNativePlatform?.() ? window.Capacitor?.Plugins?.SpeechRecognition : null);

async function listenNatively() {
  const plugin = nativeSpeech();
  if (!plugin) return false;
  try {
    const perm = await plugin.checkPermissions();
    if (perm?.speechRecognition !== 'granted') {
      const asked = await plugin.requestPermissions();
      if (asked?.speechRecognition !== 'granted') {
        toast('Micro refusé : autorise le microphone dans Android.', 'error');
        return true;
      }
    }
    listening = true;
    $('micBtn').classList.add('listening');
    $('composerHint').textContent = '🎙️ Je t’écoute…';
    plugin.addListener('partialResults', (data) => {
      const text = data?.matches?.[0];
      if (text) {
        $('input').value = text;
        autoGrow();
      }
    });
    await plugin.start({
      language: 'fr-FR',
      maxResults: 1,
      prompt: 'Parle à Umbra',
      partialResults: true,
      popup: false,
    });
    return true;
  } catch (e) {
    listening = false;
    $('micBtn').classList.remove('listening');
    $('composerHint').textContent = 'Entrée pour envoyer · Maj+Entrée pour un retour à la ligne';
    toast(`Dictée indisponible : ${e?.message || e}`, 'error');
    return true;
  }
}

function stopNativeListening() {
  const plugin = nativeSpeech();
  plugin?.stop?.().catch?.(() => {});
  listening = false;
  $('micBtn').classList.remove('listening');
  $('composerHint').textContent = 'Entrée pour envoyer · Maj+Entrée pour un retour à la ligne';
  const text = $('input').value.trim();
  if (text) sendMessage(text);
}

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text.slice(0, 4000));
  utter.lang = 'fr-FR';
  utter.rate = Number(state.settings.voiceRate) || 1;
  const voices = window.speechSynthesis.getVoices();
  const fr = voices.find((v) => /fr[-_]FR/i.test(v.lang)) || voices.find((v) => /^fr/i.test(v.lang));
  if (fr) utter.voice = fr;
  window.speechSynthesis.speak(utter);
}

function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    if (nativeSpeech()) {
      // APK Android : reconnaissance vocale native
      nativeSpeech()
        .addListener('listeningState', (data) => {
          if (data?.status === 'stopped' && listening) stopNativeListening();
        })
        .catch?.(() => {});
      return;
    }
    $('micBtn').title = 'Dictée non prise en charge par ce navigateur (utilise Chrome ou Edge).';
    $('micBtn').addEventListener('click', () =>
      toast('La dictée nécessite Chrome, Edge, Safari — ou l’application Android.', 'error'),
    );
    return;
  }
  recognition = new SR();
  recognition.lang = 'fr-FR';
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    $('micBtn').classList.add('listening');
    $('micBtn').setAttribute('aria-pressed', 'true');
    $('composerHint').textContent = '🎙️ Je t’écoute…';
  };
  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += transcript;
      else interim += transcript;
    }
    $('input').value = final || interim;
    autoGrow();
    if (final.trim()) {
      const text = final.trim();
      setTimeout(() => sendMessage(text), 220);
    }
  };
  recognition.onerror = (e) => {
    listening = false;
    $('micBtn').classList.remove('listening');
    if (e.error === 'not-allowed') toast('Micro refusé : autorise le microphone dans le navigateur.', 'error');
    else if (e.error !== 'aborted') toast(`Dictée : ${e.error}`, 'error');
  };
  recognition.onend = () => {
    listening = false;
    $('micBtn').classList.remove('listening');
    $('micBtn').setAttribute('aria-pressed', 'false');
    $('composerHint').textContent = 'Entrée pour envoyer · Maj+Entrée pour un retour à la ligne';
  };
}

async function toggleMic() {
  if (nativeSpeech()) {
    if (listening) {
      stopNativeListening();
      return;
    }
    await listenNatively();
    return;
  }
  if (!recognition) {
    toast('La dictée nécessite Chrome, Edge ou Safari — ou l’application Android.', 'error');
    return;
  }
  if (listening) {
    recognition.stop();
    return;
  }
  try {
    recognition.start();
  } catch {
    recognition.stop();
  }
}

/* ─────────────── Écran de connexion au serveur (APK, autre machine) ─────────────── */

const normalizeServer = (raw) => {
  let v = String(raw || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    // Une IP locale ou un .local reste en http, le reste passe en https
    const local = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$|^[a-z0-9-]+\.local(:\d+)?$|^localhost(:\d+)?$/i.test(v);
    v = `${local ? 'http' : 'https'}://${v}`;
  }
  return v;
};

async function testServer(url) {
  const res = await fetch(`${url}/api/health`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Le serveur répond ${res.status}.`);
  return res.json();
}

/** Tente d'ouvrir une session ; renvoie le jeton ou lève une erreur explicite. */
async function loginTo(url, password) {
  const res = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password }),
  });
  if (res.status === 429) throw new Error('Trop de tentatives. Patiente 10 minutes.');
  if (res.status === 401) throw new Error('Mot de passe incorrect.');
  if (!res.ok) throw new Error(`Connexion refusée (${res.status}).`);
  const data = await res.json().catch(() => ({}));
  return data.token || '';
}

function wireConnectScreen() {
  const screen = $('connectScreen');
  const input = $('connectUrl');
  const pass = $('connectPassword');
  const status = $('connectStatus');
  const btn = $('connectBtn');

  screen.hidden = false;
  input.value = getServer() || '';
  pass.value = '';

  const go = async () => {
    const url = normalizeServer(input.value);
    if (!url) {
      status.className = 'connect-status err';
      status.textContent = 'Indique une adresse.';
      return;
    }
    btn.disabled = true;
    status.className = 'connect-status';
    status.textContent = 'Connexion…';
    try {
      const health = await testServer(url);
      const token = await loginTo(url, pass.value || '');
      setServer(url);
      setToken(token);
      status.className = 'connect-status ok';
      status.textContent = `Connecté${health?.model ? ` · ${health.model}` : ''}. Ouverture…`;
      setTimeout(() => window.location.reload(), 350);
    } catch (e) {
      status.className = 'connect-status err';
      const msg = String(e.message || '');
      status.textContent = msg.includes('Mot de passe') || msg.includes('tentatives')
        ? msg
        : `Impossible de joindre ${url.replace(/^https?:\/\//, '')}. ${msg}`;
      if (msg.includes('Mot de passe')) pass.focus();
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', go);
  for (const el of [input, pass]) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    });
  }
  input.focus();
}

/* ─────────────── Interface : divers ─────────────── */

function autoGrow() {
  const el = $('input');
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
}

function openSidebar() {
  $('sidebar').classList.add('open');
  $('scrim').hidden = false;
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('scrim').hidden = true;
}

function setMode(mode) {
  state.settings.mode = mode;
  saveSettings();
  renderModes();
}

/* ─────────────── Export / import ─────────────── */

/**
 * Le carnet de notes vit sur le serveur, pas dans le navigateur : il faut le
 * demander à l'API. Sur un hébergement à disque éphémère, c'est la seule façon
 * de ne pas perdre les notes au redéploiement.
 */
async function notesDuServeur() {
  try {
    const r = await fetch(apiUrl('/api/notes/export'), net());
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d.notes) ? d.notes : null;
  } catch {
    return null;
  }
}

async function pousserNotes(notes) {
  try {
    const r = await fetch(
      apiUrl('/api/notes/import'),
      net({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) }),
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function exportData() {
  toast('Préparation de l\'export…');
  const notes = await notesDuServeur();
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: { ...state.settings, apiKey: '' },
    threads: state.threads,
    memories: state.memories,
    notes: notes || [],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `umbra-donnees-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  if (notes === null) toast('Données exportées (sans la clé API). Carnet de notes injoignable.', 'info');
  else toast(`Données exportées : conversations, souvenirs et ${notes.length} note(s).`);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.threads)) state.threads = data.threads;
      if (Array.isArray(data.memories)) state.memories = data.memories;
      if (data.settings) state.settings = { ...state.settings, ...data.settings, apiKey: state.settings.apiKey };
      persistThreads();
      save(LS.memories, state.memories);
      saveSettings();
      renderAll();
      const notes = Array.isArray(data.notes) ? data.notes : [];
      if (!notes.length) {
        toast('Données importées.');
        return;
      }
      pousserNotes(notes).then((res) => {
        if (!res) toast('Données importées, mais le carnet n\'a pas pu être restauré.', 'error');
        else if (res.skipped?.length) toast(`Données importées : ${res.imported} note(s) restaurée(s), ${res.skipped.length} ignorée(s).`);
        else toast(`Données importées : ${res.imported} note(s) restaurée(s).`);
      });
      toast('Données importées.');
    } catch {
      toast('Fichier invalide.', 'error');
    }
  };
  reader.readAsText(file);
}

/* ─────────────── PWA ─────────────── */

let deferredPrompt = null;

function setupInstall() {
  const btn = $('installBtn');
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.hidden = false;
  });

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS && !standalone) btn.hidden = false;

  btn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      toast(outcome === 'accepted' ? 'Installation lancée.' : 'Installation annulée.');
      deferredPrompt = null;
      btn.hidden = true;
      return;
    }
    if (isIOS) {
      alert(
        'Pour installer Umbra sur iPhone / iPad :\n\n1. Ouvre cette page dans Safari\n2. Touche le bouton Partager (carré avec une flèche)\n3. « Sur l’écran d’accueil »\n4. Ajoute\n\nUmbra aura alors sa propre icône, en plein écran.',
      );
      return;
    }
    alert(
      'Pour installer Umbra :\n\n• Chrome / Edge (ordinateur) : icône ⊕ dans la barre d’adresse → « Installer ».\n• Android : menu ⋮ → « Installer l’application ».\n\nL’app s’ouvrira ensuite comme un logiciel, sans barre d’adresse.',
    );
  });

  /* ── service worker ──
     • Dans l'APK, les fichiers sont déjà embarqués : un service worker n'apporte
       rien et peut servir une ancienne version (boutons inertes après mise à
       jour). On le désinscrit et on vide son cache.
     • Sur le web, on l'enregistre et on recharge une seule fois quand une
       nouvelle version prend la main, pour ne jamais mélanger ancien HTML et
       nouveau JavaScript. */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    if (isNativeShell()) {
      navigator.serviceWorker
        .getRegistrations()
        .then((rs) => Promise.all(rs.map((r) => r.unregister())))
        .catch(() => {});
      if (window.caches) {
        caches
          .keys()
          .then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
          .catch(() => {});
      }
    } else if (!getServer()) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => {
          let dejaRecharge = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (dejaRecharge) return;
            dejaRecharge = true;
            try {
              if (sessionStorage.getItem('umbra.recharge') === 'fait') return;
              sessionStorage.setItem('umbra.recharge', 'fait');
            } catch {
              /* stockage indisponible : on recharge quand même, une seule fois */
            }
            location.reload();
          });
        })
        .catch(() => {});
    }
  }
}

/* ─────────────── Démarrage ─────────────── */

/** Attache un écouteur si l'élément existe : un bouton manquant ne doit pas
 *  empêcher les autres de fonctionner. */
function sur(id, evenement, action) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evenement, action);
  return el;
}

function wire() {
  $('newChat').addEventListener('click', newThread);
  $('menuBtn').addEventListener('click', openSidebar);
  $('sidebarClose').addEventListener('click', closeSidebar);
  $('scrim').addEventListener('click', closeSidebar);
  $('searchThreads').addEventListener('input', renderThreads);

  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage($('input').value);
  });
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage($('input').value);
    }
  });
  $('input').addEventListener('input', autoGrow);
  $('micBtn').addEventListener('click', toggleMic);
  $('stopBtn').addEventListener('click', stopStreaming);

  /* ── pièces jointes ── */
  sur('clipBtn', 'click', () => $('fileInput')?.click());
  sur('fileInput', 'change', (e) => {
    ajouterFichiers(e.target.files);
    e.target.value = ''; // permet de renvoyer deux fois le même fichier
  });

  // Coller une image depuis le presse-papiers (Ctrl+V)
  $('input').addEventListener('paste', (e) => {
    const fichiers = [...(e.clipboardData?.files || [])];
    if (!fichiers.length) return;
    e.preventDefault();
    ajouterFichiers(fichiers);
  });

  // Glisser-déposer, où que ce soit dans la fenêtre
  let profondeur = 0;
  const contientDesFichiers = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!contientDesFichiers(e)) return;
    profondeur++;
    $('dropVeil').hidden = false;
  });
  document.addEventListener('dragover', (e) => {
    if (contientDesFichiers(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  document.addEventListener('dragleave', () => {
    profondeur = Math.max(0, profondeur - 1);
    if (!profondeur) $('dropVeil').hidden = true;
  });
  document.addEventListener('drop', (e) => {
    if (!contientDesFichiers(e)) return;
    e.preventDefault();
    profondeur = 0;
    $('dropVeil').hidden = true;
    ajouterFichiers(e.dataTransfer.files);
  });

  /* ── bouton « aller à la ligne », séparé de l'envoi ── */
  sur('newlineBtn', 'click', () => {
    const el = $('input');
    if (!el) return;
    const debut = el.selectionStart ?? el.value.length;
    const fin = el.selectionEnd ?? debut;
    el.value = `${el.value.slice(0, debut)}\n${el.value.slice(fin)}`;
    el.selectionStart = el.selectionEnd = debut + 1;
    el.focus();
    autoGrow();
  });

  $('suggestions').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) sendMessage(chip.dataset.prompt);
  });

  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('voiceToggle').addEventListener('click', () => {
    state.settings.voiceReplies = !state.settings.voiceReplies;
    saveSettings();
    $('voiceToggle').setAttribute('aria-pressed', String(state.settings.voiceReplies));
    toast(state.settings.voiceReplies ? 'Umbra parlera à voix haute.' : 'Lecture vocale désactivée.');
    if (state.settings.voiceReplies) speak('À votre service.');
  });

  // Réglages
  $('openSettings').addEventListener('click', () => {
    fillSettingsForm();
    $('settingsModal').showModal();
  });
  $('saveServer').addEventListener('click', async () => {
    const url = normalizeServer($('serverUrl').value);
    if (url === getServer()) {
      toast('Serveur inchangé.');
      return;
    }
    if (url) {
      try {
        await testServer(url);
      } catch (e) {
        toast(`Serveur injoignable : ${e.message}`, 'error');
        return;
      }
    }
    setServer(url);
    toast('Serveur enregistré. Rechargement…');
    setTimeout(() => window.location.reload(), 500);
  });

  $('providerSelect').addEventListener('change', (e) => {
    const p = PROVIDERS[e.target.value];
    state.settings.provider = e.target.value;
    if (p) {
      state.settings.baseUrl = p.baseUrl;
      state.settings.model = p.model;
      $('baseUrl').value = p.baseUrl;
      $('model').value = p.model;
      $('apiKey').placeholder = p.keyHint || 'Clé API (stockée uniquement sur cet appareil)';
    }
    saveSettings();
    refreshHealth();
  });
  $('baseUrl').addEventListener('change', (e) => {
    state.settings.baseUrl = e.target.value.trim();
    saveSettings();
  });
  $('apiKey').addEventListener('change', (e) => {
    state.settings.apiKey = e.target.value.trim();
    saveSettings();
    refreshHealth();
  });
  $('model').addEventListener('change', (e) => {
    state.settings.model = e.target.value.trim();
    saveSettings();
  });
  $('userName').addEventListener('change', (e) => {
    state.settings.userName = e.target.value.trim() || 'Monsieur';
    saveSettings();
    $('userName').value = state.settings.userName;
  });
  $('voiceReplies').addEventListener('change', (e) => {
    state.settings.voiceReplies = e.target.checked;
    saveSettings();
    $('voiceToggle').setAttribute('aria-pressed', String(e.target.checked));
  });
  $('voiceRate').addEventListener('input', (e) => {
    state.settings.voiceRate = Number(e.target.value);
    $('rateLabel').textContent = Number(e.target.value).toFixed(1);
    saveSettings();
  });
  $('testVoice').addEventListener('click', () => speak('Bonjour, je suis Umbra. À votre service.'));

  $('testConn').addEventListener('click', async () => {
    const out = $('testResult');
    out.className = 'test-result';
    out.textContent = 'Test…';
    try {
      const res = await fetch(apiUrl('/api/models'), net({ headers: llmHeaders() }));
      const data = await res.json();
      if (data.demo) {
        out.classList.add('err');
        out.textContent = 'Aucune clé enregistrée — mode démo.';
      } else if (data.error) {
        out.classList.add('err');
        out.textContent = data.error;
      } else {
        out.classList.add('ok');
        out.textContent = `Connecté · ${data.models.length} modèles disponibles.`;
      }
    } catch (e) {
      out.classList.add('err');
      out.textContent = 'Serveur injoignable.';
    }
  });

  $('fetchModels').addEventListener('click', async () => {
    const box = $('modelList');
    box.hidden = false;
    box.innerHTML = '<span class="help">Chargement…</span>';
    try {
      const res = await fetch(apiUrl('/api/models'), net({ headers: llmHeaders() }));
      const data = await res.json();
      if (!data.models?.length) {
        box.innerHTML = `<span class="help">${data.error || 'Aucun modèle (clé absente ?).'}</span>`;
        return;
      }
      box.innerHTML = '';
      for (const m of data.models.slice(0, 60)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'model-item';
        b.textContent = m;
        b.addEventListener('click', () => {
          $('model').value = m;
          state.settings.model = m;
          saveSettings();
          toast(`Modèle : ${m}`);
        });
        box.appendChild(b);
      }
    } catch {
      box.innerHTML = '<span class="help">Serveur injoignable.</span>';
    }
  });

  $('exportData').addEventListener('click', exportData);
  $('importData').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => e.target.files[0] && importData(e.target.files[0]));
  $('wipeData').addEventListener('click', () => {
    if (!confirm('Effacer toutes les conversations, souvenirs et réglages ? Cette action est définitive.')) return;
    Object.values(LS).forEach((k) => localStorage.removeItem(k));
    location.reload();
  });

  // Mémoire
  $('openMemory').addEventListener('click', () => {
    renderMemoryList();
    $('memoryModal').showModal();
    closeSidebar();
  });
  const addMemory = () => {
    const v = $('memoryInput').value.trim();
    if (!v) return;
    if (!state.memories.includes(v)) state.memories.push(v);
    save(LS.memories, state.memories);
    $('memoryInput').value = '';
    renderMemoryList();
    $('memoryCount').textContent = String(state.memories.length);
  };
  $('memoryAdd').addEventListener('click', addMemory);
  $('memoryInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addMemory();
    }
  });
  $('clearMemories').addEventListener('click', () => {
    if (!state.memories.length) return;
    if (!confirm('Effacer tous les souvenirs ?')) return;
    state.memories = [];
    save(LS.memories, state.memories);
    renderMemoryList();
    $('memoryCount').textContent = '0';
  });

  $('openAbout').addEventListener('click', () => {
    $('aboutBuild').textContent = `build ${new Date().toISOString().slice(0, 10)}`;
    $('aboutModal').showModal();
    closeSidebar();
  });

  $('logoutBtn').addEventListener('click', async () => {
    await fetch(apiUrl('/api/logout'), net({ method: 'POST' })).catch(() => {});
    setToken('');
    if (isNativeShell()) {
      window.location.reload();
    } else {
      window.location.href = apiUrl('/login');
    }
  });

  // Fermeture des modales
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog')?.close()),
  );

  // Copier un bloc de code
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const code = btn.closest('pre')?.querySelector('code')?.textContent || '';
    navigator.clipboard.writeText(code).then(() => toast('Code copié.'));
  });

  // Raccourcis
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      newThread();
    }
    if (e.key === 'Escape') closeSidebar();
  });

  window.addEventListener('online', () => toast('De retour en ligne.'));
  window.addEventListener('offline', () => toast('Hors ligne : les outils réseau seront indisponibles.', 'error'));
}

async function init() {
  if (isNativeShell() && !getServer()) {
    wireConnectScreen();
    return;
  }
  wire();
  initVoice();
  setupInstall();
  fillSettingsForm();
  $('voiceToggle').setAttribute('aria-pressed', String(state.settings.voiceReplies));
  renderModes();
  if (!state.threads.length) ensureThread();
  if (!currentThread()) state.currentId = state.threads[0]?.id || null;
  renderAll();
  await refreshHealth();
  $('brandVersion').textContent = `v${state.health?.version || '2.1.1'}`;
  const info = $('versionInfo');
  if (info) {
    const natif = isNativeShell() ? 'application Android' : 'navigateur';
    const cache = 'serviceWorker' in navigator && navigator.serviceWorker.controller ? ' · cache actif' : '';
    info.textContent = `Interface ${INTERFACE_VERSION} (${natif})${cache} — serveur ${state.health?.version || 'hors ligne'}`;
  }
  $('input').focus();
}

init();
