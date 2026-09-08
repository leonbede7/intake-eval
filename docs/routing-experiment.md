# Routing comparison protocol

The 20 cases in `fixtures/routing-comparison.json` are frozen in Git before the v2 policy is implemented or either comparison run is executed. This targets the negation, multilingual financial-action and category-taxonomy issues observed in the first run.

This is a prospective, targeted development comparison. The same AI assistant authors the examples, labels and proposed implementation. It is **not blind, independently labeled, or representative of production**. Examples informed the design; do not market the resulting score as held-out generalization.

Plan: run both v1 and v2 on the identical frozen input set, save the raw synthetic outputs and metadata, and compare valid-output coverage, category/priority labels, missed escalations and false positives. Keep failures and original labels visible. Do not change labels or rerun selectively to obtain a favorable result.

V2 will separate a request for specialized review from incident priority. Financial actions, active security incidents and explicit legal disputes can require specialist review independently of the normal/urgent field. A supporting source quote remains necessary, and all accepted output still requires a person.

## Results

The dataset was frozen in commit `7933738` before implementation changes and live runs. Both runs completed on all 20 cases without retries, provider errors or rejected output. The complete reports and captured synthetic responses are preserved under [results/routing-comparison](results/routing-comparison).

| Outcome on the frozen set                    | V1               | V2               |
| -------------------------------------------- | ---------------- | ---------------- |
| Valid output                                 | 20 / 20          | 20 / 20          |
| Category matches                             | 20 / 20          | 20 / 20          |
| Priority matches                             | 20 / 20          | 20 / 20          |
| Missed specialist review                     | 1 of 8 expected  | 0 of 8 expected  |
| Unnecessary specialist review                | 4 of 12 standard | 0 of 12 standard |
| Expected escalation that could not be scored | 0                | 0                |

V1 unnecessarily escalated an invoice-only request, a security-documentation question, a legal-address question and a cancellation that explicitly declined a refund. It missed the Croatian request to return a duplicate payment. V2 matched the provisional routing labels on those five cases and introduced no new mismatches on this set.

The change is a complete policy comparison: V2 modifies both the prompt/output contract and the router. These results do not isolate the causal effect of either change individually. They also do not establish robustness on unseen traffic, and all candidates still need human review. Summary correctness is not automatically scored.

V1 used 5,351 input and 965 output tokens. V2 used 9,171 input and 1,291 output tokens. At the previously checked peak/cache-miss prices, their combined usage estimate is USD 0.009368. This is an estimate, not a provider invoice. V2's extra fields increase token usage.

## Inspect and reproduce

- [Public playground](https://leonbede7.github.io/intake-eval/)
- [V1 report](results/routing-comparison/v1/report.json) and [responses](results/routing-comparison/v1/candidates.json)
- [V2 report](results/routing-comparison/v2/report.json) and [responses](results/routing-comparison/v2/candidates.json)

With a DeepSeek key in the environment and approval for API cost:

```bash
npm run benchmark -- --provider deepseek --policy v1 --allow-paid --limit 20 --input fixtures/routing-comparison.json --capture
npm run benchmark -- --provider deepseek --policy v2 --allow-paid --limit 20 --input fixtures/routing-comparison.json --capture
```

Each command creates a new local output directory. The published originals remain unchanged. Tests reproduce the published metrics from captured outputs without making new API calls.

## Remaining work

The same AI assistant wrote the labels and implementation. A person should inspect the labels and evaluate whether the specialist-review quote really supports the reason. Expanding to independently sourced examples and measuring ambiguity or disagreement would provide stronger evidence than repeating this set for a better score.
