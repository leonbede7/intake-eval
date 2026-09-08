import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPlaygroundServer } from '../src/serve.ts';
import type { Provider } from '../src/provider.ts';

const sample: Provider = {
  name: 'deepseek',
  model: 'test',
  async generate() {
    return { output: '{}', model: 'test', latencyMs: 1, usage: null };
  },
};

async function start(t: TestContext, live = true, provider: Provider = sample) {
  const server = createPlaygroundServer({ live, providerFor: () => provider });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const config = (await (await fetch(`${origin}/api/config`)).json()) as {
    token?: string;
    live: boolean;
    remaining: number;
  };
  const post = (data: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}/api/generate`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'X-Playground-Token': config.token ?? '',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(data),
    });
  return { origin, config, post };
}

test('static mode has no generation capability and exposes no session token', async (t) => {
  const { config, post } = await start(t, false);
  assert.equal(config.live, false);
  assert.equal(config.token, undefined);
  assert.equal((await post({ source: 'A synthetic source', policy: 'v2' })).status, 403);
});
test('local API requires matching origin and session token', async (t) => {
  const { post } = await start(t);
  const input = { source: 'A synthetic source', policy: 'v2' };
  assert.equal((await post(input, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await post(input, { 'X-Playground-Token': 'wrong' })).status, 403);
  const result = await post(input);
  assert.equal(result.status, 200);
  assert.equal(((await result.json()) as { remaining: number }).remaining, 19);
});
test('bad payloads and unsupported content types do not consume calls', async (t) => {
  const { post, origin } = await start(t);
  for (const data of [
    null,
    { source: 'short', policy: 'v2' },
    { source: 'x'.repeat(2001), policy: 'v2' },
    { source: 'A synthetic source', policy: 'v3' },
    { source: 'A synthetic source', policy: 'v2', apiKey: 'not-accepted' },
  ])
    assert.equal((await post(data)).status, 400);
  assert.equal((await post({ source: 'x'.repeat(9000), policy: 'v2' })).status, 413);
  assert.equal((await post({}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(
    ((await (await fetch(`${origin}/api/config`)).json()) as { remaining: number }).remaining,
    20,
  );
});
test('session has a hard 20-attempt cap and refuses further calls', async (t) => {
  let calls = 0;
  const { post } = await start(t, true, {
    ...sample,
    async generate(...args) {
      calls++;
      return sample.generate(...args);
    },
  });
  for (let i = 0; i < 20; i++)
    assert.equal((await post({ source: 'A synthetic source', policy: 'v2' })).status, 200);
  assert.equal((await post({ source: 'A synthetic source', policy: 'v2' })).status, 429);
  assert.equal(calls, 20);
});
test('concurrent generations cannot race the request limit', async (t) => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const { post } = await start(t, true, {
    ...sample,
    async generate(...args) {
      entered();
      await gate;
      return sample.generate(...args);
    },
  });
  const first = post({ source: 'A synthetic source', policy: 'v2' });
  await ready;
  try {
    assert.equal((await post({ source: 'Another synthetic source', policy: 'v2' })).status, 429);
  } finally {
    release();
  }
  assert.equal((await first).status, 200);
});
test('provider failures consume an attempt but never leak a raw exception', async (t) => {
  const { post } = await start(t, true, {
    ...sample,
    async generate() {
      throw new Error('private source and fake-secret-value');
    },
  });
  const response = await post({ source: 'A synthetic source', policy: 'v2' });
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes('fake-secret-value'), false);
  assert.equal(JSON.parse(text).remaining, 19);
});
test('server only serves explicitly allowed public assets', async (t) => {
  const { origin } = await start(t, false);
  for (const path of ['/package.json', '/.env', '/src/provider.ts', '/local-data/candidates.json'])
    assert.equal((await fetch(`${origin}${path}`)).status, 404);
});
