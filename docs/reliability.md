# Failure lab

[Read the report](https://leonbede7.github.io/intake-eval/reliability.html) or run `npm run reliability` with Node.js 24 or later. This command needs no dependency installation, provider account or API key.

## What runs

The harness starts a local HTTP server on an ephemeral loopback port. Fifteen AI-authored synthetic scenarios feed the production DeepSeek response parser and V2 validator through the adapter's existing injectable fetch function. That function sends requests only to the local server. The production adapter's fixed official destination is unchanged. The harness uses a dummy credential and never reads credentials from the environment.

Real Node fetch is used for connection failures, stalled headers, stalled response bodies and oversized chunked responses. The 250 ms timeout applies only to the two deliberately stalled fixtures. It is not a latency benchmark or a proposed production timeout. The regular adapter default remains 45 seconds.

Fourteen scenarios check specified transport and validation behavior. One separate case deliberately demonstrates a known semantic limitation. Each records expected behavior, observed behavior and the number of adapter attempts. The suite expects one attempt per scenario. No automatic retry is introduced.

The CLI exits with 0 when expectations match, 1 when behavior differs, and 2 for usage or setup failures. Reports are written to the dedicated `local-data/reliability/` directory and replaced on subsequent runs. The public reviewed snapshot lives in `docs/results/reliability/`. To refresh it deliberately, run `npm run reliability -- --publish`, inspect the diff, then run `npm run check`.

## A failure found and fixed

The first run exposed a permissive decoding path. `Buffer.toString('utf8')` silently replaced an invalid byte inside a JSON string with the Unicode replacement character. The provider parser accepted the changed text, and the candidate continued to standard human review.

The fixture injects byte `0xff` inside a syntactically valid provider response. The summary remains long enough to pass the candidate schema, and its evidence is an exact source quote. This isolates transport decoding from schema rejection.

The adapter now uses a fatal UTF-8 decoder before parsing JSON. The same faulty response produces `INVALID_RESPONSE`, while valid non-ASCII responses still work. The maximum 128,000-byte response size and 20,000-character candidate size are unchanged.

| Scenario                            | Before                     | After                             |
| ----------------------------------- | -------------------------- | --------------------------------- |
| Invalid UTF-8 inside candidate text | `review_required:standard` | `provider_error:INVALID_RESPONSE` |
| Valid Unicode                       | `review_required:standard` | `review_required:standard`        |
| Quote present but summary false     | `review_required:standard` | `review_required:standard`        |

The [before snapshot](results/reliability/before-utf8-fix.json) was captured against provider code from commit `4fcc48b`, with the new fault harness. It is not an earlier production incident or a live model run. The [after snapshot](results/reliability/report.json) records the updated behavior. Both include a fingerprint over the code used by that run. The harness evolved during development, so compare the individual observations rather than expecting the entire snapshots to be identical.

## What still needs a person

The known-limit case retains the quote "The export button gives an error" but claims the customer successfully exported the report. The validator verifies quote occurrence and schema, then sends the result to human review. It does not identify the contradiction.

This deliberately passing structural check must not be described as a correct summary, safe automatic action or proof that hallucinations are solved. Semantic correctness still needs independently reviewed labels and human judgment. The report keeps this case separate from the 14 contract checks.

## Reproducibility and limits

- `npm test` reruns the local HTTP scenarios and compares the complete result to the published snapshot. A changed observation or source fingerprint requires explicit review and a refreshed snapshot.
- The SHA-256 fingerprint covers the harness, provider, prompt and both validators, with line endings normalized. Timing measurements are omitted so the result is stable across machines.
- The public HTML is a saved report, not a browser test runner. Reading it makes no model request and does not start a local server.
- Synthetic injected failures establish behavior for these cases only. They do not measure production availability, concurrent-user capacity, provider incident frequency or model accuracy.
- The harness does not test real provider authentication, billing, DNS, TLS or service-level guarantees. Existing local-server tests separately cover the session limit, request origin and concurrent generation.

Implementation: [harness](../src/reliability.ts), [provider boundary](../src/provider.ts), [regression check](../test/reliability.test.ts). Built with Codex assistance; no private dealership data is included.
