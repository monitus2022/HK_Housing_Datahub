# Natural-language search — lexicon and model development

How the single-line estate search (P3) decides what a sentence means, how flat
size is judged, and how the reference model (P4/P5) will be built and gated.

Epic: [#145](https://github.com/monitus2022/HK_Housing_Datahub/issues/145).
This document is the repository-side record; the issue carries the discussion.

## 1. Purpose and constraints

One utterance becomes one query spec. There is no chat, no session memory, no
text-to-SQL and no backend:

- runs entirely in the browser, so no per-request inference and no hosting cost;
- the sentence parser is deterministic and is bundled only when
  `VITE_FEATURE_NL_SEARCH=true`; the default build tree-shakes it out (the
  gazetteer index remains, about 1.4 kB gzipped);
- the user must get exactly what they asked for in the output dataset, or be
  told what could not be represented — never a quiet approximation.

The model, when it exists, is a **second opinion**: the lexicon parses first, and
the model is only offered the slots the lexicon abstained on. It can add
capability, never silently replace a confident parse.

## 2. What runs today

`frontend/src/lib/lexicon.ts`, in fixed order. Each understood phrase is removed
from the remainder, so leftovers are reported rather than re-matched.

| Step | Examples | Slot |
|---|---|---|
| out-of-scope | `shenzhen`, `深圳` | refuse the whole sentence |
| bedrooms | `2 bed`, `3 room`, `兩房`, `六房` | `bedrooms` (`4+` above 3) |
| area | `500-700 sq ft`, `under 600 ft`, `500至700呎`, `50至70平方米` | `minNetArea` / `maxNetArea` |
| vague size | `small`, `middle size`, `大單位` | marked default + band hints (see §3) |
| price | `under 6m`, `5m to 8m`, `600萬以下`, `500萬至800萬` | `minPrice` / `maxPrice` |
| sort | `cheapest`, `most active`, `最平`, `最活躍` | `sort` |
| unsupported | `sea view`, `quiet`, `parking`, `near MTR`, `海景`, `近地鐵` | `Ignored:` |
| MTR line | `island line`, `tko line`, `港島綫`, `東鐵線` | `mtrLine` |
| school net | `school net 41`, `校網 41`, `41校網` | `schoolNet` (by name — see §7) |
| estate | `太古城`, `Taikoo Shing`, `Mei Foo Sun Chuen` | text query, combined with the other slots |
| place | `TKO`, `KT`, `Sha Tin`, `east`, `港島東` | region / subregion / district |
| building age | `new`, `new build`, `newly built`, `新樓` | `maxBuildingAge = 5` (marked default) |

Estate names are matched against the estates the dashboard already loads, so
nothing is bundled or fetched twice: the parser receives the list and builds a
name index once per array. `太古城 兩房 under 6m` applies the estate as the text
query and the bedrooms and price as filters. A name shared by several estates is
applied with a count (`Amoy Gardens (2 estates)`) rather than picking one. The
match is exact, longest-span-first, capped at six words and a three-character
minimum — no typo tolerance, because a wrong estate is worse than an unrecognised
one. It runs **before** the place step: `Mei Foo Sun Chuen` starts with the
district name `Mei Foo`, and place-first would apply the district and leave the
rest unrecognised. One consequence: an estate whose name contains an unsupported
concept (`Sea View`-style names) is consumed by the unsupported step first.

The index costs ~59 ms for 9,750 estates, so the flag-on build warms it while the
browser is idle rather than on submit; with the flag off nothing is indexed. The applied text is a **substring** match, so it
can return more rows than the disclosed estate count — a name that prefixes
another estate, or a district name, widens it.

**Language is a row property, not a per-slot draw.** Each row is English (55%),
Chinese (30%) or mixed (15%). A mixed row is an English sentence with a Chinese
place (`cheapest flats in 何文田`), because that is the mixed style people type; it
is not a random mix of languages inside one sentence. Chinese rows use Chinese
templates and Chinese forms for every slot (`一房 600萬以下 觀塘`), so a Chinese
row never contains an English place or an English city. Families with no Chinese
template — abbreviations — are English-only, and mixed requires a place slot.
`room`/`rooms` outnumber `bed` forms about 1.46:1 (708 vs 486 rows at 6,000),
because that is the word people use.

23 of the 60 district labels are joined names — `Yau Yat Chuen / Shek Kip Mei`,
`Diamond Hill / San Po Kong / Ngau Chi Wan`. Nobody types the slash form, so the
dataset plants the components (which already exist as aliases) and the chip shows
the component the user typed. A joined label is still indexed as a whole, but a
longer phrase resolves **at most one** component: `takePlace` scans windows
longest-first, so `Diamond Hill / San Po Kong / Ngau Chi Wan` yields
`San Po Kong`, and `Kwun Tong / Lam Tin / Yau Tong` yields `Kwun Tong` at the
*subregion* scope because subregions are indexed before districts. That is the
four-word window, not a promise.

The chip shows the component the user typed, but the **filter is the whole
district**: estates carry no area field below district, and the joined districts
cover 5,524 of 9,750 estates (57%). The interpretation therefore names the scope,
`石硤尾 · district 又一村 / 石硤尾`, so the result set is never narrower than the
text promises. When the component and the district are the same word (`中上環`),
the suffix is omitted.

Chinese is written without spaces, so before parsing the lexicon segments a run
of Han characters against known terms: place labels, MTR line names, sort words,
net words, unsupported concepts, age and size words, plus the estate names the
dashboard has loaded. Anything it cannot segment stays as one unknown word and is
reported. `大埔兩房600萬以下` therefore parses as three slots, and `想搵大埔兩房`
applies the place and bedrooms while reporting `想搵` as Unrecognised.

Chinese is part of v1, not deferred to the model: prices accept Arabic or
Chinese numerals (`六百萬`, `1.5萬`) with `以下`/`以上`/`至` ranges, a bare `600萬`
is disclosed as incomplete rather than assumed to be a ceiling, line names accept
both `綫` and `線`, and directions are written region-first (`港島東`). A direction
that spans several subregions asks instead of picking one.

A place is resolved by `gazetteer.ts` (abbreviations, curated direction cells,
typo tolerance with a margin test). Ambiguity returns candidates and applies no
location; clicking a hint rewrites the URL, so the result stays a single
shareable query.

Result states: **applied**, **ambiguous** (ask + hints), **refused** (out of
scope, current results untouched), **unresolved** (nothing applied, with
`Ignored:` / `Unrecognised:` disclosure).

Every submit **replaces** the spec. One utterance is one query; a previous
sentence cannot silently narrow the next one.

## 3. Flat size: the vocabulary and where the numbers come from

The dashboard stores `latest_net_area` — the **net area of the latest
transaction** (HKP net area; not RVD saleable area, see
`docs/data-dictionary.md`). Three bands are supported, all applied as **marked
defaults** — the UI shows `Area 400–700 ft² (default)`; the chip clears the band
and the exact range can be edited in the Filters panel:

| Phrase | Band | Slot values |
|---|---|---|
| `small`, `compact`, `tiny`, `small size` | small | `maxNetArea = 400` |
| `middle`, `medium` (+ `size`, `sized`), `mid size`/`sized`, `中型單位` | middle | `minNetArea = 400`, `maxNetArea = 700` |
| `large`, `big`, `spacious`, `large size`, `大單位` | large | `minNetArea = 700` |

`細單位` maps to small. Chinese size words only match next to `單位`, so a bare
`大` cannot swallow `大埔`.

### Hints move a band without retyping

A default is only honest if it can be corrected. While a band is applied, the
parser also offers neighbouring bands as hint buttons, each carrying the rest of
the sentence:

| Applied | Hints |
|---|---|
| small | ≤ 300, 300–450 |
| middle | 300–500, 500–700, 700–900 |
| large | 700–900, 900–1200 |

Clicking one replaces just the area filter and rewrites the URL; the
`Interpreted as` line then shows the chosen band without `(default)`. A chosen
band survives answering a pending place question, and a band choice leaves the
place question open.

`mid` is only a size word next to `size`/`sized`: a bare `mid` would otherwise
eat the district `Mid-Levels Central`, applying an area filter instead.

### Why 400 and 700

They are quantiles of the snapshot, not architectural definitions. Over the
9,750 estates (6,324 with a usable area; 3,426 unusable — missing or
non-positive):

| Quantile | 10% | 25% | 50% | 75% | 90% |
|---|---|---|---|---|---|
| ft² | 295 | 382 | 533 | 734 | 1,138 |

The bands were set at roughly the 25th and 75th percentiles, rounded to round
numbers. The result splits estates with a known area roughly 28 / 44 / 28:

| Band | Estates | Share of known areas |
|---|---|---|
| small, ≤ 400 ft² | 1,779 | 28.1% |
| middle, 400–700 ft² | 2,787 | 44.1% |
| large, ≥ 700 ft² | 1,758 | 27.8% |

That balance is the design intent: a vague word should select a recognisable
slice of the market, not a sliver or almost everything.

### What the bands deliberately do not do

- **They are absolute, not district-relative.** 700 ft² is a large flat in Tseung
  Kwan O and ordinary in Mid-Levels. A district-relative definition would need a
  per-district median and would make the same sentence mean different things in
  different places — harder to explain, and worse for a shareable URL.
- **Intensity is not honoured.** `very big` applies the large band and reports
  `Unrecognised: very`; `super large size mansion` applies large and reports
  `super`, `mansion`; `huge` alone is unresolved. The parser never claims to
  understand an intensity word it has no band for.
- **`mansion` is not a size.** In Hong Kong English it usually names a residential
  block, and 豪宅 is a market segment, not an area.
- **Estates without a usable area are excluded** while the filter is active.
  Since 35% of estates have no usable latest area, a size filter narrows the
  result set by construction; that is why the band is always visible as a default.

### Proposed intensity scale (not implemented)

Hints already let a user move between the three bands. What remains a
**proposal** is giving intensity words their own defaults, on a five-band scale
derived from the same distribution and applied with the same default marking:

| Phrase | Band | Estates (of 6,324) |
|---|---|---|
| `tiny` | ≤ 300 ft² | 679 (10.7%) |
| `small` | 300–450 ft² | 1,630 (25.8%) |
| `middle` / `medium` | 450–700 ft² | 2,257 (35.7%) |
| `large` | 700–1,000 ft² | 919 (14.5%) |
| `huge` / `super large` | > 1,000 ft² | 839 (13.3%) |

This is a proposal, not shipped behaviour. It is only worth adding together with
hints for the neighbouring bands, so a user who disagrees with the default can
move one step without typing numbers. Without hints, more bands mostly add more
ways to be subtly wrong.

## 4. Three kinds of ambiguity, three mechanisms

Conflating these is what makes NL filters feel like guessing:

| Kind | Example | Mechanism |
|---|---|---|
| abbreviation collision | `KT` | curated candidate set, surfaced as a hint — never scored |
| vague term | `middle size` | curated band applied as a marked default |
| incomplete modifier | `east` | curated direction cell; needs a region, then a subregion |

A vague term is allowed to apply a default because the default is **visible and
reversible**. An ambiguous place is never defaulted, because there is no honest
default between two real places.

## 5. What the model will and will not do

The student is a small encoder fine-tuned to emit the **same filter schema** —
`region/subregion/district`, price and area ranges, bedrooms, MTR line, school
net, sort. It does not have a vocabulary of its own:

- it cannot invent a "mansion" concept, only choose numbers;
- it is offered only the slots the lexicon abstained on (`huge`, an unseen
  phrase, an unusual word order);
- the lexicon's parse is never the label it is trained on.

## 6. Dataset plan and "enough labels"

The hard question is not volume — rules can generate utterances cheaply — but
whether the labels are trustworthy. The plan separates the two:

| Component | Role |
|---|---|
| Slot schema + dimension values | defines the **label space**; must match production |
| Gazetteer + curated vocabulary | generates slot values and synthetic sentences |
| Matcher's margin / difficulty | **sampler**: picks rows worth teacher time |
| Matcher's parse output | **never a label** — it is the baseline to beat |
| Closed-world absences (`shenzhen` is not in HK) | may label REFUSE/ABSTAIN negatives |
| Teacher (3B CPU first, 7B GPU if needed) | labels the positive and ambiguous rows |

### Candidate generation

`scripts/build_nl_dataset.py` produces the inputs: 16 weighted families (place,
place+bed, place+bed+price, line, net, sort, direction, abbreviation,
out-of-scope, unsupported…), each with 3–5 whole-sentence templates and value
pools drawn from `geo.json` and `gazetteer.json`, plus hardened pools for
bedrooms, sizes, prices, sorts, building age, directions and unsupported terms
defined in the script itself. It uses no model and no network.

- **Least-used sampling per planted value.** "2 bed", "2 rooms" and `兩房`
  are one coverage cell, so a value with more spellings does not get more rows.
- **Co-occurrence from the mart.** A line or net is paired only with subregions
  that actually contain it (read-only, `mode=ro`), so the bulk avoids sentences
  like "South Island Line in Tung Chung". The constraint is **subregion-level**,
  so a district inside a served subregion can still be wrong (Tung Chung Line
  "in Discovery Bay"). A line or net name the mart cannot place is dropped from
  the pool and listed in `--report`, never silently paired with anything. (The
  mart itself has odd pairings — net "Tai Po" appears in one Yuen Long estate —
  and those are kept, because the dataset mirrors the data. The same applies to
  lines: the mart really does place the Tsuen Wan Line in Yuen Long and the East
  Rail Line in Causeway Bay, so those rows are generated.)
- **Consistency.** A district always carries its subregion and region; area and
  price ranges are ordered; one location per row.

- **Building age.** `new` is a build age, not a transaction date: `newest` and `最新` stay sort
words, while `new` / `新樓` set `maxBuildingAge = 5`, marked `(default)` in the
same way as a vague size. The age is a real five years (milliseconds/365.25, the
same arithmetic as the mart), not a calendar-year bucket, so a 5-year-11-month
estate does not pass a 5-year chip. Estates with no `first_op_date` are excluded
(~9% of the snapshot): an unknown build year cannot be known to be recent. Age
matching runs **after** estate and place, so `New Territories` and estate names
containing "new" are consumed first. `新盤` is primary-market wording — the data has no
launch or first-sale flag — so it is disclosed rather than mapped onto age.

- **Planted values are diagnostics, not labels.** Each row records `planted`, a
  coarse `expect` (`applied`, `ambiguous`, `ignored`, `refused`), and the row
  `lang` (`en`, `zh`, `mixed`). The teacher's
  label is produced independently; `planted` is used for coverage gates and
  per-slot recall checks. An absent bound is the empty string, not null, so
  `maxPrice: ""` means "no upper bound".

The mart is the only non-artifact input, and it lives under gitignored `data/`.
A checkout without it **refuses to run** rather than silently pairing lines and
nets at random; `--no-correlation` generates anyway and marks the report
`correlation: off`. Uncorrelated output is for smoke tests only, never labels.

A 6,000-row run yields 6,000 unique texts (no duplicates): 55.6% English, 29.2%
Chinese, 15.3% mixed; 47–70 rows per MTR line, 29–43 per school-net name, 93–97
per sort key, 58–86 per place scope, 552–588 per bedroom value, 213 rows carrying
a building age, and 167 of the area rows using 呎 or 平方米, with every one of
the 77 scopes present. 44.4% of rows contain Chinese: every Chinese row, plus every
mixed row, because each mixed row carries a Chinese place.

The candidate mix is deliberately place-heavy: the place-carrying families carry
0.83 of the sampling weight, but **93.0% of emitted rows** carry a location
(5,583 of 6,000; 88.7% at 1,000 rows). The gap is dedupe and the abbreviation
family, which also plants a place: families with more distinct texts survive
dedupe better. Quote the measured figure, not 0.83. This is realistic for a
property query but **not** the shape the training set needs, so the "no slot in
more than 55% of rows" gate below must be met by down-sampling, not inherited
from this generator.

### Volume gates (all must hold before training)

- ≥ 3,000 training rows after filtering, ≥ 300 dev rows;
- every schema dimension covered by ≥ 150 rows; every enum value by ≥ 25;
- ≥ 4 paraphrase templates per slot value, so the student cannot key on one
  phrasing;
- no single slot present in more than 55% of rows (a degenerate set teaches
  "always emit bedrooms");
- duplicates and near-duplicates below 2%.

### Quality gates

- **Teacher/human audit.** A human labels 150 random rows blind; whole-query
  exact match between teacher and human must be ≥ 95%, or the teacher is not
  trustworthy enough to distil.
- **Abstain/refuse slice.** ~80 rows that are in-domain but unfilterable
  (`sea view`, `quiet`, `near MTR`), out-of-scope places, and nonsense. Teachers
  are bad at abstaining, so this is measured separately (≥ 90% agreement) rather
  than assumed.
- **Self-consistency.** Two greedy samples must be identical; rows whose sampled
  answers disagree are dropped or escalated to the human slice.
- **Coverage diagnostics.** Because the generator knows which slot values it
  planted, per-slot recall of those phrases in the teacher's output is checked.
  This is a diagnostic, not a label: it catches a teacher silently dropping a
  constraint.
- **Contradiction check.** No row may carry mutually exclusive labels
  (e.g. `minNetArea > maxNetArea`, a district outside its subregion).

### Teacher selection (two stages)

The teacher is not fine-tuned; it only labels. So the cheap question is "which
teacher agrees with a human", measured directly, not inferred from student
scores.

Timing estimates below assume **60–90 output tokens per row** (a JSON spec with a
few slots) and are rough; prompt prefill is extra. Measure the first real batch
before trusting any of them.

**Stage 1 — small model on the development Mac, CPU only.** A 3B instruct model
at 4-bit (`~2–5 tok/s` decode) labels the audit slices only: 150 random rows plus
the ~80-row abstain/refuse slice. At 230 rows that is roughly **1–3 hours** of
laptop time, no GPU. It doubles as the "is a bigger teacher even necessary?"
control. The CPU run is audit-only; a CPU bulk pass would take roughly **17–62
hours**.

**Stage 2 — 7B on the GPU box (RTX 3060 8 GB), if Stage 1 falls short.** Q4_K_M
is about **4.7 GB of weights plus ~0.5 GB of KV cache** for a GQA 7B at 4k
context, which fits in 8 GB with headroom. A non-GQA 7B is much tighter (~2 GB of
4k KV on top of the weights) and may not fit once runtime and context overhead
are included; prefer a GQA model or a shorter context. At ~25 tok/s a 5,000-row
bulk pass is about **5 hours**, or 10 with two samples.

Decision thresholds, applied to the same 150 human-labelled rows:

| Stage 1 agreement | Outcome |
|---|---|
| ≥ 95% | labels are good enough. The **same 3B model, run on the GPU box**, does the 5,000-row bulk pass; the Stage 1 CPU run is audit-only |
| 90–94% | escalate to the 7B teacher; re-audit before any bulk run |
| < 90% | neither teacher is trustworthy: fix the prompt/exemplars, or use a cloud model for the one-off labelling run |

The thresholds apply to the 150 random rows only. The **abstain/refuse slice
keeps its own ≥ 90% gate**, and a teacher that scores ≥ 95% on the 150 rows but
fails that slice is not eligible: a model that cannot refuse `sea view` will
teach the student to invent a filter for it.

Rules that make the comparison meaningful:

- identical prompt, JSON schema and few-shot exemplars for every teacher, so the
  variable is model capacity, not prompt craft;
- record the model name, version, quantisation and prompt hash in the dataset
  metadata — cloud and local models change under the same name;
- comparing two teachers **end to end** (train one student per teacher, same
  holdout) is a tie-break only, for the 90–94% band. Below that, training is not
  worth the hours, and above it there is nothing to distinguish.

### Human checkpoints

1. **Before Stage 1:** approve the dataset spec, a 50-row sample, and
   **human-label the 150 random rows and the ~80 abstain/refuse rows blind**.
   The teacher comparison has nothing to compare against otherwise, and doing it
   after seeing teacher output would bias the audit.
2. **After bulk labelling:** review the bulk labels and the full disagreement
   slice. Sign-off recorded on the issue; training does not start without it.
3. **Before shipping:** review the P5 metrics against the kill criterion, and the
   model card. The toggle ships only after that approval.

### Kill criterion

The student must beat `rules + lexicon` by **≥ 8 whole-query EM points** on the
150-item hand-written holdout. Below that, it does not ship, and the result is
written up with both standalone EM and recovery rate on lexicon-abstained
inputs. The holdout is human-labelled and never used for training.

An 8-point gap sits near the noise floor at n = 150 (roughly ±7 points at 95%),
so the comparison is **paired**: same items, same labels, McNemar's test on the
rows where the two systems disagree. If the result is to be published rather
than only used as a gate, grow the holdout to 300–400 before labelling it — after
seeing the numbers is too late.

## 7. Known gaps and follow-ups

- `huge` and `豪宅` are unresolved rather than mapped to a band; `super large`
  applies the large band and reports `super` as unrecognised (see the
  intensity-scale proposal in §3).
- `school net N` sets the net **name**, because the filter is name-based and
  several nets share one; it therefore covers every net with that name and the UI
  says so.
- `shatn` resolves to the Sha Tin **district** (`301702`, with subregion `3017`
  filled in) while exact `Sha Tin` stops at the subregion `3017`; related rivals
  are excluded from the margin set, which is what produces the district.
- Place hints are capped at four and listed in gazetteer order, not ranked by
  distance. Size hints are not capped.

## 8. Files and commands

| Path | What |
|---|---|
| `frontend/src/lib/lexicon.ts` | sentence → query spec |
| `frontend/src/lib/gazetteer.ts` / `.json` | place resolution and curated vocabulary |
| `frontend/src/lib/geo.ts` / `.json` | region → subregion → district model |
| `frontend/src/components/EstateSearch.tsx` | the input, disclosure rows and hints |
| `scripts/build_gazetteer.py`, `scripts/build_geo.py` | regenerate the artifacts |
| `scripts/build_nl_dataset.py` | generate the NL candidate rows |
| `make gazetteer-check`, `make geo-check` | fail on artifact drift |
| `make nl-dataset` | 6,000 candidates + coverage report + 50-row sample |
| `frontend/README.md` | user-facing behaviour and the feature flag |
