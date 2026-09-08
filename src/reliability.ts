import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createProvider, ProviderError } from './provider.ts';
import { reviewCandidateV2 } from './triage-v2.ts';

const SOURCE = 'The export button gives an error. Please help me download the report.';
const PRIVATE_MARKER = 'synthetic-private-marker-do-not-publish';
const candidate = {
  summary: 'The customer cannot export the report.',
  category: 'technical',
  priority: 'normal',
  evidence: ['The export button gives an error'],
  reviewReason: 'none',
  reviewEvidence: null,
};
function envelope(output = JSON.stringify(candidate), finish = 'stop') {
  return JSON.stringify({
    model: 'local-fault-fixture',
    choices: [{ finish_reason: finish, message: { content: output } }],
    usage: { prompt_tokens: 30, completion_tokens: 40 },
  });
}

interface Scenario {
  id: string;
  title: string;
  layer: 'transport' | 'validation' | 'known_limit';
  description: string;
  expected: string;
  timeoutMs?: number;
  serve(res: ServerResponse): void;
}
const scenarios: Scenario[] = [
  {
    id: 'valid-response',
    title: 'A complete response',
    layer: 'transport',
    description: 'A valid provider envelope reaches the same V2 validator used by the playground.',
    expected: 'review_required:standard',
    serve: (r) => r.end(envelope()),
  },
  {
    id: 'unicode-response',
    title: 'Valid Unicode survives decoding',
    layer: 'transport',
    description:
      'An accented summary remains valid UTF-8. This checks decoding, not translation quality.',
    expected: 'review_required:standard',
    serve: (r) =>
      r.end(
        envelope(JSON.stringify({ ...candidate, summary: 'Korisnik ne može izvesti izvještaj.' })),
      ),
  },
  {
    id: 'rate-limit',
    title: 'Provider returns HTTP 429',
    layer: 'transport',
    description:
      'The server sends a rate limit and Retry-After header. The adapter makes one attempt and returns a sanitized error.',
    expected: 'provider_error:HTTP_ERROR',
    serve: (r) => {
      r.writeHead(429, { 'Retry-After': '30' });
      r.end(PRIVATE_MARKER);
    },
  },
  {
    id: 'unavailable',
    title: 'Provider returns HTTP 503',
    layer: 'transport',
    description:
      'An unavailable service is not counted as a validated model response. Its response body is not exposed.',
    expected: 'provider_error:HTTP_ERROR',
    serve: (r) => {
      r.writeHead(503);
      r.end(PRIVATE_MARKER);
    },
  },
  {
    id: 'disconnect',
    title: 'Connection closes before a response',
    layer: 'transport',
    description:
      'The local server closes the socket. A network error is returned without automatically repeating the call.',
    expected: 'provider_error:NETWORK_ERROR',
    serve: (r) => r.destroy(),
  },
  {
    id: 'truncated',
    title: 'Model reaches its output limit',
    layer: 'transport',
    description:
      'Even parseable candidate JSON is not used when the provider reports an incomplete finish.',
    expected: 'provider_error:INCOMPLETE_OUTPUT',
    serve: (r) => r.end(envelope(JSON.stringify(candidate), 'length')),
  },
  {
    id: 'malformed-envelope',
    title: 'Response is not JSON',
    layer: 'transport',
    description: 'An HTML-shaped error page cannot become a candidate, even with HTTP 200.',
    expected: 'provider_error:INVALID_RESPONSE',
    serve: (r) => r.end('<html>' + PRIVATE_MARKER + '</html>'),
  },
  {
    id: 'invalid-utf8',
    title: 'A response contains a corrupt UTF-8 byte',
    layer: 'transport',
    description:
      'A bad byte inside a JSON string must be rejected, rather than silently replaced with a different character.',
    expected: 'provider_error:INVALID_RESPONSE',
    serve: (r) => {
      const raw = envelope(
        JSON.stringify({
          ...candidate,
          summary: 'Customer asked for CORRUPT_BYTE inside a report.',
        }),
      );
      const at = raw.indexOf('CORRUPT_BYTE');
      r.end(
        Buffer.concat([
          Buffer.from(raw.slice(0, at)),
          Buffer.from([0xff]),
          Buffer.from(raw.slice(at + 12)),
        ]),
      );
    },
  },
  {
    id: 'oversized-stream',
    title: 'Chunked response exceeds the byte limit',
    layer: 'transport',
    description:
      'More than 128,000 response bytes arrive without Content-Length. The adapter stops reading and rejects the response.',
    expected: 'provider_error:INVALID_RESPONSE',
    serve: (r) => {
      r.writeHead(200, { 'Transfer-Encoding': 'chunked' });
      r.write(' '.repeat(64000));
      r.end(' '.repeat(64001));
    },
  },
  {
    id: 'headers-timeout',
    title: 'Server never sends response headers',
    layer: 'transport',
    description:
      'The real fetch request is aborted at the configured 250 ms test deadline. No retry is made.',
    expected: 'provider_error:TIMEOUT',
    timeoutMs: 250,
    serve: () => {},
  },
  {
    id: 'body-timeout',
    title: 'Headers arrive, then the body stalls',
    layer: 'transport',
    description: 'The deadline also covers reading the response stream after headers have arrived.',
    expected: 'provider_error:TIMEOUT',
    timeoutMs: 250,
    serve: (r) => {
      r.writeHead(200, { 'Content-Type': 'application/json' });
      r.flushHeaders();
      r.write('{"model":"local');
    },
  },
  {
    id: 'invalid-candidate',
    title: 'Envelope is valid, candidate JSON is broken',
    layer: 'validation',
    description: 'Transport success does not bypass candidate validation.',
    expected: 'rejected:INVALID_JSON',
    serve: (r) => r.end(envelope('{broken')),
  },
  {
    id: 'invented-evidence',
    title: 'Evidence is absent from the request',
    layer: 'validation',
    description:
      'A plausible candidate with an invented quote is rejected by exact source matching.',
    expected: 'rejected:UNGROUNDED_EVIDENCE',
    serve: (r) =>
      r.end(
        envelope(
          JSON.stringify({ ...candidate, evidence: ['Please delete my account immediately'] }),
        ),
      ),
  },
  {
    id: 'unexpected-action',
    title: 'Candidate adds an execute field',
    layer: 'validation',
    description: 'Unexpected fields are rejected. The harness has no action execution step.',
    expected: 'rejected:INVALID_SCHEMA',
    serve: (r) => r.end(envelope(JSON.stringify({ ...candidate, execute: 'send_reply' }))),
  },
  {
    id: 'false-summary',
    title: 'A false summary with a real quote',
    layer: 'known_limit',
    description:
      'The candidate says the export succeeded, contradicting the request. Exact quote matching still routes it to a human. This is a reproduced limitation, not a claim of semantic correctness.',
    expected: 'review_required:standard',
    serve: (r) =>
      r.end(
        envelope(
          JSON.stringify({
            ...candidate,
            summary: 'The customer successfully exported the report and needs no help.',
          }),
        ),
      ),
  },
];

export interface ReliabilityRow {
  id: string;
  title: string;
  layer: Scenario['layer'];
  description: string;
  expected: string;
  observed: string;
  attempts: number;
  matched: boolean;
}
export interface ReliabilityReport {
  kind: 'offline_fault_injection';
  policy: 'v2';
  codeHash: string;
  methodology: string;
  source: string;
  knownLimitCandidate: typeof candidate;
  checks: number;
  matched: number;
  knownLimits: number;
  knownLimitsMatched: number;
  regressions: number;
  rows: ReliabilityRow[];
}

/** Local HTTP faults exercise the real fetch transport and production V2 boundary. */
export async function runReliability(): Promise<ReliabilityReport> {
  const server = createServer((req, res) => {
    req.resume();
    const scenario = scenarios.find((s) => req.url === '/' + s.id);
    if (!scenario) {
      res.writeHead(404);
      res.end();
      return;
    }
    scenario.serve(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local fault server did not start.');
  const origin = `http://127.0.0.1:${address.port}`;
  const rows: ReliabilityRow[] = [];
  try {
    for (const scenario of scenarios) {
      let attempts = 0;
      const provider = createProvider({
        name: 'deepseek',
        model: 'local-fault-fixture',
        apiKey: 'offline-test-credential',
        policy: 'v2',
        timeoutMs: scenario.timeoutMs ?? 10000,
        fetchImpl: async (url, init) => {
          attempts++;
          if (url !== 'https://api.deepseek.com/chat/completions')
            throw new Error('Unexpected adapter destination.');
          // Only this test seam redirects transport, always to our own loopback server.
          return fetch(origin + '/' + scenario.id, init);
        },
      });
      let observed: string;
      try {
        const result = await provider.generate(SOURCE, scenario.id);
        const review = reviewCandidateV2(SOURCE, result.output);
        observed =
          review.decision === 'rejected'
            ? 'rejected:' +
              review.issues
                .map((x) => x.code)
                .sort()
                .join(',')
            : 'review_required:' + review.queue;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        if (error.message.includes(PRIVATE_MARKER) || error.message !== error.code)
          throw new Error('Provider error leaked fixture details.');
        observed = 'provider_error:' + error.code;
      }
      rows.push({
        id: scenario.id,
        title: scenario.title,
        layer: scenario.layer,
        description: scenario.description,
        expected: scenario.expected,
        observed,
        attempts,
        matched: observed === scenario.expected && attempts === 1,
      });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  const hash = createHash('sha256');
  for (const file of ['reliability.ts', 'provider.ts', 'prompt.ts', 'triage.ts', 'triage-v2.ts']) {
    hash.update(file + '\n');
    hash.update((await readFile(new URL(file, import.meta.url), 'utf8')).replaceAll('\r\n', '\n'));
  }
  return {
    kind: 'offline_fault_injection',
    policy: 'v2',
    codeHash: hash.digest('hex'),
    methodology:
      'AI-authored synthetic faults served by a local HTTP server. Real fetch, provider parsing and V2 validation are executed. No model is called and no API key is read. These results measure specified failure behavior, not model accuracy or production reliability.',
    source: SOURCE,
    knownLimitCandidate: {
      ...candidate,
      summary: 'The customer successfully exported the report and needs no help.',
    },
    checks: rows.filter((x) => x.layer !== 'known_limit').length,
    matched: rows.filter((x) => x.layer !== 'known_limit' && x.matched).length,
    knownLimits: rows.filter((x) => x.layer === 'known_limit').length,
    knownLimitsMatched: rows.filter((x) => x.layer === 'known_limit' && x.matched).length,
    regressions: rows.filter((x) => !x.matched).length,
    rows,
  };
}
