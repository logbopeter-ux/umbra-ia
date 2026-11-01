/**
 * Umbra IA — test de bout en bout du basculement automatique.
 *
 * On lance un vrai serveur Umbra, avec deux faux fournisseurs :
 *   • le « principal » répond 429 (quota épuisé) ;
 *   • le « secours » répond un flux SSE normal.
 *
 * On vérifie que la réponse arrive quand même, que l'interface est prévenue
 * de la bascule, et que le second fournisseur a bien été appelé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4995;
const PRINCIPAL = 4993;
const SECOURS = 4994;
const BASE = `http://127.0.0.1:${PORT}`;

let umbra;
let principal;
let secours;
let appelsSecours = 0;

/** Faux fournisseur : soit une erreur, soit un flux SSE qui contient un texte. */
function fauxFournisseur(repondre) {
  return http.createServer(async (req, res) => {
    if (req.url.endsWith('/chat/completions') && req.method === 'POST') {
      let corps = '';
      for await (const c of req) corps += c;
      const reponse = repondre(JSON.parse(corps));
      if (reponse.erreur) {
        res.writeHead(reponse.erreur, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: reponse.message } }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reponse.texte } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'faux-modele' }] }));
    }
    res.writeHead(404).end();
  });
}

test.before(async () => {
  principal = fauxFournisseur(() => ({ erreur: 429, message: 'quota gratuit épuisé' }));
  secours = fauxFournisseur(() => {
    appelsSecours += 1;
    return { texte: 'Je suis le secours, Monsieur.' };
  });
  await new Promise((r) => principal.listen(PRINCIPAL, '127.0.0.1', r));
  await new Promise((r) => secours.listen(SECOURS, '127.0.0.1', r));

  umbra = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      // cerveau principal : le faux fournisseur qui renvoie 429
      LLM_API_KEY: 'cle-principale',
      LLM_BASE_URL: `http://127.0.0.1:${PRINCIPAL}`,
      LLM_MODEL: 'modele-principal',
      // secours : l'autre faux fournisseur, déguisé en « groq »
      LLM_FALLBACKS: 'groq',
      GROQ_API_KEY: 'gsk_secours',
      LLM_URL_GROQ: `http://127.0.0.1:${SECOURS}`,
      LLM_MODEL_GROQ: 'modele-secours',
      UMBRA_PASSWORD: '',
    },
    stdio: 'ignore',
  });

  const debut = Date.now();
  while (Date.now() - debut < 12000) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* pas prêt */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("le serveur Umbra de test n'a pas démarré");
});

test.after(() => {
  umbra?.kill();
  principal?.close();
  secours?.close();
});

/** Lit un flux SSE et renvoie les événements. */
async function lireSSE(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const texte = await res.text();
  return texte
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => {
      try {
        return JSON.parse(l.slice(5).trim());
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

test('/api/health expose la chaîne des cerveaux', async () => {
  const r = await fetch(`${BASE}/api/health`);
  const h = await r.json();
  assert.equal(h.mode, 'live');
  assert.deepEqual(h.brains.map((b) => b.name), ['custom', 'groq']);
});

test('le quota du principal n’empêche pas la réponse : le secours prend le relais', async () => {
  const avant = appelsSecours;
  const evts = await lireSSE(`${BASE}/api/chat`, {
    messages: [{ role: 'user', content: 'Bonjour' }],
    mode: 'discussion',
  });

  const bascule = evts.find((e) => e.type === 'failover');
  assert.ok(bascule, 'un événement « failover » doit être émis');
  assert.equal(bascule.vers, 'Groq');

  const texte = evts
    .filter((e) => e.type === 'delta')
    .map((e) => e.text)
    .join('');
  assert.equal(texte, 'Je suis le secours, Monsieur.');
  assert.equal(appelsSecours, avant + 1, 'le secours doit avoir été appelé une fois');

  const fin = evts.find((e) => e.type === 'done');
  assert.ok(fin, "le flux doit se terminer proprement");
});

test('le cerveau de secours devient « collant » : il répond seul au tour suivant', async () => {
  await lireSSE(`${BASE}/api/chat`, { messages: [{ role: 'user', content: 'encore' }], mode: 'discussion' });
  const h = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(h.active.name, 'groq', '/api/health doit indiquer le cerveau réellement actif');
});

/* ─────────── Cascade complète : deux pannes → Ollama local ─────────── */

const PORT2 = 4996;
const GEMINI2 = 4988;
const GROQ2 = 4989;
const OLLAMA2 = 4990;
let umbra2;
const serveurs2 = [];

test('cascade : Gemini et Groq tombent, Ollama répond sans clé ni quota', async (t) => {
  const gemini = fauxFournisseur(() => ({ erreur: 429, message: 'quota' }));
  const groq = fauxFournisseur(() => ({ erreur: 429, message: 'quota' }));
  const ollama = fauxFournisseur(() => ({ texte: 'Ollama local prend le relais.' }));

  // Ollama expose /api/tags (sonde de disponibilité)
  const ollamaAvecTags = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ models: [{ name: 'llama3.1:latest' }] }));
    }
    return ollama.listeners('request')[0].call(ollama, req, res);
  });

  for (const [srv, port] of [
    [gemini, GEMINI2],
    [groq, GROQ2],
    [ollamaAvecTags, OLLAMA2],
  ]) {
    serveurs2.push(srv);
    await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  }

  umbra2 = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT2),
      HOST: '127.0.0.1',
      LLM_API_KEY: 'k',
      LLM_BASE_URL: 'https://api.gemini.example/v1',
      LLM_MODEL: 'gemini-test',
      LLM_URL_GEMINI: `http://127.0.0.1:${GEMINI2}`,
      GROQ_API_KEY: 'g',
      LLM_URL_GROQ: `http://127.0.0.1:${GROQ2}`,
      LLM_URL_OLLAMA: `http://127.0.0.1:${OLLAMA2}/v1`,
      UMBRA_PASSWORD: '',
    },
    stdio: 'ignore',
  });

  const BASE2 = `http://127.0.0.1:${PORT2}`;
  const debut = Date.now();
  while (Date.now() - debut < 12000) {
    try {
      if ((await fetch(`${BASE2}/api/health`)).ok) break;
    } catch {
      /* pas prêt */
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // la sonde Ollama tourne en tâche de fond : on lui laisse un instant
  await new Promise((r) => setTimeout(r, 1500));

  const health = await (await fetch(`${BASE2}/api/health`)).json();
  assert.equal(health.ollama.ready, true, 'la sonde doit détecter le faux Ollama');
  assert.deepEqual(health.brains.map((b) => b.name), ['custom', 'groq', 'ollama']);

  const evts = await lireSSE(`${BASE2}/api/chat`, {
    messages: [{ role: 'user', content: 'test' }],
    mode: 'discussion',
  });

  const bascules = evts.filter((e) => e.type === 'failover').map((e) => `${e.de}→${e.vers}`);
  assert.equal(bascules.length, 2, 'deux bascules attendues');
  assert.match(bascules[1], /Ollama$/);

  const texte = evts.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.equal(texte, 'Ollama local prend le relais.');

  umbra2.kill();
  for (const s of serveurs2) s.close();
});
