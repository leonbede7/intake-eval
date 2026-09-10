# A short route through Intake Eval

This is an AI-assisted TypeScript portfolio project by Leon Bede. It explores a practical question from his dealership product work: what should happen between a structured model response and an operating decision?

## Try it first

Open the [playground](https://leonbede7.github.io/intake-eval/) and select **No refund requested**. Compare V1 and V2. The request asks for a copy of an invoice and explicitly rules out a refund. V1's source keywords escalate it; V2 separates the requested action from the presence of the word.

The [Failure lab](https://leonbede7.github.io/intake-eval/reliability.html) shows a different boundary: a response can contain a real quote and still have a false summary. The [Human review demo](https://leonbede7.github.io/intake-eval/review.html) lets a visitor record that judgment. It starts empty and is not a completed human evaluation.

## Reproduce the evidence with one command

```bash
git clone https://github.com/leonbede7/intake-eval.git
cd intake-eval
npm run evidence
```

Requires Node.js 24 or later. This command needs no dependency installation or API key. It starts a temporary loopback HTTP server for the fault tests, revalidates recorded V1/V2 responses, and writes a new directory under `local-data/evidence-*`. Open the printed `report.md` path for the result and links to its JSON files.

An unchanged checkout should reproduce 12 fixture expectations, both 20-case recorded routing reports, 14 fault contracts and one known semantic limitation. Five consolidated checks summarize that evidence. V1's known five routing mismatches are expected findings; the command should reproduce them rather than pretend they disappeared.

Exit codes: `0` means reproduced, `1` means evidence changed, `2` means setup or usage failed. Any difference in a routing report's rows, metrics, prompt or dataset is flagged, even an apparent improvement. The fault snapshot also includes a source fingerprint, so editing the relevant implementation can require deliberate review of that published evidence.

Use `npm run evidence -- --out NEW_DIRECTORY` for a chosen output directory. It must not exist. The command never replaces a previous packet. Unsupported options, including provider selection, are rejected; there is no live-model mode. If setup fails, a newly created output directory can remain incomplete. A completed packet includes `manifest.json` and its six output files.

The manifest records exact output byte counts and SHA-256 hashes. Input/source fingerprints separately normalize CRLF to LF for cross-platform comparison. Hashes help detect accidental changes; they are not signatures or independent attestations. Latency/token values inside the routing reports come from the original captures, not a fresh API call.

## Read the implementation

| Question                                   | Start here                                                                        | What to look for                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| What can software check deterministically? | [triage.ts](../src/triage.ts)                                                     | Required fields, exact quotes, rejected extra action fields, mandatory review.       |
| Why did the policy change?                 | [triage-v2.ts](../src/triage-v2.ts) and [experiment notes](routing-experiment.md) | Explicit review reason, evidence, priority and the remaining semantic limitation.    |
| What happens when the provider fails?      | [provider.ts](../src/provider.ts) and [fault harness](../src/reliability.ts)      | Timeout through body reading, size limits, strict UTF-8 decoding and no retries.     |
| How are observations reproduced?           | [evidence.ts](../src/evidence.ts)                                                 | Replay from saved outputs, full report comparison and source fingerprints.           |
| How is human judgment kept separate?       | [human-review.ts](../src/human-review.ts)                                         | Initial assessments, revision history, local records and explicit denominator rules. |

## Run the full test suites

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

On Linux, Playwright may also need system packages: use `npx playwright install --with-deps chromium`. The evidence command does not replace these test suites. CI runs all checks and browser tests, then generates the evidence packet. Runs that reach the reproduction step upload a scoped **offline-evidence** artifact containing only this packet; CI does not upload the whole workspace or local experiments. A failed reproduction still uploads available reports for inspection. CI artifacts are retained for 14 days; the local command can regenerate a packet later.

CI uses the official Playwright container pinned to the same version as `@playwright/test`. Keep those versions aligned when upgrading. This avoids repeating the system-package installation that failed in the portfolio's earlier CI run. [Official container setup](https://playwright.dev/docs/ci#via-containers).

Node test files run serially with a 30-second test timeout. The new evidence integration tests include real loopback servers and child-process runs from a temporary clean checkout. Serial execution avoids overlapping these with other HTTP fixture suites; the full suite remains required.

## Interpret the result narrowly

The cases and expected labels were authored with AI and remain provisional. They were used during development, not held out. Reproducing the recorded results establishes consistency with the published experiment, not general model accuracy, production reliability or independent human validation. No user is required to complete the optional human review demo.

The project intentionally stops before an operational action: it has no CRM write integration or outgoing customer message. It is a separate implementation from [Automobili Galerija](https://leonbede7.github.io/leonbede7/work/galerija/), with synthetic support cases and no copied dealership code or customer records.
