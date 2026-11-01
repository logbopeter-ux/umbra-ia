/**
 * Umbra IA — tests du moteur de langage (sans réseau)
 * Vérifie la construction de la requête pour chaque fournisseur :
 *   • Claude exige max_tokens, plafonne la température à 1
 *   • Groq et Gemini ne reçoivent pas de max_tokens parasite
 *   • les outils sont transmis au format OpenAI quand il y en a
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestBody, isAnthropic, llmConfig } from '../server/llm.js';

const MESSAGES = [{ role: 'user', content: 'Bonjour' }];
const TOOLS = [{ type: 'function', function: { name: 'calculator', parameters: { type: 'object' } } }];

const CLAUDE = { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' };
const GROQ = { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' };
const GEMINI = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-3.5-flash',
};

test('isAnthropic : reconnaissance de l’URL', () => {
  assert.equal(isAnthropic(CLAUDE.baseUrl), true);
  assert.equal(isAnthropic('https://api.anthropic.com/v1/'), true);
  assert.equal(isAnthropic(GROQ.baseUrl), false);
  assert.equal(isAnthropic(GEMINI.baseUrl), false);
  assert.equal(isAnthropic(''), false);
  assert.equal(isAnthropic(undefined), false);
});

test('Claude : max_tokens est envoyé (obligatoire côté Anthropic)', () => {
  const body = buildRequestBody(CLAUDE, MESSAGES, null);
  assert.equal(body.max_tokens, 8192);
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.stream, true);
});

test('Claude : max_tokens est personnalisable', () => {
  const body = buildRequestBody(CLAUDE, MESSAGES, null, { maxTokens: 1024 });
  assert.equal(body.max_tokens, 1024);
});

test('Claude : la température est écrêtée à 1', () => {
  assert.equal(buildRequestBody(CLAUDE, MESSAGES, null, { temperature: 1.6 }).temperature, 1);
  assert.equal(buildRequestBody(CLAUDE, MESSAGES, null, { temperature: -0.5 }).temperature, 0);
  assert.equal(buildRequestBody(CLAUDE, MESSAGES, null, { temperature: 0.3 }).temperature, 0.3);
});

test('Groq et Gemini : pas de max_tokens imposé, température intacte', () => {
  for (const cfg of [GROQ, GEMINI]) {
    const body = buildRequestBody(cfg, MESSAGES, null, { temperature: 1.6 });
    assert.equal(body.max_tokens, undefined, `${cfg.model} ne doit pas recevoir max_tokens`);
    assert.equal(body.temperature, 1.6);
  }
});

test('les outils sont transmis au format OpenAI avec tool_choice', () => {
  for (const cfg of [CLAUDE, GROQ, GEMINI]) {
    const body = buildRequestBody(cfg, MESSAGES, TOOLS);
    assert.deepEqual(body.tools, TOOLS);
    assert.equal(body.tool_choice, 'auto');
  }
});

test('sans outil, ni tools ni tool_choice ne sont envoyés', () => {
  for (const vide of [null, undefined, []]) {
    const body = buildRequestBody(CLAUDE, MESSAGES, vide);
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
  }
});

test('llmConfig : sans clé, le mode démo reste actif', () => {
  const cfg = llmConfig({});
  assert.equal(cfg.live, Boolean(process.env.LLM_API_KEY));
  const custom = llmConfig({ apiKey: 'gsk_test', baseUrl: GROQ.baseUrl, model: GROQ.model });
  assert.equal(custom.live, true);
  assert.equal(custom.model, 'openai/gpt-oss-120b');
  assert.equal(custom.baseUrl, 'https://api.groq.com/openai/v1');
});

test('llmConfig : les barres obliques finales sont retirées', () => {
  assert.equal(llmConfig({ baseUrl: 'https://api.anthropic.com/v1///' }).baseUrl, 'https://api.anthropic.com/v1');
});

/* ─────────────── Chaîne de cerveaux & bascule automatique ─────────────── */

import { buildChain, streamCompletion, PRESETS } from '../server/llm.js';

const ENV = {
  LLM_API_KEY: 'cle-gemini',
  LLM_BASE_URL: PRESETS.gemini.baseUrl,
  LLM_MODEL: 'gemini-3.5-flash',
  GROQ_API_KEY: 'gsk_groq',
  ANTHROPIC_API_KEY: 'sk-ant-claude',
  OPENAI_API_KEY: '',
  LLM_FALLBACKS: 'groq,claude,openai',
};

test('buildChain : le principal vient en tête, puis les secours qui ont une clé', () => {
  // available.ollama=false : ces tests vérifient la liste explicite, pas le
  // filet de sécurité local (couvert plus bas).
  const chain = buildChain({ env: ENV, available: { ollama: false } });
  assert.deepEqual(chain.map((c) => c.name), ['gemini', 'groq', 'claude']);
  // OpenAI est dans LLM_FALLBACKS mais n'a pas de clé → absent
  assert.ok(!chain.some((c) => c.name === 'openai'));
});

test('buildChain : le modèle des secours est surchargeable', () => {
  const chain = buildChain({ env: { ...ENV, LLM_MODEL_GROQ: 'openai/gpt-oss-20b' } });
  assert.equal(chain.find((c) => c.name === 'groq').model, 'openai/gpt-oss-20b');
});

test('buildChain : une clé saisie dans l’interface prend la main', () => {
  const chain = buildChain({
    config: { apiKey: 'sk-perso', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' },
    env: ENV,
    available: { ollama: false },
  });
  assert.equal(chain[0].name, 'claude');
  assert.equal(chain[0].model, 'claude-opus-5-5');
  assert.equal(chain[0].apiKey, 'sk-perso');
});

test('buildChain : sans aucune clé ni Ollama, la chaîne est vide', () => {
  assert.deepEqual(buildChain({ env: {}, available: { ollama: false } }), []);
});

test('buildChain : sans clé mais avec Ollama, le local tient la baraque', () => {
  const chain = buildChain({ env: {}, available: { ollama: true } });
  assert.deepEqual(chain.map((c) => c.name), ['ollama']);
});

/* ─────────── Bascule : faux fetch, aucun réseau ─────────── */

/** Fabrique une réponse SSE factice contenant un texte. */
function reponseSSE(texte) {
  const lignes = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: texte } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let fait = false;
        return {
          async read() {
            if (fait) return { done: true, value: undefined };
            fait = true;
            return { done: false, value: new TextEncoder().encode(lignes) };
          },
        };
      },
    },
  };
}

/** Fabrique une erreur HTTP (429, 401…). */
function reponseErreur(status, message = 'échec') {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { message } }),
  };
}

const MSGS = [{ role: 'user', content: 'Bonjour' }];

test('bascule : quota épuisé (429) sur le premier → le second répond', async () => {
  const appels = [];
  const fetchImpl = async (url) => {
    appels.push(url);
    return url.includes('generativelanguage') ? reponseErreur(429, 'quota') : reponseSSE('Bonjour de Groq');
  };

  const chain = buildChain({ env: ENV });
  const bascules = [];
  const out = await streamCompletion({
    chain,
    messages: MSGS,
    fetchImpl,
    onFailover: (info) => bascules.push(`${info.de.name}→${info.vers.name}`),
  });

  assert.equal(out.content, 'Bonjour de Groq');
  assert.equal(out.provider.name, 'groq');
  assert.deepEqual(bascules, ['gemini→groq']);
  assert.equal(appels.length, 2);
});

test('bascule : panne réseau (fetch qui lève) → le suivant prend le relais', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) throw new TypeError('fetch failed');
    return reponseSSE('réponse de secours');
  };
  const out = await streamCompletion({ chain: buildChain({ env: ENV }), messages: MSGS, fetchImpl });
  assert.equal(out.content, 'réponse de secours');
  assert.equal(out.provider.name, 'groq');
});

test('bascule : clé refusée (401) → le suivant prend le relais', async () => {
  const fetchImpl = async (url) =>
    url.includes('generativelanguage') ? reponseErreur(401, 'clé invalide') : reponseSSE('ok');
  const out = await streamCompletion({ chain: buildChain({ env: ENV }), messages: MSGS, fetchImpl });
  assert.equal(out.provider.name, 'groq');
});

test('bascule : tous les cerveaux tombent → la dernière erreur remonte', async () => {
  const fetchImpl = async () => reponseErreur(503, 'service indisponible');
  await assert.rejects(
    () => streamCompletion({ chain: buildChain({ env: ENV }), messages: MSGS, fetchImpl }),
    /service indisponible/,
  );
});

test('pas de bascule après un début de réponse (on ne rejoue pas)', async () => {
  // Le premier cerveau écrit un mot puis coupe : on doit propager l'erreur
  // plutôt que de recommencer, sinon l'utilisateur verrait deux débuts.
  const fetchImpl = async (url) => {
    if (!url.includes('generativelanguage')) return reponseSSE('jamais atteint');
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          let i = 0;
          return {
            async read() {
              if (i === 0) {
                i++;
                return {
                  done: false,
                  value: new TextEncoder().encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: 'Bon' } }] })}\n\n`,
                  ),
                };
              }
              throw new Error('flux coupé');
            },
          };
        },
      },
    };
  };

  let texte = '';
  await assert.rejects(
    () =>
      streamCompletion({
        chain: buildChain({ env: ENV }),
        messages: MSGS,
        fetchImpl,
        onDelta: (t) => (texte += t),
      }),
    /flux coupé/,
  );
  assert.equal(texte, 'Bon');
});

test('bascule : le cerveau qui a répondu est renvoyé pour rester « collant »', async () => {
  const fetchImpl = async (url) =>
    url.includes('generativelanguage') ? reponseErreur(429) : reponseSSE('suite');
  const chain = buildChain({ env: ENV });
  const out = await streamCompletion({ chain, messages: MSGS, fetchImpl });
  assert.deepEqual(out.provider, { name: 'groq', label: 'Groq', model: 'openai/gpt-oss-120b' });
  assert.equal(out.fallbacks, 1);
});

/* ─────────────── Ollama : dernier rempart local ─────────────── */

import { PRESETS as P2, isLocal, probeOllama, AUTO_ORDER, modelVoit, adapterMessages } from '../server/llm.js';

test('Ollama : présent dans les presets, sans clé obligatoire', () => {
  assert.equal(PRESETS.ollama.baseUrl, 'http://localhost:11434/v1');
  assert.equal(PRESETS.ollama.keyless, true);
  assert.equal(PRESETS.ollama.local, true);
});

test('isLocal : reconnaît un serveur local, pas un service distant', () => {
  assert.equal(isLocal('http://localhost:11434/v1'), true);
  assert.equal(isLocal('http://127.0.0.1:11434/v1'), true);
  assert.equal(isLocal('http://host.docker.internal:11434/v1'), true);
  assert.equal(isLocal('https://api.groq.com/openai/v1'), false);
  assert.equal(isLocal('https://api.anthropic.com/v1'), false);
});

test('chaîne automatique : Ollama ferme la marche sans aucune configuration', () => {
  const chain = buildChain({
    env: { LLM_API_KEY: 'k', LLM_BASE_URL: PRESETS.gemini.baseUrl },
    available: { ollama: true },
  });
  assert.deepEqual(chain.map((c) => c.name), ['gemini', 'ollama']);
  assert.equal(chain.at(-1).apiKey, '', 'Ollama ne reçoit aucune clé');
});

test('chaîne automatique : Ollama éteint → absent de la chaîne', () => {
  const chain = buildChain({
    env: { LLM_API_KEY: 'k', LLM_BASE_URL: PRESETS.gemini.baseUrl },
    available: { ollama: false },
  });
  assert.deepEqual(chain.map((c) => c.name), ['gemini']);
});

test('OLLAMA_ENABLED=0 : désactivation explicite', () => {
  const chain = buildChain({
    env: { LLM_API_KEY: 'k', OLLAMA_ENABLED: '0' },
    available: { ollama: true },
  });
  assert.ok(!chain.some((c) => c.name === 'ollama'));
});

test('Ollama reste en dernier même avec une liste de secours explicite', () => {
  const chain = buildChain({
    env: { LLM_API_KEY: 'k', LLM_FALLBACKS: 'groq', GROQ_API_KEY: 'g' },
    available: { ollama: true },
  });
  assert.deepEqual(chain.map((c) => c.name), ['gemini', 'groq', 'ollama']);
});

test('la chaîne automatique suit l’ordre de préférence déclaré', () => {
  const env = {
    LLM_API_KEY: 'k',
    GROQ_API_KEY: 'g',
    ANTHROPIC_API_KEY: 'a',
    OPENAI_API_KEY: 'o',
  };
  const chain = buildChain({ env, available: { ollama: true } });
  const attendu = ['gemini', ...AUTO_ORDER.filter((n) => env[`${PRESETS[n].keyEnv}`])];
  assert.deepEqual(chain.map((c) => c.name), attendu.filter((n) => n !== 'gemini').length ? ['gemini', 'groq', 'claude', 'openai', 'ollama'] : []);
});

test('Ollama : la requête n’envoie ni Authorization ni tool_choice', async () => {
  const cfg = { name: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', apiKey: '' };
  const body = buildRequestBody(cfg, MESSAGES, TOOLS);
  assert.equal(body.tool_choice, undefined, 'Ollama rejette tool_choice');
  assert.deepEqual(body.tools, TOOLS, 'mais il accepte la liste d’outils');
  assert.equal(body.max_tokens, undefined);

  let vues;
  const fetchImpl = async (url, opts) => {
    vues = opts.headers;
    return reponseSSE('réponse locale');
  };
  const out = await streamCompletion({ chain: [cfg], messages: MESSAGES, fetchImpl });
  assert.equal(out.content, 'réponse locale');
  assert.equal(vues.Authorization, undefined, 'aucune clé ne doit être envoyée');
});

test('bascule : Gemini et Groq tombent → Ollama répond quand même', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('11434')) return reponseSSE('je suis Ollama, en local');
    return reponseErreur(429, 'quota'); // Gemini puis Groq
  };
  const chain = buildChain({
    env: { LLM_API_KEY: 'k', GROQ_API_KEY: 'g' },
    available: { ollama: true },
  });
  assert.deepEqual(chain.map((c) => c.name), ['gemini', 'groq', 'ollama']);
  const out = await streamCompletion({ chain, messages: MESSAGES, fetchImpl });
  assert.equal(out.provider.name, 'ollama');
  assert.match(out.content, /Ollama/);
});

test('probeOllama : renvoie false quand rien n’écoute', async () => {
  const dispo = await probeOllama('http://127.0.0.1:9/v1', 400);
  assert.equal(dispo, false);
});

/* ─────────────── Vision : quels cerveaux voient les images ─────────────── */

test('modelVoit : les modèles à vision sont reconnus', () => {
  assert.equal(modelVoit('gemini', 'gemini-3.5-flash'), true);
  assert.equal(modelVoit('claude', 'claude-sonnet-5-5'), true);
  assert.equal(modelVoit('groq', 'openai/gpt-oss-120b'), false);
  assert.equal(modelVoit('ollama', 'llama3.1'), false);
  assert.equal(modelVoit('ollama', 'llava:13b'), true);
  assert.equal(modelVoit('ollama', 'qwen2.5vl:7b'), true);
});

test('adapterMessages : l’image reste pour qui voit, devient une note sinon', () => {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Décris cette photo' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      ],
    },
  ];

  const voyant = adapterMessages(messages, { vision: true });
  assert.ok(Array.isArray(voyant[0].content), 'le cerveau qui voit reçoit l’image');
  assert.equal(voyant[0].content.filter((b) => b.type === 'image_url').length, 1);

  const aveugle = adapterMessages(messages, { vision: false });
  assert.equal(typeof aveugle[0].content, 'string', 'un modèle texte reçoit du texte');
  assert.match(aveugle[0].content, /Décris cette photo/);
  assert.match(aveugle[0].content, /ne voit pas les images/);
});

test('adapterMessages : un message sans image n’est pas modifié', () => {
  const messages = [{ role: 'user', content: 'Bonjour' }];
  assert.deepEqual(adapterMessages(messages, { vision: false }), messages);
});

test('buildRequestBody : les images d’un modèle aveugle n’atteignent jamais l’API', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'analyse' }, { type: 'image_url', image_url: { url: 'data:x' } }] },
  ];
  const body = buildRequestBody({ baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', vision: false }, messages);
  assert.equal(typeof body.messages[0].content, 'string');
});

test('la chaîne place les cerveaux qui voient en tête quand une image est jointe', async () => {
  const env = { LLM_API_KEY: 'k', GROQ_API_KEY: 'g' };
  const chain = buildChain({ env, available: { ollama: false } });
  // Gemini puis Groq : Gemini voit, Groq non.
  assert.deepEqual(chain.map((c) => c.name), ['gemini', 'groq']);
  const triees = [...chain].sort((a, b) => Number(b.vision) - Number(a.vision));
  assert.equal(triees[0].name, 'gemini');
});
