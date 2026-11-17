# Evaluation

Every number FORGE publishes comes from a committed file under
`evaluation/results/` and a command that reproduces it. The Scorecard page and
the README's numbers are generated from those files.

## Sets

| set | missions | status | file |
| --- | --- | --- | --- |
| Development | 18 | frozen October 2026; **iterated on** during FORGE 2 | `evaluation/local-missions.json` |
| Validation | 71 | written for FORGE 2, **frozen by hash before its first run**, never used for prompts, exemplars or tuning | `evaluation/validation/missions.json` (sha256 in `manifest.json`) |
| Sealed holdout | 100 | sealed 2026-11-15 for the legacy runtime; opened once at the FORGE 2 source freeze | `evaluation/core-holdout-2026-11-12/` |

The validation set covers every operation family (filter, derive, select,
drop, rename, sort, top-N, limit, dedupe, sum/count/mean/min/max/median/
count-distinct, whole-table aggregates, inner/left/anti/semi joins with a
join+aggregate, union, unnest, nested JSON, text and log extraction, dates,
JSON shapes, TSV in and out, numeric text, buckets, fallbacks, splitting,
replacement), three phrasings (26 precise, 31 ordinary, 14 vague), distractor
files that a least-privilege tool must not read, and 10 decisions (4 connect,
3 clarify, 3 unsupported). Expected outputs were computed by hand,
independently of FORGE. A test proves no exemplar resembles any mission in
either set.

## Running

```bash
npx tsx evaluation/runner.ts --corpus=dev         # 18 missions, ~4 minutes on an RTX 5050
npx tsx evaluation/runner.ts --corpus=validation  # 71 missions, ~15 minutes
```

The runner needs a local Ollama; it refuses to run the validation set if its
hash changed. Synthesis never sees an expected output. When FORGE asks
"which did you mean?", a simulated person answers by running each offered
reading on the mission's own file and picking the one that matches the
expectation; it sees only the offered options. First-preview correctness
(before any question) is reported separately.

A mission passes when the route matches, the output file matches exactly
(CSV by parsed cells, JSON structurally, text by lines; a few vague missions
accept any header or listed alternatives), and the tool reads exactly the
files it needs (`read:<file>` for each input plus `write:outputs`).

## Metrics

- **pass rate** with a 95% Wilson interval and its N;
- **decisions**: connect, clarify and unsupported answered correctly;
- **verified but wrong**: a winner that passed every check and reached review
  but whose output was wrong. This is the number that matters most for trust;
- **time to preview** p50/p95 (first provisional preview), total time p50;
- model calls, candidates, agreement, and per-category and per-phrasing rates.

## Results

The Scorecard (`/scorecard`) shows the latest committed run of each set and
lists every failure with a replayable tape.

| run | result | notes |
| --- | --- | --- |
| Legacy IR pipeline, dev (`c8b172f`) | 1 / 18 | run unmodified before FORGE 2; 13 of 14 file missions failed IR admission |
| FORGE 2, validation, first run (`27b8ed7`) | 56 / 71 (78.9%, 68.0–86.8%) | 8/10 decisions; 5 verified-but-wrong; p50 time to preview 7.4 s |
| FORGE 2, dev (`eb13a9c`) | 17 / 18 (94.4%) | the miss: a draft never adds a derive step the output needs |

Later runs are listed on the Scorecard; each names its commit.

### Failure analysis, first validation run

Read after the run, without changing anything in response (D19):

All 15 failures of the first run (27b8ed7), from `validation.json`:

- **Verified but wrong (5).** Drafts agreed on a plausible reading that
  wasn't the expected one: "cancelled" matched case-sensitively, missing
  "Cancelled" (v03, vague phrasing); groups sorted instead of kept in
  first-seen order (v16, v20); an anti-join that also dropped a column the
  vague request didn't name (v31); a JSON list of names instead of row objects
  (v50). Agreement is evidence, not proof, and the UI says so; "which did you
  mean?" fires only on a near split.
- **The language as the model wrote it (5).** `summarize` without `by` (v23,
  addressed by the later host repair, D11); summarizing where a whole-table
  aggregate was needed (v27, v28); the wrong field set for a JSON object
  (v24); a regex group referenced as `\3` (v41).
- **FORGE's own checks were wrong (3).** The numeric-sort lint fired on a sort
  nobody asked for (v15); the column-list cue read "…lon, taking lat…" as a
  column named "taking" (v36); the CSV read-back property treated an empty
  cell from a null as a mismatch (v30). The last is a plain bug and was fixed
  after this analysis (D20); the other two are reported, not tuned.
- **Decisions (2 of 10 wrong).** "Text each volunteer … a reminder" became
  UNSUPPORTED instead of CONNECT (v62); a translation request was drafted and
  failed instead of being refused as unsupported (v71).

## Sealed holdout

**17 of 100 (11–25.5%)** on one run, at source freeze `c8d9788`
(tag `holdout-freeze`, src tree `6708efc`, record
`evaluation/results/holdout-freeze.json`). The seal was verified before
capture and again before scoring. The oracle was opened only after all 100
missions had been captured. Result: `evaluation/results/2026-11-17-354d463-holdout/holdout.json`.

```bash
npx tsx evaluation/holdout-capture.ts --freeze=evaluation/results/holdout-freeze.json
npx tsx evaluation/holdout-score.ts --dir=evaluation/results/2026-11-17-354d463-holdout
```

The holdout was written in 2026-11 for the *legacy* runtime: Gmail and
calendar connectors, notifications, scheduler ticks, persisted program state,
and reuse/extension/composition of already-installed programs. FORGE 2 has
none of those yet. Its only effects are output files. Per the protocol, a
missing capability is a failure, not an exclusion, so the headline counts all
100. Both views:

| view | result | 95% interval |
| --- | --- | --- |
| all 100 missions (headline) | 17 / 100 | 10.9–25.5% |
| the 58 whose every predicate FORGE 2 can represent | 17 / 58 | 19.2–42.0% |
| the 42 that need a capability FORGE 2 lacks | 0 / 42 | — |

Other metrics: route accuracy 63/100; exact permissions 29 of 70 built tools;
connect/clarify/unsupported 7 of 21 correct; **19 verified-but-wrong** (a tool
reached review with output that didn't match); median total time 12.9 s
(18.1 s for missions that built a tool, p95 77.7 s).

**Erratum 1** (`erratum-1.json`, scoring only, product unchanged): the
connection check matched words literally. core-073 (asked for "email", oracle
says "gmail") and core-076 ("text messages" vs "SMS delivery") named the right
resource. Corrected: 19 / 100. The original 17 stays the headline.

What it says, read after the run:

- **This is much lower than validation (79%), and the gap is real.** Holdout
  requests are written against connector data shapes (mail threads,
  calendar events, nested API payloads) that reached FORGE 2 as JSON files,
  and many need date arithmetic, nested-field access or set comparisons that
  drafts got wrong or never completed (25 builds ended with no passing draft).
- **Clarification is the weakest decision.** 0 of 8 clarify missions asked a
  question. The model either drafted a tool anyway or asked for a connection.
- **19 verified-but-wrong** is the number to fix first: drafts agreed on a
  plausible reading (wrong key, missing label prefix, wrong grouping).
- Everything after this is a developmental follow-up, not a pristine holdout
  score.
