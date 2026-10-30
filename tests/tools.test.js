import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, executeTool, TOOL_DEFS } from '../server/tools.js';

test('la calculatrice respecte les priorités', () => {
  assert.equal(evaluateExpression('2+3*4'), 14);
  assert.equal(evaluateExpression('(2+3)*4'), 20);
  assert.equal(evaluateExpression('1250*0.18+75'), 300);
  assert.equal(evaluateExpression('-5 + 10'), 5);
  assert.equal(evaluateExpression('2**10'), 1024);
});

test('la calculatrice refuse le code arbitraire', () => {
  assert.throws(() => evaluateExpression('process.exit(1)'));
  assert.throws(() => evaluateExpression('require("fs")'));
  assert.throws(() => evaluateExpression('1 +'));
});

test('les 11 outils sont décrits en français', () => {
  assert.ok(TOOL_DEFS.length >= 11);
  const names = TOOL_DEFS.map((t) => t.name);
  for (const expected of ['web_search', 'fetch_page', 'calculator', 'notes', 'run_python', 'browser_control', 'open_url', 'remember', 'forget', 'get_current_datetime', 'system_command']) {
    assert.ok(names.includes(expected), `outil manquant : ${expected}`);
  }
  for (const t of TOOL_DEFS) {
    assert.ok(t.description.length > 30, `description trop courte : ${t.name}`);
    assert.equal(t.parameters.type, 'object');
  }
});

test('notes : écrire, lister, lire, supprimer', async () => {
  const name = `test-${Date.now()}`;
  const w = await executeTool('notes', { action: 'write', name, content: 'ligne A' });
  assert.equal(w.ok, true);
  const a = await executeTool('notes', { action: 'append', name, content: 'ligne B' });
  assert.equal(a.ok, true);
  const r = await executeTool('notes', { action: 'read', name });
  assert.match(r.summary, /ligne A[\s\S]*ligne B/);
  const l = await executeTool('notes', { action: 'list' });
  assert.match(l.summary, new RegExp(name));
  const d = await executeTool('notes', { action: 'delete', name });
  assert.equal(d.ok, true);
  const gone = await executeTool('notes', { action: 'read', name });
  assert.equal(gone.ok, false);
});

test('Python : exécution réelle', async () => {
  const r = await executeTool('run_python', { code: 'print(6*7)' });
  assert.equal(r.ok, true);
  assert.match(r.summary, /42/);
});

test('commande système bloquée par défaut', async () => {
  const r = await executeTool('system_command', { command: 'whoami' });
  assert.equal(r.ok, false);
  assert.match(r.summary, /désactivé/);
});

test('date et heure répondent en français', async () => {
  const r = await executeTool('get_current_datetime', {});
  assert.equal(r.ok, true);
  assert.match(r.summary, /Nous sommes le/);
});
