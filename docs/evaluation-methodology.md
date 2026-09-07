# Evaluation methodology

## Three different kinds of evidence

1. **Regression fixtures:** the original 12 cases assert exact validator behavior. They are software tests, not model evaluations.
2. **Synthetic replay:** 16 authored outputs exercise category errors, priority errors, invented evidence, malformed JSON, negated-refund false positives, and Croatian escalation misses. No model generates them.
3. **Live run:** the same source-only requests are passed to a chosen model. The adapter returns model text to the validator. Labels and rationale remain local. Results describe this dataset, prompt and run only.

The labeled dataset and replay outputs were authored with AI assistance. No independent human annotation, production sample, blind evaluation, train/test split, or inter-rater agreement is claimed. The dataset is a development probe, not a validated benchmark.

## Labels

Category is one of billing, technical, account, other. Priority is normal or urgent, following the policy in `src/prompt.ts`. Expected escalation is a separate operational label: a routine refund may need an escalation queue while retaining normal incident priority.

This distinction intentionally exposes the existing routing rule. It scans English source keywords and urgent priority. The rule can over-escalate a negated refund and miss a Croatian refund. These are pipeline failures, not automatically model classification failures.

Each case includes a rationale. Ambiguous cases should be adjudicated by a person and versioned; do not silently edit labels to improve a run's score.

## Metrics and denominators

Category and priority correctness are counts over candidates that passed the shape and quote checks. Invalid candidates cannot be scored and are shown separately. Always read valid-output coverage alongside those ratios. Provider errors are separate from invalid model outputs.

Escalation misses count valid candidates assigned to standard review when the label expects escalation. An expected-escalation case rejected by validation is unscorable, not a correct escalation or an ordinary miss. False positives count valid candidates assigned to escalation against a standard-review label. The report includes both denominators.

The report does not compute summary accuracy. A real quote does not prove that a summary is true or complete. `--capture` enables a separate review against the source; saving text does not establish that this review happened.

Latency percentiles use nearest rank over completed, nonempty provider responses. Provider failures and incomplete outputs are excluded; their latency is unknown in this version. Cold-start and local machine conditions can affect Ollama latency. Token counts are provider-reported; missing usage remains unavailable and is not represented as measured zero. Billing may include unsuccessful calls.

## Reproducibility

Reports contain the request model, returned model per response, prompt version and SHA-256, canonical selected-dataset SHA-256, timestamp, temperature, output limit, case-level results and retry policy. A model alias may change at the provider; metadata improves traceability but does not make future responses deterministic. Temperature zero is not a repeatability guarantee.

Default reports omit source and generated text. Local capture files are ignored by Git. To share a run for this bundled synthetic dataset, inspect the report and captures first, then deliberately copy only the reviewed artifacts into a public results directory. Do not publish raw customer material.

## Provider contract

- [DeepSeek chat completions](https://api-docs.deepseek.com/api/create-chat-completion/): non-streaming JSON output, explicit JSON instruction, thinking disabled, maximum 512 output tokens. Only a `stop` finish reason with nonempty text is accepted; a truncated or filtered response becomes a provider failure.
- [DeepSeek JSON output](https://api-docs.deepseek.com/guides/json_mode/): JSON mode does not replace local schema and evidence checks.
- [Ollama chat](https://docs.ollama.com/api/chat): loopback endpoint, non-streaming JSON, explicit output-token limit, completed `stop` response required.

HTTP bodies and low-level exceptions are never echoed in reports. Automatic retries are deliberately absent; an uncertain failed call may already be billed. Live runs stop after a provider error and report how many cases were skipped.

## Next experiment

Have a reviewer independently label a held-out set and inspect summary support. Consider separating an explicit request-for-financial-action label from urgent incident priority rather than expanding multilingual keyword lists indefinitely. Freeze the baseline, implement the proposed routing change, compare on the held-out set, and report regressions as well as improvements.
