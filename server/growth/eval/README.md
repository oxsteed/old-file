# Classifier evaluation harness

Pinned-model evaluation for the OxSteed Demand & Sales Engine
classifier, per design spec section 8.5. This harness runs the real
classification pipeline (rules first, then Ollama on a closed candidate
list, exactly as `server/growth/classify.js` does) over a labelled
dataset and reports top-1 precision against the quality bar.

## Gold dataset status: external dependency, still outstanding

The gold evaluation set required by section 8.5 is **300 reviewed
items per vertical per language (en, es, fr, ht, ar)**, labelled by
reviewers against the active taxonomy. That dataset does not exist yet
and is an external dependency of this harness: it needs human labelling
and review, not code.

Until gold data exists:

- `fixtures/smoke.jsonl` only proves the harness runs end to end. Its
  items are synthetic, carry a `"_synthetic": true` marker on every
  line, and are not gold data.
- **No quality-bar pass is claimed.** A green run on smoke fixtures
  would prove nothing about the 90% / 85% bar, and the current smoke
  results do not meet the bar (the migration 921 seed only has keyword
  rules for one intent).
- CI should run this eval against the pinned model digest on the GPU
  box as a nightly job (per section 8.5, not on every PR) once gold
  data lands.

## Dataset format

One JSON object per line (JSONL):

```json
{"id":"item-001","vertical":"services","language":"en","text":"Clogged drain in my bathroom","fields":{"category_id":12,"job_type":"plumbing"},"expected_code":"services.plumbing.drain_clog"}
```

- `id`: stable unique id for the item.
- `vertical`: the taxonomy vertical, for example `services`, `food`,
  `business`, `customer`.
- `language`: one of `en`, `es`, `fr`, `ht`, `ar`.
- `text`: the text that would be classified, before scrubbing (the
  pipeline scrubs it the same way production does).
- `fields`: structured signals, all optional. Keys mirror the rule
  kinds: `category_id`, `job_type`, `skill_id`, `cuisine_tag`,
  `menu_tag`.
- `expected_code`: a taxonomy node code, or `"none"` / `"review"` when
  the correct outcome is no confident intent (the item should land in
  the review queue). `"none"` and `"review"` are scored as the same
  outcome.

## How the runner works

`runner.js` loads the active taxonomy nodes and rules through a
database connection, then for each item:

1. Runs `scoreRules` from `server/growth/classify.js` (keyword only
   0.7, category only 0.8, keyword plus category 0.9).
2. If the rules do not settle (no best guess, or best confidence below
   0.75), calls Ollama through `server/growth/ollamaClient.js` with a
   closed candidate list: the nodes sharing the best guess's parent,
   plus the best guess itself, at most 40 codes. With no best guess
   the candidate list is empty and Ollama is not called. The whole
   tree is never offered to the model.
3. Scores the outcome as `review` whenever production would queue the
   item for review: confidence below 0.6, an unsettled rules result,
   or a rules and model disagreement.

The connection, the Ollama function and the environment are all
injectable, so tests run the pure scoring path with a fake connection
and a fake model, with no database and no Ollama server.

Model pinning follows `server/growth/ollamaClient.js`: the model name
comes from `GROWTH_OLLAMA_MODEL` and the pinned digest from
`GROWTH_OLLAMA_DIGEST`. The report records the model name and digest
actually seen (from the Ollama response metadata when available, else
from that configuration) plus the `prompt_version`.

## Running it

Library use (also how the tests drive it):

```js
const { runEvaluation } = require("./server/growth/eval/runner");
const report = await runEvaluation({
  datasetPath: "path/to/items.jsonl",
  baselinePath: "path/to/previous-report.json", // optional
  // conn and ollama are optional injectables; by default the real
  // server/db.js pool and the pinned Ollama client are used.
});
```

Command line (needs a live database and the pinned Ollama server):

```sh
node server/growth/eval/runner.js --dataset server/growth/eval/fixtures/smoke.jsonl
node server/growth/eval/runner.js --dataset gold.jsonl --baseline previous-report.json --out report.json
```

The CLI prints the JSON report and exits non-zero when any gate fails
(exit 1) or when the run itself fails (exit 2).

## Release acceptance

Ordinary runs are marked `evaluation_mode: "diagnostic"`. Their `gates.pass`
only evaluates measured accuracy; it is **not release acceptance**, even if
every item is correct. For release evidence use:

```sh
node server/growth/eval/runner.js --dataset gold.jsonl --baseline previous-report.json --acceptance --review review.json --out report.json
```

The review file must contain `dataset_sha256` (the exact file SHA-256 recorded
in the diagnostic report), `human_labelled: true`, a `review_ref`, a
`provenance_ref`, and an ISO `reviewed_at` timestamp. References point to the
human review and approved dataset source; do not put personal contact details
or raw source records in that metadata. Human owners must verify these
attestations. The runner cannot independently establish human authorship.

Acceptance requires 300 unique items in **each** of the 20 vertical/language
cells: services, food, business, customer × en, es, fr, ht, ar (6,000 minimum).
It rejects synthetic markers, duplicate IDs/content, unknown labels, labels
outside their vertical, and structured fields that could override text or
language. It requires matching human-review evidence, configured model pins,
at least one observed model call, and consistent identity/prompt metadata on
every model call, with no missing model responses. A baseline from the exact
same dataset must cover every qualifying intent with matching example counts;
the existing accuracy and regression thresholds still apply.

For the first approved baseline, run the diagnostic evaluation on the reviewed
gold dataset, have its outputs reviewed, then retain that report for subsequent
acceptance comparisons. Comparing a report with itself only establishes the
initial reference; it does not prove regression safety against an earlier
release. Keep baseline artifacts under release review ownership.

In acceptance mode, the CLI exits 1 unless **`acceptance.pass`** is true.
The generated cases in the acceptance unit tests validate these checks only;
they are not a gold dataset or a quality-bar pass. No nightly GPU job, real
dataset evaluation, or model release is claimed by those tests.

## The report and the gates

The report includes the dataset path and item count, the model name
and digest, the prompt version, total / correct / incorrect counts,
top-1 precision overall, per language and per vertical, per-intent
precision, a confusion summary (the most common expected versus
predicted pairs), per-item results, and a `gates` object with a
pass or fail entry per gate plus an overall `gates.pass`.

A run passes only if all of these hold (section 8.5):

- Overall top-1 precision is at least 0.90.
- Top-1 precision in every language present in the dataset is at
  least 0.85.
- Against a baseline report (when one is supplied), no intent with at
  least 30 examples in the current dataset drops by more than 2 points
  (0.02) of per-intent precision.
