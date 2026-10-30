/**
 * Umbra IA — serveur
 * Zéro dépendance obligatoire : Node 20+ suffit.
 *  • sert l'application web installable (PWA)
 *  • expose /api/chat en streaming (SSE) avec boucle d'outils et confirmations
 *  • prend en charge le mode démo si aucune clé API n'est configurée
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { buildSystemPrompt } from './prompt.js';
import { createAuth } from './auth.js';
import { TOOL_DEFS, toolsForLLM, getTool, executeTool, PATHS, disabledTools } from './tools.js';
import { streamCompletion, demoBrain, llmConfig, listModels } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

/* ── chargement du .env (léger, sans dépendance) ───────────────────────── */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const USER = process.env.UMBRA_USER_NAME || 'Monsieur';
const TZ = process.env.UMBRA_TIMEZONE || 'Africa/Porto-Novo';
const auth = createAuth();
const PUBLIC_MODE = process.env.UMBRA_PUBLIC_MODE === '1';

/* Garde-fou : exposer Umbra sur internet sans mot de passe, c'est ouvrir son
   serveur à tout le monde. On refuse de démarrer plutôt que de le faire. */
if (PUBLIC_MODE && !process.env.UMBRA_PASSWORD) {
  console.error(`
  ✗ Refus de démarrer : UMBRA_PUBLIC_MODE=1 sans UMBRA_PASSWORD.

    Un serveur public sans mot de passe est ouvert à tous.
    Définis UMBRA_PASSWORD (voir .env.deploy.example), ou retire
    UMBRA_PUBLIC_MODE pour un usage strictement local.
`);
  process.exit(1);
}
const LOGIN_PAGE = path.join(WEB, 'login.html');
const DISABLED = disabledTools();

/* ── utilitaires HTTP ─────────────────────────────────────────────────── */
/**
 * En-têtes CORS.
 * L'APK Android charge l'interface depuis https://localhost (Capacitor) et
 * appelle l'API d'un autre serveur : c'est une requête cross-origin qui doit
 * transporter le cookie de session. Or « Access-Control-Allow-Origin: * » est
 * incompatible avec les cookies — il faut donc refléter l'origine appelante et
 * ajouter Allow-Credentials.
 */
function cors(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-llm-key, x-llm-base, x-llm-model',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && origin !== 'null') {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
  } else {
    h['Access-Control-Allow-Origin'] = '*';
  }
  return h;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

function sendJSON(res, code, obj, origin) {
  res.writeHead(code, { ...JSON_HEADERS, ...cors(origin) });
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Corps de requête trop volumineux'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveFile(res, file, { cache = true } = {}) {
  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) return false;
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cache ? 'public, max-age=3600' : 'no-cache',
    };
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

/* ── confirmations d'outils (mode assisté) ────────────────────────────── */
const pending = new Map(); // id → { resolve, timer }

function askApproval(id, meta) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(false);
      }
    }, 120000);
    pending.set(id, { resolve, timer, meta });
  });
}

/* ── boucle d'agent ───────────────────────────────────────────────────── */
const MAX_STEPS = 6;

function sanitizeMessages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-40)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));
}

async function runAgent({ messages, mode, config, memories, userName, emit, signal }) {
  const system = buildSystemPrompt({
    userName,
    mode,
    memories,
    timezone: TZ,
    now: new Date(),
    disabledTools: disabledTools(),
  });

  const convo = [{ role: 'system', content: system }, ...sanitizeMessages(messages)];
  const allowTools = mode !== 'discussion';

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) return;
    let out;
    if (config.live) {
      out = await streamCompletion({
        config,
        messages: convo,
        tools: allowTools ? toolsForLLM() : undefined,
        signal,
        onDelta: (text) => emit({ type: 'delta', text }),
      });
    } else {
      out = await demoBrain({ messages: convo, mode, emitDelta: (text) => emit({ type: 'delta', text }) });
    }

    if (!out.toolCalls?.length) return;

    convo.push({
      role: 'assistant',
      content: out.content || '',
      tool_calls: out.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        // Gemini 3.x exige que la signature de raisonnement soit renvoyée telle
        // quelle ; sans elle, le 2e tour échoue en 400.
        ...(c.extra ? { extra_content: c.extra } : {}),
      })),
    });

    // sépare visuellement le texte déjà écrit du tour suivant
    if (out.content) emit({ type: 'delta', text: '\n\n' });

    for (const call of out.toolCalls) {
      const tool = getTool(call.name);
      emit({
        type: 'tool_start',
        id: call.id,
        name: call.name,
        label: tool?.label || call.name,
        args: call.arguments,
        risky: Boolean(tool?.risky),
      });

      let result = { ok: false, summary: 'Outil introuvable.' };
      let approved = true;

      if (tool && mode === 'assisted' && tool.risky) {
        emit({ type: 'approval', id: call.id, name: call.name, label: tool.label, args: call.arguments });
        approved = await askApproval(call.id);
        emit({ type: 'approval_result', id: call.id, approved });
      }

      if (!tool) {
        result = { ok: false, summary: `Outil inconnu : ${call.name}` };
      } else if (!approved) {
        result = { ok: false, summary: "Action refusée par l'utilisateur." };
      } else {
        result = await executeTool(call.name, call.arguments);
      }

      emit({
        type: 'tool_end',
        id: call.id,
        name: call.name,
        ok: result.ok !== false,
        summary: result.summary,
        data: result.data,
        client_action: result.client_action,
        ms: result.ms,
      });

      const toolContent = result.data?.image
        ? `${result.summary ?? ''}\n[capture: ${result.data.image}]`.slice(0, 12000)
        : String(result.summary ?? '').slice(0, 12000);
      convo.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: toolContent,
      });
    }
  }

  emit({ type: 'delta', text: "\n\n_(Limite de 6 étapes d'outils atteinte — dis-moi comment continuer.)_" });
}

/* ── routes API ───────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  const ORIGIN = req.headers.origin || '';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(ORIGIN));
    return res.end();
  }

  try {
    /* ── authentification ── */
    const publicPaths = ['/login', '/api/login', '/api/logout', '/api/health', '/favicon.ico'];
    const isPublicAsset =
      p.startsWith('/icons/') || p.startsWith('/fonts/') || p === '/manifest.webmanifest' || p === '/styles.css';

    if (p === '/login' && req.method === 'GET') {
      if (!auth.enabled || auth.isAuthenticated(req)) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }
      if (await serveFile(res, LOGIN_PAGE, { cache: false })) return;
      res.writeHead(404).end('Page de connexion absente.');
      return;
    }

    if (p === '/api/login' && req.method === 'POST') {
      const ip = auth.clientIp(req);
      if (auth.isBlocked(ip)) {
        return sendJSON(res, 429, { error: 'Trop de tentatives. Réessaie dans quelques minutes.' }, ORIGIN);
      }
      const body = await readBody(req);
      if (!auth.checkPassword(body.password)) {
        const info = auth.noteAttempt(ip);
        return sendJSON(res, 401, { error: 'Mot de passe incorrect.', remaining: info.remaining }, ORIGIN);
      }
      auth.resetAttempts(ip);
      const token = auth.issueToken();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': auth.cookieHeader(token, auth.isSecure(req)),
        ...cors(ORIGIN),
      });
      // Le jeton est aussi renvoyé dans le corps : l'application Android le
      // stocke et l'envoie en « Authorization: Bearer » (le cookie ne passe pas
      // en cross-site).
      return res.end(JSON.stringify({ ok: true, token }));
    }

    if (p === '/api/logout' && req.method === 'POST') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': auth.clearCookie(auth.isSecure(req)),
        ...cors(ORIGIN),
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (auth.enabled && !publicPaths.includes(p) && !isPublicAsset && !auth.isAuthenticated(req)) {
      if (p.startsWith('/api/')) return sendJSON(res, 401, { error: 'Session expirée. Reconnecte-toi.' }, ORIGIN);
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }

    /* Santé / capacités */
    if (p === '/api/health') {
      const cfg = llmConfig({
        apiKey: req.headers['x-llm-key'],
        baseUrl: req.headers['x-llm-base'],
        model: req.headers['x-llm-model'],
      });
      return sendJSON(res, 200, {
        ok: true,
        version: '2.0.0',
        live: cfg.live,
        mode: cfg.live ? 'live' : 'demo',
        model: cfg.model,
        provider: cfg.baseUrl,
        user: USER,
        timezone: TZ,
        tools: TOOL_DEFS.filter((t) => !DISABLED.includes(t.name)).map((t) => ({
          name: t.name, label: t.label, description: t.description, risky: t.risky,
        })),
        shell: process.env.UMBRA_ALLOW_SHELL === '1',
        auth: auth.enabled,
        publicMode: PUBLIC_MODE,
        disabledTools: DISABLED,
      });
    }

    /* Liste des modèles du fournisseur */
    if (p === '/api/models') {
      const cfg = llmConfig({
        apiKey: req.headers['x-llm-key'],
        baseUrl: req.headers['x-llm-base'],
        model: req.headers['x-llm-model'],
      });
      if (!cfg.live) return sendJSON(res, 200, { models: [], demo: true }, ORIGIN);
      try {
        const models = await listModels(cfg);
        return sendJSON(res, 200, { models }, ORIGIN);
      } catch (e) {
        return sendJSON(res, 502, { error: e.message, models: [] }, ORIGIN);
      }
    }

    /* Confirmation d'une action risquée */
    if (p === '/api/approve' && req.method === 'POST') {
      const body = await readBody(req);
      const entry = pending.get(body.id);
      if (!entry) return sendJSON(res, 404, { error: 'Demande expirée ou inconnue.' }, ORIGIN);
      clearTimeout(entry.timer);
      pending.delete(body.id);
      entry.resolve(Boolean(body.approved));
      return sendJSON(res, 200, { ok: true }, ORIGIN);
    }

    /* Exécution directe d'un outil (utilisé par l'agent vocal LiveKit) */
    if (p === '/api/tool' && req.method === 'POST') {
      const body = await readBody(req);
      const tool = getTool(body.name);
      if (!tool) return sendJSON(res, 404, { error: `Outil inconnu : ${body.name}` }, ORIGIN);
      if (tool.risky && !body.confirm) {
        return sendJSON(res, 200, {
          requires_approval: true,
          tool: { name: tool.name, label: tool.label, description: tool.description, args: body.args || {} },
        }, ORIGIN);
      }
      const result = await executeTool(tool.name, body.args || {});
      return sendJSON(res, 200, result, ORIGIN);
    }

    /* Liste des outils */
    if (p === '/api/tools') {
      return sendJSON(res, 200, {
        tools: TOOL_DEFS.filter((t) => !DISABLED.includes(t.name)).map((t) => ({
          name: t.name, label: t.label, description: t.description, risky: t.risky, parameters: t.parameters,
        })),
      }, ORIGIN);
    }

    /* Chat en streaming */
    if (p === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = llmConfig({
        apiKey: req.headers['x-llm-key'] || body.apiKey,
        baseUrl: req.headers['x-llm-base'] || body.baseUrl,
        model: req.headers['x-llm-model'] || body.model,
      });
      const controller = new AbortController();
      req.on('close', () => controller.abort());

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...cors(ORIGIN),
      });
      const emit = (obj) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

      emit({ type: 'start', mode: cfg.live ? 'live' : 'demo', model: cfg.model });

      try {
        await runAgent({
          messages: body.messages || [],
          mode: body.mode || 'assisted',
          config: cfg,
          memories: Array.isArray(body.memories) ? body.memories.slice(0, 60) : [],
          userName: body.userName || USER,
          emit,
          signal: controller.signal,
        });
        emit({ type: 'done' });
      } catch (e) {
        if (!controller.signal.aborted) emit({ type: 'error', message: e.message || 'Erreur inconnue.' });
        else emit({ type: 'done', aborted: true });
      } finally {
        res.end();
      }
      return;
    }

    /* Captures d'écran générées par Playwright */
    if (p.startsWith('/screenshots/')) {
      const file = path.join(PATHS.SHOTS, path.basename(p));
      if (await serveFile(res, file)) return;
      return sendJSON(res, 404, { error: 'Capture introuvable.' }, ORIGIN);
    }

    /* Fichiers statiques de l'app */
    if (req.method === 'GET' || req.method === 'HEAD') {
      let rel = decodeURIComponent(p);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.join(WEB, rel);
      if (!file.startsWith(WEB)) return sendJSON(res, 403, { error: 'Interdit.' }, ORIGIN);
      const noCache = ['/index.html', '/sw.js', '/app.js', '/styles.css'].includes(rel);
      if (await serveFile(res, file, { cache: !noCache })) return;
      // SPA : toute route inconnue renvoie l'app
      if (!rel.includes('.')) {
        if (await serveFile(res, path.join(WEB, 'index.html'), { cache: false })) return;
      }
      return sendJSON(res, 404, { error: 'Fichier introuvable.' }, ORIGIN);
    }

    return sendJSON(res, 405, { error: 'Méthode non autorisée.' }, ORIGIN);
  } catch (e) {
    console.error('[umbra]', e);
    if (!res.headersSent) return sendJSON(res, 500, { error: e.message || 'Erreur serveur.' }, ORIGIN);
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  const cfg = llmConfig();
  const url = `http://localhost:${PORT}`;
  console.log('\n  ╭─────────────────────────────────────────────╮');
  console.log('  │  🌙  Umbra IA 2.0                            │');
  console.log('  ╰─────────────────────────────────────────────╯');
  console.log(`  Interface   ${url}`);
  console.log(`  Réseau      http://<ip-locale>:${PORT}  (téléphone sur le même Wi-Fi)`);
  console.log(`  Cerveau     ${cfg.live ? `✅ ${cfg.model}` : '⚠️  mode démo (aucune clé — Réglages ou .env)'}`);
  console.log(`  Outils      ${TOOL_DEFS.length} disponibles`);
  console.log(`  Shell       ${process.env.UMBRA_ALLOW_SHELL === '1' ? 'activé (allowlist)' : 'désactivé'}\n`);
});

export { server };
