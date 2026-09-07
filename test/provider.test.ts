import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderError } from '../src/provider.ts';
import { messagesFor, PROMPT_HASH } from '../src/prompt.ts';

const cloud = (overrides = {}) => ({
  model: 'deepseek-v4-flash',
  choices: [{ finish_reason: 'stop', message: { content: '{"summary":"Example summary"}' } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
  ...overrides,
});
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const expectCode = (code: string) => (error: unknown) =>
  error instanceof ProviderError && error.code === code && error.message === code;

test('cloud adapter sends only source and prompt with explicit bounds', async () => {
  const provider = createProvider({
    name: 'deepseek',
    model: 'deepseek-v4-flash',
    apiKey: 'fake-test-credential',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(init!.body as string);
      assert.deepEqual(body.messages, messagesFor('A synthetic source'));
      assert.equal(body.max_tokens, 512);
      assert.equal(body.thinking.type, 'disabled');
      assert.equal(body.response_format.type, 'json_object');
      assert.equal(body.stream, false);
      assert.equal(JSON.stringify(body).includes('expected'), false);
      return response(cloud());
    },
  });
  const result = await provider.generate('A synthetic source', 'unshared-id');
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 20 });
  assert.ok(result.latencyMs! >= 0);
  assert.match(PROMPT_HASH, /^[a-f0-9]{64}$/);
});
test('local adapter never sends the cloud key and uses loopback only', async () => {
  const provider = createProvider({
    name: 'ollama',
    model: 'local-model:small',
    apiKey: 'must-not-leak',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      assert.equal(JSON.parse(init!.body as string).options.num_predict, 512);
      return response({
        model: 'local-model:small',
        done: true,
        done_reason: 'stop',
        message: { content: '{}' },
      });
    },
  });
  const result = await provider.generate('Synthetic request', 'local');
  assert.equal(result.usage, null);
});
test('missing credentials fail before any network call', () => {
  assert.throws(
    () => createProvider({ name: 'deepseek', model: 'deepseek-v4-flash' }),
    /DEEPSEEK_API_KEY/,
  );
});
test('HTTP errors and low-level errors do not echo bodies or credentials', async () => {
  for (const [request, code] of [
    [async () => new Response('private source or token', { status: 401 }), 'HTTP_ERROR'],
    [
      async () => {
        throw new Error('private source or token');
      },
      'NETWORK_ERROR',
    ],
    [
      async () => {
        throw new DOMException('private source', 'TimeoutError');
      },
      'TIMEOUT',
    ],
  ] as const) {
    const provider = createProvider({
      name: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: 'test-only',
      fetchImpl: request,
    });
    await assert.rejects(provider.generate('synthetic', 'case'), expectCode(code));
  }
});
test('truncation and content filters are provider failures, not scorable output', async () => {
  for (const finish_reason of [
    'length',
    'content_filter',
    'tool_calls',
    'insufficient_system_resource',
  ]) {
    const provider = createProvider({
      name: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: 'test-only',
      fetchImpl: async () =>
        response(cloud({ choices: [{ finish_reason, message: { content: '{}' } }] })),
    });
    await assert.rejects(provider.generate('synthetic', 'case'), expectCode('INCOMPLETE_OUTPUT'));
  }
});
test('malformed, missing and empty model output are rejected', async () => {
  for (const value of [
    null,
    {},
    cloud({ choices: [] }),
    cloud({ choices: [{ finish_reason: 'stop', message: { content: ' ' } }] }),
  ]) {
    const provider = createProvider({
      name: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: 'test-only',
      fetchImpl: async () => response(value),
    });
    await assert.rejects(provider.generate('synthetic', 'case'), expectCode('INVALID_RESPONSE'));
  }
});
test('oversized response is rejected without trusting Content-Length', async () => {
  const provider = createProvider({
    name: 'deepseek',
    model: 'deepseek-v4-flash',
    apiKey: 'test-only',
    fetchImpl: async () => new Response('x'.repeat(128_001)),
  });
  await assert.rejects(provider.generate('synthetic', 'case'), expectCode('INVALID_RESPONSE'));
});
test('invalid token counters are unavailable rather than fabricated zeros', async () => {
  const provider = createProvider({
    name: 'deepseek',
    model: 'deepseek-v4-flash',
    apiKey: 'test-only',
    fetchImpl: async () => response(cloud({ usage: { prompt_tokens: -1, completion_tokens: 20 } })),
  });
  assert.equal((await provider.generate('synthetic', 'case')).usage, null);
});
