# Architecture and review guide

## Scope

Input: source text plus untrusted model output. Output: rejection reasons or a candidate requiring human review. This is the deterministic boundary after an LLM call, not the LLM itself.

`triage.ts` owns schema checks, evidence checks, and routing. `evaluate.ts` validates fixture expectations and compares outcomes. `cli.ts` handles file input, reports, and exit codes. No module sends data to a service.

## Decisions

1. Exact quotes make a narrow claim easy to test. Fuzzy matching could silently accept changed numbers or wording. The tradeoff is rejecting harmless formatting changes.
2. Unknown fields are rejected to catch contract drift and unrequested action fields. No property is interpreted as a command.
3. Source-based escalation supplements the model's priority so changing one field cannot hide a literal refund or security keyword. This is a review heuristic, not reliable semantic classification.
4. Every valid candidate still needs review. Syntactic validity and quote presence are insufficient grounds for an automatic reply, refund, or account change.
5. Fixtures contain expected decisions, queues, and optional exact issue-code sets. CI fails on mismatches. There are no fabricated latency, accuracy, or time-saving claims.

## Known failure example

The source asks how to change a plan. The candidate claims an invoice has already been paid while quoting the real phrase “change my plan.” The quote is grounded but does not support the summary. The fixture `semantic-error-still-needs-human` preserves this limitation as an explicit contract. Do not call this hallucination detection.

## Threat and data boundaries

Model output and source text are data. There is no eval, tool execution, network call, database, or shell interpolation. That reduces the impact of malicious instructions here; it does not certify prompt-injection resistance of an upstream model or downstream system.

Reports omit source text, summaries, and evidence. Case IDs appear in reports and errors, so labels must not contain personal information. Exceptions from JSON parsing are replaced with a generic message to avoid echoing malformed input.

No endpoint or durable review queue exists. A service version would need authentication, permissions, bounded streaming reads, output escaping in its UI, retention policy, idempotent approval writes, and audit history before connecting real customer workflows.

## A focused next version

Add a provider adapter and a fixed, labeled dataset. Store provider/model/version and prompt identifiers with runs. Report schema rejection, unsupported claims, category mistakes, escalation misses, and false positives separately. Record actual cost and latency only from measured runs. Keep review decisions separate from tool execution.

## Questions to explain in an interview

- Why can a candidate with a real quote still contain an incorrect summary?
- When would exact matching be too strict, and what new risks would fuzzy matching add?
- Why route using both the source and the generated priority?
- Why do regression fixtures not establish model accuracy?
- What changes before this CLI can serve real users?
