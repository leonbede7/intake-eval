# Architecture and review guide

## Scope

Input: source text plus untrusted model output. Output: rejection reasons or a candidate requiring human review. This is the deterministic boundary after an LLM call, not the LLM itself.

`triage.ts` owns schema checks, evidence checks, and routing. `evaluate.ts` validates fixture expectations and compares outcomes. `cli.ts` handles the original offline regression command.

In v0.2, `provider.ts` adds opt-in DeepSeek and loopback Ollama calls. `prompt.ts` defines a versioned contract without ground-truth labels. `benchmark.ts` compares live or replay candidates with a separately labeled dataset. `benchmark-cli.ts` controls input, paid-call opt-in, limits and local capture. `report.ts` generates a static, escaped HTML report with no client scripts or external assets.

In v0.3, `triage-v2.ts` reuses the original core validation and replaces only its keyword-based routing decision with an explicit review reason and quote. The original validator and prompt remain available so historical results are reproducible. `web/` contains the playground, `build-web.ts` packages reviewed synthetic captures, and TypeScript compiles the same validators for the browser. No duplicate browser-only validation logic is maintained.

`serve.ts` optionally supplies live generation on `127.0.0.1:4317`. Its route allowlist serves only public build assets. Strict Host, Origin and a random per-process token protect the paid endpoint from cross-origin requests and DNS rebinding. Input/body limits, one in-flight request and a 20-attempt lifetime cap bound work. Credentials remain in memory on the local server. Public GitHub Pages has no generation endpoint.

## Decisions

1. Exact quotes make a narrow claim easy to test. Fuzzy matching could silently accept changed numbers or wording. The tradeoff is rejecting harmless formatting changes.
2. Unknown fields are rejected to catch contract drift and unrequested action fields. No property is interpreted as a command.
3. Source-based escalation supplements the model's priority so changing one field cannot hide a literal refund or security keyword. This is a review heuristic, not reliable semantic classification.
4. Every valid candidate still needs review. Syntactic validity and quote presence are insufficient grounds for an automatic reply, refund, or account change.
5. Fixtures contain expected decisions, queues, and optional exact issue-code sets. CI fails on mismatches. There are no fabricated latency, accuracy, or time-saving claims.

## Known failure example

The source asks how to change a plan. The candidate claims an invoice has already been paid while quoting the real phrase “change my plan.” The quote is grounded but does not support the summary. The fixture `semantic-error-still-needs-human` preserves this limitation as an explicit contract. Do not call this hallucination detection.

## Threat and data boundaries

Model output and source text are data. There is no eval, tool execution, database, or shell interpolation. Network calls occur only in explicitly selected live-provider mode, to fixed destinations; no tool calls are enabled. That reduces the impact of malicious instructions here; it does not certify prompt-injection resistance of an upstream model or downstream system.

Reports omit source text, summaries, and evidence. Case IDs appear in reports and errors, so labels must not contain personal information. Exceptions from JSON parsing are replaced with a generic message to avoid echoing malformed input.

A loopback-only demonstration endpoint now exists, with no durable review queue or public paid endpoint. A production service would still need user authentication, durable cross-instance quotas, permissions, retention policy, idempotent approval writes and audit history before connecting real customer workflows. The process-local limit is not a production billing system.

## A focused next version

The provider adapter and provisional labeled development set now exist. A first DeepSeek run is preserved under `docs/results/`. The next step is independent human label review, a held-out test set and a clearer routing policy. Unsupported summary claims still require qualitative review; they are not automatically scored. Cost is an estimate from usage, while latency is measured for completed responses.

## Questions to explain in an interview

- Why can a candidate with a real quote still contain an incorrect summary?
- When would exact matching be too strict, and what new risks would fuzzy matching add?
- Why route using both the source and the generated priority?
- Why do regression fixtures not establish model accuracy?
- What changes before this CLI can serve real users?
