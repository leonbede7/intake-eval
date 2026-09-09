# Human review

[Open the review workspace](https://leonbede7.github.io/intake-eval/review.html).

The playground checks a candidate's structure and quotes. The failure lab demonstrates what those checks can and cannot establish. Human review adds the judgment that follows: is the summary faithful, and would a person accept the candidate?

This is a static, AI-assisted portfolio prototype. It uses the existing 20 synthetic English/Croatian requests and recorded V2 responses. It makes no model calls, executes no customer action and uploads no review records. Every new session starts without human judgments.

## Review a request

1. Optionally enter a name or alias. Choose **Project author** when reviewing your own project. Reviewer identity is self-reported, not authenticated.
2. Read the source and choose category, priority and specialist review. Choose **Not sure** when you cannot decide. Read the assessment guide on the page if needed.
3. Save the initial assessment. The app preserves it and reveals the model response, quoted evidence and validator result.
4. Check the summary against the source. Rate it accurate, partly accurate, inaccurate or unclear. You can change your category, priority and specialist-review assessment in the final form.
5. Mark the candidate acceptable, needing correction or unresolved. Corrections and unresolved reviews require a short reason. Acceptable requires an accurate summary and agreement with a structurally valid candidate on all three assessments. Saving records a judgment; it does not send a customer response.
6. Only after saving does the page display the AI-authored provisional labels. Disagreement is a finding to investigate, not an instruction to change your answer.
7. Continue to the next request. Skipping leaves the request available for later. Final-form drafts are saved separately from completed reviews. Revised reviews append a version rather than replacing the initial assessment or prior final reviews.

The queue distinguishes unreviewed requests, work in progress and saved decisions. An unresolved decision counts as a completed review, but is explicitly reported as unresolved. It does not count as an acceptable candidate.

## What the totals mean

The four headline counts show saved reviews out of the dataset, followed by acceptable, correction and unresolved decisions out of saved reviews. Summary ratings use saved reviews as their denominator. Only the latest saved final review contributes to these counts; an unsaved draft does not.

Agreement tables separately compare initial and final human assessments with the recorded model and provisional labels. Each field has its own denominator: saved reviews with a determinate human assessment and a comparable target. **Not sure** and rejected model candidates are excluded from the relevant denominator and shown as excluded. The final assessment was made after viewing the model. Agreement with either target does not establish correctness.

This is an existing development set, not held-out evaluation. Its requests and provisional labels were authored with AI, and the author may have seen them before. Staged rendering is not secure blinding: the dataset and source are public. Imported records can be edited and are not proof of reviewer identity or of an independent review. Author review should be described as **project-author review**, not independent validation. No human results are published until someone actually performs a review and chooses to share it.

## Local saving and export

The app stores one session in `localStorage` under `intake-eval-human-review-v1`. Save a downloaded copy before clearing browser data, changing devices or importing a replacement. Local storage is browser-profile and origin specific, not cloud sync. Use one tab at a time; this prototype does not coordinate concurrent editors.

Form edits update the local draft. Saving the initial assessment or a final review records the relevant timestamp. If reading or writing browser storage fails, work continues in memory and the page displays a persistent message to download before leaving. Unreadable or incompatible old storage is not overwritten. Closing an in-memory session without exporting loses that work.

**Download reviews** exports UTF-8 JSON. **Import JSON** validates a complete session before showing a replacement confirmation. Cancel leaves current work intact. The file size limit is 16 MiB. Each case supports up to 50 saved final versions, notes up to 2,000 characters and a reviewer label up to 80 characters.

The version 1 envelope contains:

| Field                                     | Meaning                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `version`                                 | Export schema version, currently `1`                |
| `dataset.id`, `dataset.hash`              | Dataset identifier and SHA-256 fingerprint          |
| `reviewer.label`, `reviewer.relationship` | Optional alias and `visitor` or `project_author`    |
| `savedAt`                                 | Most recent local session update, ISO UTC timestamp |
| `entries`                                 | Exactly one record per dataset case                 |

Each entry contains its case `id`, nullable `initial`, append-only `revisions` through the UI, and current `draft`. Initial records contain category, priority, escalation (`yes`, `no` or `unsure`) and a timestamp. Final revisions also contain summary rating, disposition and notes. Drafts permit empty fields and are not scored.

The build fingerprints `JSON.stringify({ id, samples })`, with samples ordered as in the frozen dataset. Each sample includes its id, source, language, provisional labels and exact recorded V2 candidate string. Any change to that content requires matching review data; imports with another fingerprint are rejected. Newlines inside source strings are significant. No migration or automatic merge is attempted.

Unknown fields, duplicate or missing case ids, invalid enums, impossible dates and inconsistent review states are rejected. All user text is rendered with text nodes, not HTML. Keep notes free of private customer information. No credentials, provider adapter or live-generation calls are needed by this page.

## Develop and verify

Run `npm ci`, `npm run check` and `npm run test:e2e` after installing Playwright Chromium. `npm run build:web` emits the static page and fingerprinted public dataset. `npm run playground` serves the same assets locally at `/review.html`; GitHub Pages uses the existing checked deployment workflow.

The browser-independent state module is `src/human-review.ts`. Tests cover immutable initial assessments, revision history, import validation and denominators. Browser tests cover reveal order, saved drafts, resume, explicit import replacement, corrupt files, storage failures, safe text rendering, keyboard use and narrow layouts.
