/**
 * Umbra IA — cohérence des fichiers de l'interface.
 * Ces tests existent à cause d'un vrai bug : après une mise à jour, le service
 * worker servait l'ancien app.js (cache d'abord) alors que le HTML, lui, était
 * frais. Résultat : les nouveaux boutons s'affichaient mais restaient inertes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const version = JSON.parse(lire('package.json')).version;
const html = lire('web/index.html');
const sw = lire('web/sw.js');
const app = lire('web/app.js');

test('index.html charge app.js et styles.css avec la version (anti-cache)', () => {
  assert.ok(html.includes(`/app.js?v=${version}`), `attendu : /app.js?v=${version}`);
  assert.ok(html.includes(`/styles.css?v=${version}`), `attendu : /styles.css?v=${version}`);
});

test('le service worker et l’interface annoncent la même version que le paquet', () => {
  assert.ok(sw.includes(`umbra-v${version}`), `le cache doit être « umbra-v${version} »`);
  assert.ok(app.includes(`INTERFACE_VERSION = '${version}'`), `INTERFACE_VERSION doit valoir ${version}`);
});

test('le service worker ne met jamais le code de l’app en cache d’abord', () => {
  // la liste des fichiers « toujours frais » doit contenir app.js et styles.css
  const bloc = sw.match(/TOUJOURS_FRAIS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(bloc, 'la liste TOUJOURS_FRAIS doit exister');
  assert.match(bloc[1], /\/app\.js/);
  assert.match(bloc[1], /\/styles\.css/);
  assert.match(bloc[1], /\/index\.html/);
});

test('l’interface sait se défaire d’un service worker dans l’application Android', () => {
  assert.match(app, /isNativeShell\(\)/);
  assert.match(app, /getRegistrations\(\)/, 'les anciens service workers doivent être retirés');
});

test('le trombone et le bouton retour à la ligne sont branchés', () => {
  assert.match(app, /sur\('clipBtn', 'click'/, 'le trombone doit ouvrir le sélecteur');
  assert.match(app, /sur\('newlineBtn', 'click'/, 'le bouton ↵ doit insérer un retour à la ligne');
  assert.ok(html.includes('id="clipBtn"'));
  assert.ok(html.includes('id="newlineBtn"'));
  assert.ok(html.includes('id="fileInput"'), 'le champ de fichier doit exister');
});

test('l’application Android n’embarque pas le service worker', () => {
  const sync = lire('mobile/scripts/sync-web.mjs');
  assert.match(sync, /SKIP\s*=\s*new Set\(\[[^\]]*'sw\.js'/, 'sw.js doit rester exclu du bundle APK');
});
