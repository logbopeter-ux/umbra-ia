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

/* ─────────────── Pièces jointes : parcours complet HTTP ─────────────── */

test('POST /api/fichiers analyse un document et renvoie son résumé', async () => {
  const res = await fetch(`${BASE}/api/fichiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'notes.txt', mime: 'text/plain', data: Buffer.from('Umbra lit ce fichier.').toString('base64') }),
  });
  assert.equal(res.status, 200);
  const meta = await res.json();
  assert.match(meta.id, /^[a-f0-9]{24}$/);
  assert.equal(meta.categorie, 'document');
  assert.equal(meta.info, 'Fichier texte');
  assert.match(meta.apercu, /Umbra lit ce fichier/);
  assert.equal(meta.texte, undefined, 'le texte complet ne repart pas vers le navigateur');

  // relecture côté serveur : le contenu est bien conservé
  const lire = await fetch(`${BASE}/api/fichiers/${meta.id}`);
  assert.equal(lire.status, 404, 'un document n’expose pas d’octets bruts');

  const suppr = await fetch(`${BASE}/api/fichiers/${meta.id}`, { method: 'DELETE' });
  assert.equal(suppr.status, 200);
});

test('POST /api/fichiers : une image est conservée et servie', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 5)]);
  const res = await fetch(`${BASE}/api/fichiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'photo.png', mime: 'image/png', data: png.toString('base64') }),
  });
  const meta = await res.json();
  assert.equal(meta.categorie, 'image');

  const img = await fetch(`${BASE}/api/fichiers/${meta.id}`);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/png/);
  assert.equal((await img.arrayBuffer()).byteLength, png.length);
});

test('POST /api/fichiers : requête vide ou trop lourde → erreur claire', async () => {
  const vide = await fetch(`${BASE}/api/fichiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'rien.txt' }),
  });
  assert.equal(vide.status, 400);
  assert.match((await vide.json()).error, /Aucun fichier/i);
});

test('GET /api/fichiers/<inconnu> → 404, pas de fuite', async () => {
  const res = await fetch(`${BASE}/api/fichiers/0123456789abcdef01234567`);
  assert.equal(res.status, 404);
});

test('/api/chat accepte un message avec pièce jointe sans planter', async () => {
  const envoi = await fetch(`${BASE}/api/fichiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'liste.txt', mime: 'text/plain', data: Buffer.from('Riz 12000\nTomate 800').toString('base64') }),
  });
  const meta = await envoi.json();

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'discussion',
      messages: [
        {
          role: 'user',
          content: 'Que contient ce fichier ?',
          attachments: [{ id: meta.id, nom: meta.nom, mime: meta.mime, taille: meta.taille, categorie: meta.categorie }],
        },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const texte = await res.text(); // SSE complet
  assert.match(texte, /"type":"done"/, 'le flux se termine proprement');
});

/* ─────────────── Mise à jour de l'APK depuis le téléphone ─────────────── */

test('GET /apk sert le dernier APK disponible', async () => {
  const res = await fetch(`${BASE}/apk`);
  if (res.status === 404) return; // aucun APK dans cette copie du dépôt : acceptable
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(res.headers.get('content-disposition'), /\.apk"/);
  const octets = await res.arrayBuffer();
  assert.ok(octets.byteLength > 100_000, 'un APK pèse au moins quelques centaines de Ko');
});

test('GET /apk/<nom> inconnu → 404, pas de traversée de dossier', async () => {
  const res = await fetch(`${BASE}/apk/../../.env`);
  assert.ok([404, 403].includes(res.status), 'un chemin remontant est refusé');
});

/* ─────────── Correctif 2.0 conservé : les messages vides sont écartés ─────────── */

test('un message vide dans l’historique ne casse pas le fil (400 de Gemini)', async () => {
  // L'interface enregistre un message assistant vide quand un appel échoue.
  // Sans filtre, la requête suivante part avec un contenu vide → 400 définitif.
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'discussion',
      messages: [
        { role: 'user', content: 'Bonjour' },
        { role: 'assistant', content: '' }, // ← le poison
        { role: 'user', content: 'Tu es là ?' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const texte = await res.text();
  assert.match(texte, /"type":"done"/, 'le fil reste utilisable');
  assert.doesNotMatch(texte, /"type":"error"/, 'et ne produit aucune erreur');
});

/* ─────────── Carnet de notes : export / import (correctif 2.0 conservé) ─────────── */

test('le carnet se sauvegarde et se restaure (disque éphémère en ligne)', async () => {
  // 1. noter quelque chose via l'outil
  const ecrit = await fetch(`${BASE}/api/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'notes', args: { action: 'write', name: 'courses-test', content: 'Riz, tomate' }, confirm: true }),
  });
  assert.equal(ecrit.status, 200);

  // 2. exporter
  const exp = await fetch(`${BASE}/api/notes/export`);
  assert.equal(exp.status, 200);
  const donnees = await exp.json();
  assert.ok(Array.isArray(donnees.notes));
  assert.ok(donnees.notes.some((n) => n.name === 'courses-test'), 'la note est dans l’export');
  assert.match(donnees.notes.find((n) => n.name === 'courses-test').content, /Riz/);

  // 3. réimporter ailleurs
  const imp = await fetch(`${BASE}/api/notes/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: [{ name: 'restauree', content: 'Contenu restauré' }] }),
  });
  assert.equal(imp.status, 200);
  const res = await imp.json();
  assert.equal(res.imported, 1);

  // 4. la note restaurée est bien là
  const apres = await (await fetch(`${BASE}/api/notes/export`)).json();
  assert.ok(apres.notes.some((n) => n.name === 'restauree'));
});

test('import de notes : format invalide refusé, chemin suspect neutralisé', async () => {
  const vide = await fetch(`${BASE}/api/notes/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'pas un tableau' }),
  });
  assert.equal(vide.status, 400);

  const piege = await fetch(`${BASE}/api/notes/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: [{ name: '../../../etc/passwd', content: 'x' }] }),
  });
  assert.equal(piege.status, 200);
  const r = await piege.json();
  assert.equal(r.imported, 1);
  // le fichier atterrit dans data/notes, sous un nom nettoyé
  const apres = await (await fetch(`${BASE}/api/notes/export`)).json();
  assert.ok(apres.notes.every((n) => !n.name.includes('..')), 'aucun chemin remontant');
});
