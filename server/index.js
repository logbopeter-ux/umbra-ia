/**
 * Umbra IA — serveur
 * Zéro dépendance obligatoire : Node 20+ suffit.
 *  • sert l'application web installable (PWA)
 *  • expose /api/chat en streaming (SSE) avec boucle d'outils et confirmations
 *  • prend en charge le mode démo si aucune clé API n'est configurée
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { buildSystemPrompt } from './prompt.js';
import { createAuth } from './auth.js';
import { creerStockage, LIMITE_FICHIER, LIMITE_TOTAL } from './fichiers.js';
import { TOOL_DEFS, toolsForLLM, getTool, executeTool, PATHS, disabledTools } from './tools.js';
import { streamCompletion, buildChain, demoBrain, llmConfig, listModels, probeOllama, ollamaModels, ollamaBaseUrl, modelVoit } from './llm.js';

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

/** Dernier cerveau ayant réellement répondu (pour /api/health). */
let activeBrain = null;

/**
 * Le serveur Ollama local répond-il ? Sondé au démarrage puis toutes les
 * 60 s : inutile de tenter un cerveau local éteint à chaque message.
 * `null` = pas encore su.
 */
let ollamaReady = null;
let ollamaDispo = [];

async function surveillerOllama() {
  const etait = ollamaReady;
  ollamaReady = await probeOllama(ollamaBaseUrl());
  if (ollamaReady) ollamaDispo = await ollamaModels(ollamaBaseUrl());
  if (ollamaReady !== etait) {
    if (ollamaReady) {
      console.log(`  Ollama      ✅ détecté${ollamaDispo.length ? ` (${ollamaDispo.slice(0, 3).join(', ')})` : ''}`);
    } else if (etait === true) {
      console.log('  Ollama      ⚠️  n\'est plus joignable — retiré de la chaîne.');
    }
  }
}
surveillerOllama();
setInterval(surveillerOllama, 60_000).unref?.();

/* ── pièces jointes (images, PDF, documents…) ─────────────────────────── */
const pieces = creerStockage(path.join(PATHS.DATA, 'fichiers'));

/** Nom de fichier de note sûr : ni traversée de dossier, ni caractère exotique. */
function nomDeNote(brut) {
  const base = path.basename(String(brut || '')).replace(/\.md$/i, '').trim();
  if (!base || base === '.' || base === '..') return null;
  const propre = base.replace(/[^\p{L}\p{N} ._-]/gu, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
  return propre ? `${propre}.md` : null;
}

const unite = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/**
 * Transforme les messages de l'interface en messages pour le cerveau.
 * • les images partent en base64 (le cerveau voit la photo)
 * • les documents sont lus ici et leur texte est joint au message
 */
async function enrichirMessages(list) {
  if (!Array.isArray(list)) return [];
  const sortie = [];
  let budget = LIMITE_TOTAL;

  for (const m of list) {
    if (!m || typeof m.content !== 'string') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;

    const joints = Array.isArray(m.attachments) ? m.attachments.slice(0, 12) : [];
    if (!joints.length) {
      // Un message vide (erreur enregistrée par l'interface) fait répondre 400 à
      // Gemini et rend tout le fil inutilisable : on l'écarte.
      if (!m.content.trim()) continue;
      sortie.push({ role: m.role, content: m.content.slice(0, 12000) });
      continue;
    }

    const blocs = [];
    const documents = [];

    for (const j of joints) {
      const f = await pieces.lire(j.id);
      if (!f) {
        documents.push(`[${j.nom || 'fichier'} — pièce jointe expirée, à renvoyer]`);
        continue;
      }
      if (f.categorie === 'image') {
        const brut = await pieces.donnees(f.id);
        if (brut) {
          const mime = f.mime && f.mime.startsWith('image/') ? f.mime : 'image/jpeg';
          blocs.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${brut.toString('base64')}` } });
        }
      } else if (f.texte) {
        const reste = Math.min(f.texte.length, Math.max(0, budget));
        const extrait = f.texte.slice(0, reste);
        budget -= extrait.length;
        documents.push(
          `--- Fichier joint : ${f.nom} (${f.info}, ${unite(f.taille)}) ---\n${extrait}\n--- fin de ${f.nom} ---`,
        );
      } else if (f.avertissement) {
        documents.push(`--- Fichier joint : ${f.nom} — ${f.avertissement} ---`);
      }
    }

    const consigne = documents.length
      ? 'Voici le contenu des fichiers que je viens de te donner. Lis-les et réponds à partir d\'eux.'
      : '';
    const texte = [m.content, consigne, ...documents].filter(Boolean).join('\n\n');

    if (!texte.trim() && !blocs.length) continue; // rien à transmettre
    sortie.push(blocs.length ? { role: m.role, content: [{ type: 'text', text: texte }, ...blocs] } : { role: m.role, content: texte.slice(0, 60000) });
  }

  return sortie.slice(-40);
}

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

  const convo = [{ role: 'system', content: system }, ...(await enrichirMessages(messages))];
  const allowTools = mode !== 'discussion';

  // Chaîne de cerveaux : le principal, puis les secours configurés.
  // Elle évolue en cours de route : quand Groq prend le relais de Gemini,
  // Groq devient « collant » pour les tours suivants, afin de ne pas retenter
  // un fournisseur qui vient déjà de refuser trois fois.
  let chain = buildChain({ config, available: { ollama: ollamaReady !== false } });

  // Si le message contient des images, on place devant les cerveaux qui voient.
  // L'ordre relatif est conservé : à capacité égale, la priorité ne change pas.
  const aDesImages = convo.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'image_url'));
  if (aDesImages) {
    chain = [...chain].sort((a, b) => Number(Boolean(b.vision ?? modelVoit(b.name, b.model))) - Number(Boolean(a.vision ?? modelVoit(a.name, a.model))));
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) return;
    let out;
    if (config.live) {
      out = await streamCompletion({
        config,
        chain,
        messages: convo,
        tools: allowTools ? toolsForLLM() : undefined,
        signal,
        onDelta: (text) => emit({ type: 'delta', text }),
        onFailover: ({ de, vers, erreur }) => {
          // On prévient l'interface : elle affiche un discret « X prend le relais ».
          emit({ type: 'failover', de: de.label || de.name, vers: vers.label || vers.name, raison: erreur });
          chain = [vers, ...chain.filter((c) => c.name !== vers.name)];
        },
      });

      // Mémorise le cerveau qui a réellement répondu (badge « EN LIGNE »).
      if (out.provider) activeBrain = out.provider;
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
      const suite = new URL(req.url, 'http://localhost').searchParams.get('next') || '';
      const retour = suite.startsWith('/') && !suite.startsWith('//') ? suite : '/';
      if (!auth.enabled || auth.isAuthenticated(req)) {
        res.writeHead(302, { Location: retour });
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
      // On mémorise la destination pour y revenir après le mot de passe.
      const suite = p === '/' ? '' : `?next=${encodeURIComponent(p)}`;
      res.writeHead(302, { Location: `/login${suite}` });
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
        version: '2.1.0',
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
        // Cerveaux disponibles, dans l'ordre où ils seront essayés.
        brains: buildChain({
          config: llmConfig({
            apiKey: req.headers['x-llm-key'],
            baseUrl: req.headers['x-llm-base'],
            model: req.headers['x-llm-model'],
          }),
          available: { ollama: ollamaReady !== false },
        }).map((c) => ({ name: c.name, label: c.label, model: c.model, local: Boolean(c.local), keyless: !c.apiKey })),
        ollama: { ready: ollamaReady === true, models: ollamaDispo },
        active: activeBrain,
      }, ORIGIN);
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

    /* ── carnet de notes : export / import ──────────────────────────────
       Le carnet vit sur le serveur. Sur un hébergement à disque éphémère
       (offre gratuite Render), il disparaît au redéploiement : ces deux routes
       permettent d'en garder une copie et de la restaurer. */

    if (p === '/api/notes/export' && req.method === 'GET') {
      await fsp.mkdir(PATHS.NOTES, { recursive: true });
      const fichiers = (await fsp.readdir(PATHS.NOTES)).filter((f) => f.endsWith('.md')).sort();
      const notes = [];
      for (const f of fichiers) {
        const contenu = await fsp.readFile(path.join(PATHS.NOTES, f), 'utf8').catch(() => null);
        if (contenu !== null) notes.push({ name: f.replace(/\.md$/, ''), content: contenu });
      }
      return sendJSON(res, 200, { version: 1, exportedAt: new Date().toISOString(), notes }, ORIGIN);
    }

    if (p === '/api/notes/import' && req.method === 'POST') {
      const body = await readBody(req);
      const liste = Array.isArray(body?.notes) ? body.notes : null;
      if (!liste) {
        return sendJSON(res, 400, { error: 'Format attendu : { "notes": [ { "name": "…", "content": "…" } ] }.' }, ORIGIN);
      }
      if (liste.length > 500) return sendJSON(res, 413, { error: 'Trop de notes en une seule fois (500 maximum).' }, ORIGIN);
      await fsp.mkdir(PATHS.NOTES, { recursive: true });
      let importees = 0;
      const ignorees = [];
      for (const n of liste) {
        const nom = nomDeNote(n?.name);
        if (!nom) {
          ignorees.push(String(n?.name ?? '').slice(0, 60));
          continue;
        }
        await fsp.writeFile(path.join(PATHS.NOTES, nom), String(n?.content ?? ''), 'utf8');
        importees += 1;
      }
      return sendJSON(res, 200, { ok: true, imported: importees, skipped: ignorees }, ORIGIN);
    }

    /* ── pièces jointes ──────────────────────────────────────────────── */

    /* Envoi d'un fichier : l'interface l'envoie en base64 (pas de multipart). */
    if (p === '/api/fichiers' && req.method === 'POST') {
      let body;
      try {
        body = await readBody(req, LIMITE_FICHIER * 1.45);
      } catch (e) {
        return sendJSON(res, 413, { error: 'Fichier trop lourd : 25 Mo maximum.' }, ORIGIN);
      }
      const base64 = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!base64) return sendJSON(res, 400, { error: 'Aucun fichier reçu.' }, ORIGIN);

      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > LIMITE_FICHIER) {
        return sendJSON(res, 413, { error: 'Fichier trop lourd : 25 Mo maximum.' }, ORIGIN);
      }

      try {
        const meta = await pieces.enregistrer({ nom: body.nom || 'fichier', mime: body.mime || '', buffer });
        // Le texte complet reste sur le serveur : l'interface n'a besoin que du résumé.
        const { texte, ...reste } = meta;
        return sendJSON(res, 200, { ...reste, longueur: (texte || '').length }, ORIGIN);
      } catch (e) {
        return sendJSON(res, 400, { error: e.message || 'Lecture impossible.' }, ORIGIN);
      }
    }

    /* Image d'une pièce jointe (miniature dans l'historique) */
    if (p.startsWith('/api/fichiers/') && req.method === 'GET') {
      const id = p.split('/')[3];
      const meta = await pieces.lire(id);
      const data = meta ? await pieces.donnees(id) : null;
      if (!meta || !data) return sendJSON(res, 404, { error: 'Pièce jointe introuvable.' }, ORIGIN);
      res.writeHead(200, {
        'Content-Type': meta.mime && meta.mime.startsWith('image/') ? meta.mime : 'image/jpeg',
        'Content-Length': data.length,
        'Cache-Control': 'private, max-age=86400',
        ...cors(ORIGIN),
      });
      return res.end(data);
    }

    /* Suppression d'une pièce jointe non envoyée */
    if (p.startsWith('/api/fichiers/') && req.method === 'DELETE') {
      await pieces.supprimer(p.split('/')[3]);
      return sendJSON(res, 200, { ok: true }, ORIGIN);
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

    /* Téléchargement de l'APK depuis le téléphone (même Wi-Fi).
       Protégé par le mot de passe : on se connecte dans le navigateur, puis
       on ouvre /apk. C'est le chemin le plus court pour installer une mise à jour. */
    if (p === '/apk' || p.startsWith('/apk/')) {
      const dossier = path.join(ROOT, 'apk');
      let nom = decodeURIComponent(p.slice(5).replace(/^\//, ''));
      try {
        // Dossier absent (cas de l'image Docker : l'APK n'est pas embarqué) :
        // une liste vide, pas une exception — sinon la redirection ne part jamais.
        const dispo = (await fsp.readdir(dossier).catch(() => [])).filter((n) => n.toLowerCase().endsWith('.apk'));
        if (!nom) {
          if (!dispo.length) {
            // Serveur en ligne : l'APK n'est pas dans l'image. On renvoie vers
            // l'adresse configurée (release GitHub, Drive, autre…).
            const ailleurs = process.env.UMBRA_APK_URL;
            if (ailleurs) {
              res.writeHead(302, { Location: ailleurs, ...cors(ORIGIN) });
              return res.end();
            }
            return sendJSON(res, 404, {
              error: "Aucun APK sur ce serveur. Télécharge-le depuis ta machine, ou renseigne UMBRA_APK_URL pour pointer vers lui.",
            }, ORIGIN);
          }
          // le plus récent d'abord
          const infos = await Promise.all(
            dispo.map(async (n) => ({ n, t: (await fsp.stat(path.join(dossier, n))).mtimeMs })),
          );
          infos.sort((a, b) => b.t - a.t);
          nom = infos[0].n;
        }
        const fichier = path.join(dossier, path.basename(nom));
        if (!dispo.includes(path.basename(nom))) return sendJSON(res, 404, { error: 'APK introuvable.' }, ORIGIN);
        const taille = (await fsp.stat(fichier)).size;
        const flux = fs.createReadStream(fichier);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': taille,
          'Content-Disposition': `attachment; filename="${path.basename(fichier)}"`,
          'Cache-Control': 'no-store',
          ...cors(ORIGIN),
        });
        flux.pipe(res);
        return;
      } catch {
        return sendJSON(res, 404, { error: 'APK introuvable.' }, ORIGIN);
      }
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

/** L'adresse de cette machine sur le réseau local (celle à taper depuis un téléphone). */
function adresseLocale() {
  const cartes = os.networkInterfaces();
  for (const nom of Object.keys(cartes)) {
    for (const c of cartes[nom] || []) {
      if (c.family !== 'IPv4' || c.internal) continue;
      // 169.254.x.x = adresse d'auto-configuration, inutilisable depuis un autre appareil
      if (c.address.startsWith('169.254.')) continue;
      return c.address;
    }
  }
  return '';
}

server.listen(PORT, HOST, () => {
  const cfg = llmConfig();
  const url = `http://localhost:${PORT}`;
  console.log('\n  ╭─────────────────────────────────────────────╮');
  console.log('  │  🌙  Umbra IA 2.1                            │');
  console.log('  ╰─────────────────────────────────────────────╯');
  console.log(`  Interface   ${url}`);
  const ip = adresseLocale();
  if (ip) {
    console.log(`  Téléphone   http://${ip}:${PORT}   (même Wi-Fi)`);
    console.log(`  APK         http://${ip}:${PORT}/apk`);
  } else {
    console.log(`  Téléphone   réseaux locaux indisponibles — utilise l'adresse du serveur hébergé`);
  }
  console.log(`  Cerveau     ${cfg.live ? `✅ ${cfg.model}` : '⚠️  mode démo (aucune clé — Réglages ou .env)'}`);
  console.log(`  Outils      ${TOOL_DEFS.length} disponibles`);
  console.log(`  Shell       ${process.env.UMBRA_ALLOW_SHELL === '1' ? 'activé (allowlist)' : 'désactivé'}`);
  if (HOST === '0.0.0.0' && !process.env.UMBRA_PASSWORD) {
    console.log('\n  ⚠️  AUCUN MOT DE PASSE : cette instance est ouverte à qui connaît son adresse.');
    console.log('     Ajoute UMBRA_PASSWORD dans les variables d\'environnement.\n');
  } else {
    console.log('');
  }
});

export { server };
