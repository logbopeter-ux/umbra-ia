/**
 * Sauvegarde / restauration du carnet de notes (/api/notes/export & /import).
 *
 * Contexte : sur une offre d'hébergement gratuite, le disque est éphémère.
 * Ces routes permettent à l'interface de faire une copie des notes et de les
 * restaurer après un redémarrage du service.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_DIR = path.join(ROOT, 'data', 'notes');
const PORT = 4998;
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = `test-backup-${Date.now()}`;
const created = [];

let child;

test.before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', LLM_API_KEY: '', UMBRA_PASSWORD: '' },
    stdio: 'ignore',
  });
  const start = Date.now();
  while (Date.now() - start < 12000) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("le serveur de test n'a pas démarré");
});

test.after(async () => {
  child?.kill();
  await Promise.all(created.map((f) => fs.rm(path.join(NOTES_DIR, f), { force: true })));
});

test('GET /api/notes/export renvoie un carnet vide mais valide', async () => {
  const res = await fetch(`${BASE}/api/notes/export`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.version, 1);
  assert.ok(Array.isArray(json.notes));
  assert.ok(typeof json.exportedAt === 'string');
});

test('POST /api/notes/import écrit les notes puis export les relit', async () => {
  const notes = [
    { name: `${TAG}-courses`, content: 'Lait, pain, café.' },
    { name: `${TAG}-idees`, content: 'Idée : un assistant qui sauvegarde ses notes.' },
  ];
  const res = await fetch(`${BASE}/api/notes/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.equal(out.imported, 2);
  assert.deepEqual(out.skipped, []);
  created.push(`${TAG}-courses.md`, `${TAG}-idees.md`);

  // Les fichiers existent réellement sur le disque
  for (const n of notes) {
    const txt = await fs.readFile(path.join(NOTES_DIR, `${n.name}.md`), 'utf8');
    assert.equal(txt, n.content);
  }

  // Et l'export les restitue
  const exp = await (await fetch(`${BASE}/api/notes/export`)).json();
  const found = exp.notes.find((n) => n.name === `${TAG}-courses`);
  assert.ok(found, 'la note importée doit apparaître dans l’export');
  assert.equal(found.content, 'Lait, pain, café.');
});

test('un nom de note tentant de sortir du dossier est neutralisé', async () => {
  const res = await fetch(`${BASE}/api/notes/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: [{ name: '../../evasion', content: 'x' }] }),
  });
  const out = await res.json();
  assert.equal(out.imported, 1);
  created.push('evasion.md');

  // Aucun fichier n'a été créé hors de data/notes
  const exp = await (await fetch(`${BASE}/api/notes/export`)).json();
  const names = exp.notes.map((n) => n.name);
  assert.ok(names.includes('evasion'), 'le nom est ramené à sa base');
  assert.ok(!names.some((n) => n.includes('..')), 'aucun « .. » ne doit subsister');
  await assert.rejects(fs.access(path.join(ROOT, 'data', 'evasion.md')));
});

test('un nom vide est ignoré et signalé', async () => {
  const res = await fetch(`${BASE}/api/notes/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: [{ name: '   ', content: 'orpheline' }] }),
  });
  const out = await res.json();
  assert.equal(out.imported, 0);
  assert.equal(out.skipped.length, 1);
});

test('une requête sans tableau notes est refusée', async () => {
  const res = await fetch(`${BASE}/api/notes/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carnets: [] }),
  });
  assert.equal(res.status, 400);
});
