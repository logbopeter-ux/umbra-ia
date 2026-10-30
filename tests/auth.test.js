/**
 * Umbra IA — tests de la protection par mot de passe
 * Lance un vrai serveur avec UMBRA_PASSWORD puis vérifie :
 *   • les pages et l'API sont fermées sans cookie
 *   • la page de connexion est accessible
 *   • un mauvais mot de passe est refusé (401)
 *   • un bon mot de passe délivre un cookie utilisable
 *   • les tentatives sont limitées (anti brute-force)
 *   • la déconnexion invalide le cookie
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, parseCookies } from '../server/auth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4997;
const BASE = `http://127.0.0.1:${PORT}`;
const MDP = 'test-ombre-lune-4821';

let child;

test.before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      LLM_API_KEY: '',
      UMBRA_PASSWORD: MDP,
      UMBRA_SESSION_SECRET: 'secret-de-test-non-sensible',
    },
    stdio: 'ignore',
  });
  const start = Date.now();
  while (Date.now() - start < 12000) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("le serveur de test n'a pas démarré");
});

test.after(() => child?.kill());

test('la page de connexion est accessible sans être identifié', async () => {
  const r = await fetch(`${BASE}/login`, { redirect: 'manual' });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Umbra/i);
});

test("l'application est redirigée vers /login sans cookie", async () => {
  const r = await fetch(`${BASE}/`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
});

test("l'API est fermée sans cookie (401)", async () => {
  const r = await fetch(`${BASE}/api/tools`, { redirect: 'manual' });
  assert.equal(r.status, 401);
  const body = await r.json();
  assert.match(body.error, /Session/i);
});

test('un mauvais mot de passe est refusé', async () => {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'mauvais-mot-de-passe' }),
  });
  assert.equal(r.status, 401);
});

test('un bon mot de passe ouvre une session utilisable', async () => {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: MDP }),
  });
  assert.equal(r.status, 200);
  const cookie = (r.headers.getSetCookie?.() || [r.headers.get('set-cookie')])[0];
  assert.match(cookie, /umbra_session=/);
  assert.match(cookie, /HttpOnly/);

  const jar = cookie.split(';')[0];
  const app = await fetch(`${BASE}/`, { redirect: 'manual', headers: { cookie: jar } });
  assert.equal(app.status, 200, "l'application doit s'ouvrir avec le cookie");

  const api = await fetch(`${BASE}/api/tools`, { headers: { cookie: jar } });
  assert.equal(api.status, 200);
});

test("la déconnexion invalide le cookie côté navigateur", async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: MDP }),
  });
  const jar = (login.headers.getSetCookie?.() || [login.headers.get('set-cookie')])[0].split(';')[0];

  const out = await fetch(`${BASE}/api/logout`, { method: 'POST', headers: { cookie: jar } });
  assert.equal(out.status, 200);
  const cleared = (out.headers.getSetCookie?.() || [out.headers.get('set-cookie')])[0];
  assert.match(cleared, /Max-Age=0/);
});

test('anti brute-force : blocage après 6 échecs', async () => {
  for (let i = 0; i < 6; i++) {
    await fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
      body: JSON.stringify({ password: `faux-${i}` }),
    });
  }
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
    body: JSON.stringify({ password: MDP }),
  });
  assert.equal(r.status, 429, 'la 7e tentative doit être bloquée même avec le bon mot de passe');
});

/* ── tests unitaires du module (sans réseau) ───────────────────── */

test('createAuth : inactif sans UMBRA_PASSWORD', () => {
  const auth = createAuth({});
  assert.equal(auth.enabled, false);
  assert.equal(auth.isAuthenticated({ headers: {} }), true);
});

test('createAuth : un cookie signé invalide est rejeté', () => {
  const auth = createAuth({ UMBRA_PASSWORD: MDP });
  const token = auth.issueToken();
  assert.equal(auth.verifyToken(token), true);
  assert.equal(auth.verifyToken(token.slice(0, -3) + 'abc'), false);
  assert.equal(auth.verifyToken('nimporte.quoi'), false);
  assert.equal(auth.verifyToken(''), false);
});

test('createAuth : un cookie signé avec un autre secret est rejeté', () => {
  const a = createAuth({ UMBRA_PASSWORD: MDP, UMBRA_SESSION_SECRET: 'secret-A' });
  const b = createAuth({ UMBRA_PASSWORD: MDP, UMBRA_SESSION_SECRET: 'secret-B' });
  assert.equal(b.verifyToken(a.issueToken()), false);
});

test('parseCookies : lecture simple et URL-encodée', () => {
  const c = parseCookies('umbra_session=abc.def; theme=sombre; x=%20y');
  assert.equal(c.umbra_session, 'abc.def');
  assert.equal(c.theme, 'sombre');
  assert.equal(c.x, ' y');
});

test('le jeton Bearer ouvre une session sans cookie (scénario APK)', async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.8.8.8' },
    body: JSON.stringify({ password: MDP }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.ok(token && token.length > 40, 'le jeton doit être renvoyé dans le corps');

  // sans cookie : c'est ce que fait l'application Android
  const ok = await fetch(`${BASE}/api/tools`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(ok.status, 200);

  const ko = await fetch(`${BASE}/api/tools`, { headers: { authorization: 'Bearer menteur' } });
  assert.equal(ko.status, 401);
});

test("l'API renvoie les en-têtes CORS compatibles avec le cookie", async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://localhost' },
    body: JSON.stringify({ password: MDP }),
  });
  assert.equal(login.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal(login.headers.get('access-control-allow-credentials'), 'true');

  const pre = await fetch(`${BASE}/api/chat`, {
    method: 'OPTIONS',
    headers: { origin: 'https://localhost', 'access-control-request-method': 'POST' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://localhost');
});

test('createAuth : le jeton Bearer est reconnu par isAuthenticated', () => {
  const auth = createAuth({ UMBRA_PASSWORD: MDP });
  const token = auth.issueToken();
  const req = (headers) => ({ headers, socket: {} });
  assert.equal(auth.isAuthenticated(req({ authorization: `Bearer ${token}` })), true);
  assert.equal(auth.isAuthenticated(req({ authorization: 'Bearer faux' })), false);
  assert.equal(auth.isAuthenticated(req({})), false);
  assert.equal(auth.isAuthenticated(req({ cookie: `umbra_session=${token}` })), true);
});
