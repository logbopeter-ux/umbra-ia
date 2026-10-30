import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4999;
const BASE = `http://127.0.0.1:${PORT}`;

let child;

test.before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', LLM_API_KEY: '' },
    stdio: 'ignore',
  });
  const start = Date.now();
  while (Date.now() - start < 12000) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('le serveur de test n\'a pas démarré');
});

test.after(() => child?.kill());

test('GET /api/health décrit les capacités', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.tools.length >= 11);
  assert.equal(json.mode, 'demo'); // aucune clé en test
});

test('GET / sert l’application', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Umbra IA/);
  assert.match(html, /manifest\.webmanifest/);
});

test('GET /manifest.webmanifest est installable', async () => {
  const res = await fetch(`${BASE}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  const m = await res.json();
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.length >= 3);
});

test('le service worker est servi', async () => {
  const res = await fetch(`${BASE}/sw.js`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /caches\.open/);
});

test('POST /api/tool exécute un outil', async () => {
  const res = await fetch(`${BASE}/api/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'calculator', args: { expression: '10/4' } }),
  });
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.match(json.summary, /2\.5/);
});

test('POST /api/tool demande confirmation pour un outil risqué', async () => {
  const res = await fetch(`${BASE}/api/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'notes', args: { action: 'list' } }),
  });
  const json = await res.json();
  assert.equal(json.requires_approval, true);
});

test('POST /api/chat diffuse un flux SSE en mode démo', async () => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Calcule 2+2' }],
      mode: 'autonomous',
    }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /"type":"start"/);
  assert.match(text, /"type":"tool_start"/);
  assert.match(text, /"type":"delta"/);
  assert.match(text, /"type":"done"/);
});

test('pages inconnues : renvoie l’application (SPA)', async () => {
  const res = await fetch(`${BASE}/une/route/inconnue`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Umbra IA/);
});
