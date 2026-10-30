/**
 * Robustesse de l'appel au fournisseur d'IA.
 *
 * Les API d'IA renvoient régulièrement des 503 transitoires (« model
 * overloaded ») : l'appel suivant passe. Ces tests vérifient que
 * streamCompletion retente au lieu d'échouer, et que le message d'erreur
 * reste lisible quand le fournisseur renvoie du HTML au lieu de JSON.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { streamCompletion } from '../server/llm.js';

const CONFIG = {
  baseUrl: 'https://exemple.test/v1',
  apiKey: 'cle-de-test',
  model: 'modele-de-test',
};

/** Réponse en flux SSE minimaliste, comme celle d'un vrai fournisseur. */
function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const DELTA = (texte) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: texte } }] })}\n\n`;
const FIN = 'data: [DONE]\n\n';

function withFetch(reponses, fn) {
  const original = globalThis.fetch;
  const appels = [];
  globalThis.fetch = async (url, opts) => {
    appels.push({ url, opts });
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
    return typeof r === 'function' ? r() : r;
  };
  return Promise.resolve(fn(appels)).finally(() => {
    globalThis.fetch = original;
  });
}

test('un 503 transitoire est retenté, puis l’appel réussit', async () => {
  const reponses = [
    new Response('<html><body>503 Service Unavailable</body></html>', { status: 503 }),
    () => sseResponse([DELTA('Bonjour'), FIN]),
  ];
  await withFetch(reponses, async (appels) => {
    let texte = '';
    const out = await streamCompletion({
      config: CONFIG,
      messages: [{ role: 'user', content: 'salut' }],
      onDelta: (t) => (texte += t),
    });
    assert.equal(appels.length, 2, 'deux tentatives attendues');
    assert.equal(out.content, 'Bonjour');
    assert.equal(texte, 'Bonjour');
  });
});

test('trois échecs consécutifs produisent un message explicite', async () => {
  const reponses = [new Response('overloaded', { status: 503 })];
  await withFetch(reponses, async (appels) => {
    await assert.rejects(
      () =>
        streamCompletion({
          config: CONFIG,
          messages: [{ role: 'user', content: 'salut' }],
          onDelta: () => {},
        }),
      (err) => {
        assert.match(err.message, /503/);
        assert.match(err.message, /surchargé|réessaie/i);
        return true;
      },
    );
    assert.equal(appels.length, 3, '1 tentative + 2 retentatives attendues');
  });
});

test('une erreur définitive (401) n’est pas retentée', async () => {
  const reponses = [
    new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 401 }),
  ];
  await withFetch(reponses, async (appels) => {
    await assert.rejects(
      () =>
        streamCompletion({
          config: CONFIG,
          messages: [{ role: 'user', content: 'salut' }],
          onDelta: () => {},
        }),
      (err) => {
        assert.match(err.message, /API key not valid/);
        assert.match(err.message, /clé API/i);
        return true;
      },
    );
    assert.equal(appels.length, 1, 'aucune retentative sur un 401');
  });
});

test('une page HTML d’erreur est nettoyée dans le message', async () => {
  const html = '<!doctype html><html><head><style>body{color:red}</style></head><body><h1>Backend Error</h1></body></html>';
  const reponses = [new Response(html, { status: 400 })];
  await withFetch(reponses, async () => {
    await assert.rejects(
      () =>
        streamCompletion({
          config: CONFIG,
          messages: [{ role: 'user', content: 'salut' }],
          onDelta: () => {},
        }),
      (err) => {
        assert.ok(!err.message.includes('<'), 'aucune balise HTML ne doit subsister');
        assert.match(err.message, /Backend Error/);
        return true;
      },
    );
  });
});
