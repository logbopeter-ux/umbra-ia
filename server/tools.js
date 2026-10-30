/**
 * Umbra IA — Outils (les « mains » d'Umbra)
 * Chaque outil décrit ce qu'il fait en français : c'est cette description que
 * le modèle lit pour décider quand l'utiliser.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const NOTES = path.join(DATA, 'notes');
const SHOTS = path.join(DATA, 'screenshots');
const PYDIR = path.join(DATA, 'python');

const TZ = process.env.UMBRA_TIMEZONE || 'Africa/Porto-Novo';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const truncate = (s, n = 4000) => (s.length > n ? s.slice(0, n) + '\n…[tronqué]' : s);

async function ensureDirs() {
  await Promise.all([
    fs.mkdir(NOTES, { recursive: true }),
    fs.mkdir(SHOTS, { recursive: true }),
    fs.mkdir(PYDIR, { recursive: true }),
  ]);
}

/* ─────────────────────────── Recherche web (DuckDuckGo) ─────────────────────────── */

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

function decodeDdg(href) {
  try {
    const u = href.startsWith('//') ? 'https:' + href : href;
    const m = u.match(/[?&]uddg=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : u;
  } catch {
    return href;
  }
}

async function webSearch({ query, max = 6 }) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' } });
  if (!res.ok) throw new Error(`DuckDuckGo a répondu ${res.status}`);
  const html = await res.text();

  const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)];

  const results = links.slice(0, max).map((m, i) => ({
    title: stripTags(m[2]),
    url: decodeDdg(m[1]),
    snippet: snippets[i] ? stripTags(snippets[i][1]) : '',
  }));

  if (!results.length) return { summary: `Aucun résultat pour « ${query} ».`, results: [] };

  const summary = results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`)
    .join('\n\n');

  return { summary: `Résultats pour « ${query} » :\n\n${summary}`, results };
}

/* ─────────────────────────── Lecture d'une page ─────────────────────────── */

async function fetchPage({ url }) {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const res = await fetch(target, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' },
    redirect: 'follow',
  });
  const html = await res.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || target;
  const cleaned = stripTags(html);
  return {
    summary: `Page « ${stripTags(title)} » (${res.status})\n\n${truncate(cleaned, 6000)}`,
    data: { url: res.url || target, status: res.status, title: stripTags(title), text: truncate(cleaned, 20000) },
  };
}

/* ─────────────────────────── Calculatrice (parseur sûr) ─────────────────────────── */

export function evaluateExpression(input) {
  const src = String(input)
    .replace(/,/g, '.')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\^/g, '**')
    .replace(/\bpi\b/gi, String(Math.PI))
    .replace(/\be\b/g, String(Math.E));
  if (!/^[0-9\s+\-*/().%*]+$/.test(src)) throw new Error('Expression non autorisée (chiffres et opérateurs uniquement).');

  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const peek = () => {
    ws();
    return src[i];
  };

  function parseExpr() {
    let v = parseTerm();
    for (;;) {
      const c = peek();
      if (c === '+') { i++; v += parseTerm(); }
      else if (c === '-') { i++; v -= parseTerm(); }
      else return v;
    }
  }
  function parseTerm() {
    let v = parseUnary();
    for (;;) {
      const c = peek();
      if (c === '*') {
        i++;
        if (src[i] === '*') { i++; v = Math.pow(v, parseUnary()); } else v *= parseUnary();
      } else if (c === '/') { i++; v /= parseUnary(); }
      else if (c === '%') { i++; v %= parseUnary(); }
      else return v;
    }
  }
  function parseUnary() {
    const c = peek();
    if (c === '-') { i++; return -parseUnary(); }
    if (c === '+') { i++; return parseUnary(); }
    return parseAtom();
  }
  function parseAtom() {
    const c = peek();
    if (c === '(') {
      i++;
      const v = parseExpr();
      if (peek() !== ')') throw new Error('Parenthèse fermante manquante');
      i++;
      return v;
    }
    const start = i;
    while (i < src.length && /[0-9.]/.test(src[i])) i++;
    if (start === i) throw new Error(`Caractère inattendu : « ${c} »`);
    return parseFloat(src.slice(start, i));
  }

  const value = parseExpr();
  ws();
  if (i < src.length) throw new Error(`Reste non analysé : « ${src.slice(i)} »`);
  if (!Number.isFinite(value)) throw new Error('Résultat non calculable');
  return value;
}

/* ─────────────────────────── Carnet de notes (fichiers locaux) ─────────────────────────── */

const slug = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'note';

async function notes({ action = 'list', name = '', content = '' }) {
  await ensureDirs();
  const file = name ? path.join(NOTES, `${slug(name)}.md`) : null;

  if (action === 'list') {
    const files = (await fs.readdir(NOTES)).filter((f) => f.endsWith('.md'));
    if (!files.length) return { summary: 'Le carnet est vide.' };
    const items = await Promise.all(
      files.map(async (f) => {
        const st = await fs.stat(path.join(NOTES, f));
        return `- ${f.replace(/\.md$/, '')} (${st.size} octets, ${st.mtime.toLocaleDateString('fr-FR')})`;
      }),
    );
    return { summary: `Notes enregistrées :\n${items.join('\n')}`, data: files };
  }

  if (action === 'read') {
    if (!file) throw new Error('Précise le nom de la note.');
    const txt = await fs.readFile(file, 'utf8').catch(() => null);
    if (txt === null) throw new Error(`Aucune note nommée « ${name} ».`);
    return { summary: `Contenu de « ${slug(name)} » :\n\n${truncate(txt, 5000)}` };
  }

  if (action === 'write' || action === 'append') {
    if (!file) throw new Error('Précise le nom de la note.');
    if (action === 'append') await fs.appendFile(file, `\n${content}\n`, 'utf8');
    else await fs.writeFile(file, content, 'utf8');
    return { summary: `Note « ${slug(name)} » ${action === 'append' ? 'complétée' : 'enregistrée'} (${content.length} caractères).` };
  }

  if (action === 'delete') {
    if (!file) throw new Error('Précise le nom de la note.');
    await fs.unlink(file).catch(() => {
      throw new Error(`Aucune note nommée « ${name} ».`);
    });
    return { summary: `Note « ${slug(name)} » supprimée.` };
  }

  throw new Error(`Action inconnue : ${action}`);
}

/* ─────────────────────────── Python local ─────────────────────────── */

function runProcess(cmd, args, { cwd, timeout = 12000, stdin = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = '';
    let err = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: '', err: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, killed });
    });
    if (stdin) child.stdin.end(stdin);
  });
}

async function runPython({ code }) {
  await ensureDirs();
  const file = path.join(PYDIR, `run-${Date.now()}.py`);
  await fs.writeFile(file, code, 'utf8');
  const bin = process.env.UMBRA_PYTHON || 'python3';
  const r = await runProcess(bin, ['-I', file], { cwd: PYDIR, timeout: 12000 });
  const body = [r.out && r.out.trim(), r.err && `STDERR:\n${r.err.trim()}`].filter(Boolean).join('\n\n') || '(aucune sortie)';
  const summary = `${r.killed ? '⏱ Exécution interrompue (12 s max).\n' : ''}Code ${r.code} :\n${truncate(body, 4000)}`;
  return { summary, data: { code: r.code, stdout: r.out, stderr: r.err } };
}

/* ─────────────────────────── Navigateur (Playwright) ─────────────────────────── */

let browserCtx = { browser: null, page: null };

async function getPage() {
  let pw;
  try {
    pw = await import('playwright');
  } catch {
    throw new Error(
      "Playwright n'est pas installé. Lance : npm i playwright && npx playwright install chromium",
    );
  }
  if (!browserCtx.browser) {
    browserCtx.browser = await pw.chromium.launch({ headless: false }).catch(() => pw.chromium.launch({ headless: true }));
    const context = await browserCtx.browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 800 } });
    browserCtx.page = await context.newPage();
  }
  if (!browserCtx.page || browserCtx.page.isClosed()) {
    const context = await browserCtx.browser.newContext({ locale: 'fr-FR' });
    browserCtx.page = await context.newPage();
  }
  return browserCtx.page;
}

async function browserControl({ action, url, selector, text, key, seconds }) {
  await ensureDirs();
  const page = action === 'close' ? null : await getPage();

  switch (action) {
    case 'goto': {
      if (!url) throw new Error('Adresse manquante.');
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await page.title();
      return { summary: `Page ouverte : « ${title} » (${page.url()}).` };
    }
    case 'read': {
      const text2 = await page.evaluate(() => document.body?.innerText || '');
      return { summary: `Contenu visible de ${page.url()} :\n\n${truncate(text2.replace(/\n{3,}/g, '\n\n'), 5000)}` };
    }
    case 'click': {
      if (!selector) throw new Error('Sélecteur manquant.');
      await page.click(selector, { timeout: 15000 });
      await page.waitForTimeout(600);
      return { summary: `Clic effectué sur « ${selector} ». Page actuelle : ${page.url()}` };
    }
    case 'type': {
      if (!selector) throw new Error('Sélecteur manquant.');
      await page.fill(selector, text ?? '', { timeout: 15000 });
      return { summary: `Texte saisi dans « ${selector} ».` };
    }
    case 'press': {
      await page.keyboard.press(key || 'Enter');
      await page.waitForTimeout(600);
      return { summary: `Touche « ${key || 'Enter'} » pressée. Page : ${page.url()}` };
    }
    case 'back': {
      await page.goBack({ timeout: 15000 });
      return { summary: `Retour arrière. Page actuelle : ${page.url()}` };
    }
    case 'forward': {
      await page.goForward({ timeout: 15000 });
      return { summary: `Page suivante : ${page.url()}` };
    }
    case 'scroll': {
      await page.mouse.wheel(0, Number(seconds || 800));
      return { summary: 'Défilement effectué.' };
    }
    case 'screenshot': {
      const name = `capture-${Date.now()}.png`;
      const full = path.join(SHOTS, name);
      await page.screenshot({ path: full, fullPage: false });
      return {
        summary: `Capture d'écran enregistrée : /screenshots/${name}`,
        data: { image: `/screenshots/${name}`, url: page.url() },
        client_action: { type: 'show_image', src: `/screenshots/${name}`, caption: 'Capture du navigateur' },
      };
    }
    case 'current': {
      const title = await page.title().catch(() => '');
      return { summary: `Onglet actif : « ${title} » — ${page.url()}` };
    }
    case 'close': {
      if (browserCtx.browser) await browserCtx.browser.close().catch(() => {});
      browserCtx = { browser: null, page: null };
      return { summary: 'Navigateur fermé.' };
    }
    default:
      throw new Error(`Action navigateur inconnue : ${action}. Utilise goto, read, click, type, press, back, forward, scroll, screenshot, current ou close.`);
  }
}

/* ─────────────────────────── Commande système (désactivée par défaut) ─────────────────────────── */

async function systemCommand({ command }) {
  if (process.env.UMBRA_ALLOW_SHELL !== '1') {
    throw new Error("L'outil system_command est désactivé. Ajoute UMBRA_ALLOW_SHELL=1 dans .env pour l'activer.");
  }
  const allow = (process.env.UMBRA_SHELL_ALLOWLIST || 'ls,cat,echo,pwd,date,df,uname')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bin = String(command).trim().split(/\s+/)[0];
  if (!allow.includes(bin)) throw new Error(`Commande « ${bin} » non autorisée. Autorisées : ${allow.join(', ')}`);
  const r = await runProcess('/bin/sh', ['-c', command], { timeout: 15000 });
  return {
    summary: `$ ${command}\n(code ${r.code})\n${truncate([r.out, r.err].filter(Boolean).join('\n').trim() || '(aucune sortie)', 3000)}`,
  };
}

/* ─────────────────────────── Définitions exposées au modèle ─────────────────────────── */

const S = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

export const TOOL_DEFS = [
  {
    name: 'web_search',
    label: 'Recherche web',
    risky: false,
    description:
      "Cherche sur internet (DuckDuckGo) des informations actuelles. À utiliser pour la météo, l'actualité, les prix, les horaires, un fait récent ou tout ce que tu ignores.",
    parameters: S({ query: str('La requête de recherche, en français.'), max: { type: 'number', description: 'Nombre de résultats (1-10).' } }, ['query']),
    run: (a) => webSearch(a),
  },
  {
    name: 'fetch_page',
    label: 'Lecture de page',
    risky: false,
    description: "Ouvre une adresse web et renvoie le texte lisible de la page. Utile pour lire un article, une documentation, une offre d'emploi…",
    parameters: S({ url: str("L'adresse de la page à lire.") }, ['url']),
    run: (a) => fetchPage(a),
  },
  {
    name: 'calculator',
    label: 'Calculatrice',
    risky: false,
    description: 'Calcule une expression arithmétique exacte (+, -, *, /, %, parenthèses, puissances avec **). À utiliser dès qu\'un calcul est demandé.',
    parameters: S({ expression: str('Expression à calculer, par exemple "(1250*0.18)+75".') }, ['expression']),
    run: async ({ expression }) => {
      const v = evaluateExpression(expression);
      return { summary: `${expression} = ${v}` };
    },
  },
  {
    name: 'get_current_datetime',
    label: 'Date et heure',
    risky: false,
    description: "Renvoie la date, l'heure et le jour de la semaine actuels dans le fuseau de l'utilisateur.",
    parameters: S({}, []),
    run: async () => {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('fr-FR', {
        timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      return { summary: `Nous sommes le ${fmt.format(now)} (${TZ}).` };
    },
  },
  {
    name: 'remember',
    label: 'Mémorisation',
    risky: false,
    description:
      "Enregistre durablement un fait utile sur l'utilisateur (préférence, contexte, projet, prénom des proches). Jamais de mot de passe ni de donnée bancaire.",
    parameters: S({ content: str('Le fait à retenir, formulé à la 1re personne du point de vue utilisateur (ex. « Je suis végétarien »).') }, ['content']),
    run: async ({ content }) => ({
      summary: `Souvenir enregistré : « ${content} ».`,
      client_action: { type: 'memory_add', content: String(content) },
    }),
  },
  {
    name: 'forget',
    label: 'Oubli',
    risky: false,
    description: "Supprime un ou plusieurs souvenirs dont le contenu correspond à la recherche (ex. « végétarien »).",
    parameters: S({ query: str('Texte à rechercher dans les souvenirs pour les supprimer.') }, ['query']),
    run: async ({ query }) => ({
      summary: `Demande d'oubli envoyée pour « ${query} ».`,
      client_action: { type: 'memory_remove', query: String(query) },
    }),
  },
  {
    name: 'notes',
    label: 'Carnet de notes',
    risky: true,
    description:
      "Gère le carnet de notes local (fichiers Markdown) : lister, lire, écrire, compléter ou supprimer une note. À utiliser pour dicter une note, un rendez-vous, une liste.",
    parameters: S({
      action: { type: 'string', enum: ['list', 'read', 'write', 'append', 'delete'], description: "L'opération à effectuer." },
      name: str('Nom de la note (ex. « agenda », « courses »).'),
      content: str('Contenu à écrire ou ajouter.'),
    }, ['action']),
    run: (a) => notes(a),
  },
  {
    name: 'run_python',
    label: 'Python local',
    risky: true,
    description:
      "Exécute un court script Python sur la machine et renvoie sa sortie. Utile pour un calcul complexe, une conversion, un traitement de fichier local. 12 secondes maximum.",
    parameters: S({ code: str('Le code Python à exécuter.') }, ['code']),
    run: (a) => runPython(a),
  },
  {
    name: 'browser_control',
    label: 'Pilotage du navigateur',
    risky: true,
    description:
      "Pilote un vrai navigateur Chrome : ouvrir une adresse (goto), lire la page (read), cliquer sur un élément CSS (click), remplir un champ (type), appuyer sur une touche (press), revenir en arrière (back), avancer (forward), défiler (scroll), prendre une capture d'écran (screenshot), voir l'onglet actif (current), fermer (close). À utiliser quand l'utilisateur veut agir sur un site.",
    parameters: S({
      action: { type: 'string', enum: ['goto', 'read', 'click', 'type', 'press', 'back', 'forward', 'scroll', 'screenshot', 'current', 'close'], description: "L'action à effectuer." },
      url: str("Adresse à ouvrir (pour goto)."),
      selector: str('Sélecteur CSS de l\'élément (pour click/type).'),
      text: str('Texte à saisir (pour type).'),
      key: str('Touche à presser (pour press), par exemple Enter.'),
      seconds: { type: 'number', description: 'Amplitude du défilement en pixels (pour scroll).' },
    }, ['action']),
    run: (a) => browserControl(a),
  },
  {
    name: 'open_url',
    label: 'Ouverture de lien',
    risky: true,
    description: "Ouvre une adresse dans le navigateur de l'utilisateur (nouvel onglet). À utiliser pour montrer une page ou lancer un site.",
    parameters: S({ url: str("L'adresse à ouvrir.") }, ['url']),
    run: async ({ url }) => {
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      return {
        summary: `Ouverture de ${target} dans le navigateur.`,
        client_action: { type: 'open_url', url: target },
      };
    },
  },
  {
    name: 'system_command',
    label: 'Commande système',
    risky: true,
    description:
      "Exécute une commande shell courte sur la machine (désactivé par défaut par sécurité). À n'utiliser que si l'utilisateur demande explicitement une information système.",
    parameters: S({ command: str('La commande à exécuter.') }, ['command']),
    run: (a) => systemCommand(a),
  },
];

/** Outils désactivés par configuration (hébergement public). */
export function disabledTools() {
  return (process.env.UMBRA_TOOLS_DISABLE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const isDisabled = (name) => disabledTools().includes(name);

export function toolsForLLM() {
  return TOOL_DEFS.filter((t) => !isDisabled(t.name)).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function getTool(name) {
  return TOOL_DEFS.find((t) => t.name === name) || null;
}

export async function executeTool(name, args) {
  const tool = getTool(name);
  if (!tool) return { ok: false, summary: `Outil inconnu : ${name}` };
  if (isDisabled(name)) {
    return { ok: false, summary: `L'outil « ${tool.label} » est désactivé sur ce serveur.` };
  }
  const startedAt = Date.now();
  try {
    const out = await tool.run(args || {});
    return { ok: true, ...out, ms: Date.now() - startedAt };
  } catch (e) {
    return { ok: false, summary: `Échec de « ${tool.label} » : ${e.message}`, ms: Date.now() - startedAt };
  }
}

export const PATHS = { DATA, NOTES, SHOTS };
