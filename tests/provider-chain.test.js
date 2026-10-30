/**
 * Chaîne de fournisseurs : Umbra ne doit jamais tomber en panne de cerveau.
 *
 * Le fournisseur principal (Gemini) tente sa chance ; en cas de quota épuisé,
 * de clé invalide ou de panne, on bascule sur les secours déclarés par
 * variables d'environnement (Groq, OpenRouter, Anthropic…).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { streamCompletion, providerChain } from '../server/llm.js';

const PRIMARY = {
  baseUrl: 'https://principal.test/v1',
  apiKey: 'cle-principale',
  model: 'modele-principal',
};

const MESSAGES = [{ role: 'user', content: 'bonjour' }];

function sseResponse(texte) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: texte } }] })}\n\n`),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** Remplace fetch et journalise les URL appelées. */
function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return handler(String(url));
  };
  return Promise.resolve(fn(urls)).finally(() => {
    globalThis.fetch = original;
  });
}

function withGroq(fn) {
  const avant = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'cle-groq-de-test';
  return Promise.resolve(fn()).finally(() => {
    if (avant === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = avant;
  });
}

test('la chaîne lit les clés de secours dans l’environnement', () => {
  const chain = providerChain({
    GROQ_API_KEY: 'g',
    OPENROUTER_API_KEY: 'o',
    ANTHROPIC_API_KEY: 'a',
    LLM_FALLBACK1_URL: 'https://x.test/v1',
    LLM_FALLBACK1_KEY: 'k',
    LLM_FALLBACK1_MODEL: 'm',
  });
  const labels = chain.map((c) => c.label);
  // OpenRouter et Anthropic exigent un modèle explicite : ignorés ici.
  assert.deepEqual(labels, ['groq', 'secours1']);
  assert.ok(chain.every((c) => c.apiKey && c.baseUrl && c.model));
  assert.ok(!JSON.stringify(chain).includes('undefined'));
});

test('quota épuisé chez le principal → bascule sur Groq', () =>
  withGroq(() =>
    withFetch(
      (url) =>
        url.includes('principal.test')
          ? new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })
          : sseResponse('Bonjour depuis Groq'),
      async (urls) => {
        let texte = '';
        const out = await streamCompletion({
          config: PRIMARY,
          messages: MESSAGES,
          onDelta: (t) => (texte += t),
        });
        assert.equal(out.content, 'Bonjour depuis Groq');
        assert.equal(texte, 'Bonjour depuis Groq');
        assert.equal(out.provider, 'groq');
        assert.equal(urls.length, 2, 'un appel par fournisseur');
      },
    ),
  ));

test('clé principale invalide (401) → bascule aussi', () =>
  withGroq(() =>
    withFetch(
      (url) =>
        url.includes('principal.test')
          ? new Response('unauthorized', { status: 401 })
          : sseResponse('ok'),
      async () => {
        const out = await streamCompletion({ config: PRIMARY, messages: MESSAGES, onDelta: () => {} });
        assert.equal(out.provider, 'groq');
      },
    ),
  ));

test('une erreur 400 ne déclenche pas de bascule (requête fautive)', () =>
  withGroq(() =>
    withFetch(
      () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }),
      async (urls) => {
        await assert.rejects(
          () => streamCompletion({ config: PRIMARY, messages: MESSAGES, onDelta: () => {} }),
          /400/,
        );
        assert.equal(urls.length, 1, 'aucun autre fournisseur essayé');
      },
    ),
  ));

test('tous les fournisseurs en échec → message qui liste les tentatives', () =>
  withGroq(() =>
    withFetch(
      (url) =>
        new Response(
          JSON.stringify({ error: { message: url.includes('principal') ? 'quota principal' : 'quota groq' } }),
          { status: 429 },
        ),
      async () => {
        await assert.rejects(
          () => streamCompletion({ config: PRIMARY, messages: MESSAGES, onDelta: () => {} }),
          (err) => {
            assert.match(err.message, /Tous les fournisseurs/);
            assert.match(err.message, /principal/);
            assert.match(err.message, /groq/);
            return true;
          },
        );
      },
    ),
  ));

test('sans clé de secours, l’erreur d’origine est remontée telle quelle', () => {
  const avant = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  return withFetch(
    () => new Response(JSON.stringify({ error: { message: 'quota dépassé' } }), { status: 429 }),
    async () => {
      await assert.rejects(
        () => streamCompletion({ config: PRIMARY, messages: MESSAGES, onDelta: () => {} }),
        /quota dépassé/,
      );
    },
  ).finally(() => {
    if (avant !== undefined) process.env.GROQ_API_KEY = avant;
  });
});
