/**
 * Nettoyage de l'historique avant envoi au modèle.
 *
 * Régression visée : après une erreur 429/503, l'interface enregistrait un
 * message assistant VIDE. Renvoyé au tour suivant, il provoquait un 400
 * INVALID_ARGUMENT du fournisseur — et rendait la conversation entière
 * inutilisable, quelle que soit la question.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeMessages } from '../server/sanitize.js';

test('un message assistant vide est écarté', () => {
  const out = sanitizeMessages([
    { role: 'user', content: 'bonjour' },
    { role: 'assistant', content: '' },
    { role: 'user', content: 'ça va ?' },
  ]);
  assert.deepEqual(out, [
    { role: 'user', content: 'bonjour' },
    { role: 'user', content: 'ça va ?' },
  ]);
});

test('un message composé uniquement d’espaces est écarté', () => {
  const out = sanitizeMessages([
    { role: 'user', content: 'salut' },
    { role: 'assistant', content: '   \n\t ' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, 'salut');
});

test('les rôles inconnus et contenus non textuels sont écartés', () => {
  const out = sanitizeMessages([
    { role: 'system', content: 'ignore-moi' },
    { role: 'tool', content: 'resultat' },
    { role: 'user', content: 42 },
    null,
    { role: 'user', content: 'valide' },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'valide' }]);
});

test('l’historique est borné aux 40 derniers messages utiles', () => {
  const list = [];
  for (let i = 0; i < 60; i += 1) {
    list.push({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` });
    list.push({ role: 'assistant', content: '' }); // bruit : erreurs passées
  }
  const out = sanitizeMessages(list);
  assert.equal(out.length, 40);
  assert.equal(out[out.length - 1].content, 'm59');
});

test('les contenus très longs sont tronqués', () => {
  const out = sanitizeMessages([{ role: 'user', content: 'x'.repeat(20000) }], { maxChars: 100 });
  assert.equal(out[0].content.length, 100);
});
