# Routing comparison protocol

The 20 cases in `fixtures/routing-comparison.json` are frozen in Git before the v2 policy is implemented or either comparison run is executed. This targets the negation, multilingual financial-action and category-taxonomy issues observed in the first run.

This is a prospective, targeted development comparison. The same AI assistant authors the examples, labels and proposed implementation. It is **not blind, independently labeled, or representative of production**. Examples informed the design; do not market the resulting score as held-out generalization.

Plan: run both v1 and v2 on the identical frozen input set, save the raw synthetic outputs and metadata, and compare valid-output coverage, category/priority labels, missed escalations and false positives. Keep failures and original labels visible. Do not change labels or rerun selectively to obtain a favorable result.

V2 will separate a request for specialized review from incident priority. Financial actions, active security incidents and explicit legal disputes can require specialist review independently of the normal/urgent field. A supporting source quote remains necessary, and all accepted output still requires a person.
