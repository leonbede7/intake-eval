import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createProvider, ProviderError } from './provider.ts';
import type { Provider } from './provider.ts';
import type { Policy } from './prompt.ts';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/reliability.html', ['reliability.html', 'text/html; charset=utf-8']],
  ['/review.html', ['review.html', 'text/html; charset=utf-8']],
  ['/review.css', ['review.css', 'text/css; charset=utf-8']],
  ['/review.js', ['review.js', 'text/javascript; charset=utf-8']],
  ['/lib/human-review.js', ['lib/human-review.js', 'text/javascript; charset=utf-8']],
  ['/data/review.json', ['data/review.json', 'application/json; charset=utf-8']],
  ['/lib/triage.js', ['lib/triage.js', 'text/javascript; charset=utf-8']],
  ['/lib/triage-v2.js', ['lib/triage-v2.js', 'text/javascript; charset=utf-8']],
  ['/data/demo.json', ['data/demo.json', 'application/json; charset=utf-8']],
]);

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function body(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8192) {
        if (!failed) reject(new Error('BODY_TOO_LARGE'));
        failed = true;
        return;
      }
      if (!failed) chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('INVALID_BODY'));
      }
    });
    req.on('error', () => reject(new Error('INVALID_BODY')));
    req.on('aborted', () => reject(new Error('INVALID_BODY')));
  });
}

export function createPlaygroundServer(
  options: {
    live?: boolean;
    apiKey?: string;
    webRoot?: string;
    providerFor?: (policy: Policy) => Provider;
  } = {},
) {
  const live = options.live === true;
  if (live && !options.apiKey?.trim() && !options.providerFor)
    throw new Error('Set DEEPSEEK_API_KEY before starting live mode.');
  const token = randomBytes(32).toString('hex');
  const webRoot = options.webRoot ?? fileURLToPath(new URL('../site/', import.meta.url));
  let remaining = 20;
  let inFlight = false;
  const providerFor =
    options.providerFor ??
    ((policy: Policy) =>
      createProvider({
        name: 'deepseek',
        model: 'deepseek-v4-flash',
        policy,
        apiKey: options.apiKey!,
      }));
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const address = server.address();
    if (!address || typeof address === 'string') {
      json(res, 503, { error: 'Not ready.' });
      return;
    }
    const origin = `http://127.0.0.1:${address.port}`;
    // Strict Host prevents a hostile domain resolving to loopback from reading the token.
    if (req.headers.host !== `127.0.0.1:${address.port}`) {
      json(res, 403, { error: 'Invalid host.' });
      return;
    }
    let path: string;
    try {
      path = new URL(req.url ?? '/', origin).pathname;
    } catch {
      json(res, 400, { error: 'Invalid URL.' });
      return;
    }
    if (path === '/api/config' && req.method === 'GET') {
      json(res, 200, { live, remaining, ...(live ? { token } : {}) });
      return;
    }
    if (path === '/api/generate') {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'POST required.' });
        return;
      }
      if (!live) {
        json(res, 403, { error: 'Live mode is not enabled.' });
        return;
      }
      if (req.headers.origin !== origin || req.headers['x-playground-token'] !== token) {
        json(res, 403, { error: 'Open the local playground before generating.' });
        return;
      }
      if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        json(res, 415, { error: 'JSON required.' });
        return;
      }
      if (Number(req.headers['content-length']) > 8192) {
        req.resume();
        json(res, 413, { error: 'Request is too large.' });
        return;
      }
      if (inFlight) {
        json(res, 429, { error: 'Wait for the current response.', remaining });
        return;
      }
      if (remaining === 0) {
        json(res, 429, {
          error:
            'This session has used its 20-call limit. Restart locally only if you approve further API cost.',
          remaining,
        });
        return;
      }
      let input: unknown;
      try {
        input = await body(req);
      } catch (error) {
        json(res, error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400, {
          error: 'Invalid or oversized request.',
        });
        return;
      }
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        json(res, 400, { error: 'Expected source and policy.' });
        return;
      }
      const { source, policy } = input as Record<string, unknown>;
      if (
        Object.keys(input).some((key) => !['source', 'policy'].includes(key)) ||
        typeof source !== 'string' ||
        source.trim().length < 8 ||
        source.length > 2000 ||
        !['v1', 'v2'].includes(policy as string)
      ) {
        json(res, 400, { error: 'Provide an 8–2,000 character source and policy v1 or v2.' });
        return;
      }
      // Recheck after asynchronous body reading so parallel requests cannot race the cap.
      if (inFlight || remaining === 0) {
        json(res, 429, {
          error: 'Wait for the current response or check the session limit.',
          remaining,
        });
        return;
      }
      inFlight = true;
      remaining--;
      try {
        const result = await providerFor(policy as Policy).generate(source, 'local-playground');
        json(res, 200, { output: result.output, latencyMs: result.latencyMs, remaining });
      } catch (error) {
        json(res, 502, {
          error:
            error instanceof ProviderError
              ? `Model request failed: ${error.code}. No retry was made.`
              : 'Model request failed. No retry was made.',
          remaining,
        });
      } finally {
        inFlight = false;
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) {
      json(res, 405, { error: 'Method not supported.' });
      return;
    }
    const asset = assets.get(path);
    if (!asset) {
      json(res, 404, { error: 'Not found.' });
      return;
    }
    try {
      const data = await readFile(join(webRoot, asset[0]!));
      res.writeHead(200, { 'Content-Type': asset[1]! });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      json(res, 404, { error: 'Run npm run build:web first.' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.timeout = 60_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--live') || args.length > 1)
    throw new Error('Usage: npm run playground -- [--live]');
  const server = createPlaygroundServer({
    live: args.includes('--live'),
    ...(process.env.DEEPSEEK_API_KEY ? { apiKey: process.env.DEEPSEEK_API_KEY } : {}),
  });
  server.on('error', () => {
    console.error('Cannot start playground on 127.0.0.1:4317. Close the previous instance first.');
    process.exitCode = 1;
  });
  server.listen(4317, '127.0.0.1', () =>
    console.log(
      `Playground: http://127.0.0.1:4317\n${args.includes('--live') ? 'Live DeepSeek enabled: at most 20 calls, 512 output tokens each, no automatic retries.' : 'Recorded examples only. No paid API calls.'}`,
    ),
  );
}
