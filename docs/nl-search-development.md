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
| bedrooms | `2 bed`, `3 room`, `三房` | `bedrooms` (`4+` above 3) |
| area | `500-700 sq ft`, `under 600 ft` | `minNetArea` / `maxNetArea` |
| vague size | `small`, `middle size` | marked default (see §3) |
| price | `under 6m`, `5m to 8m`, `under 6.5m` | `minPrice` / `maxPrice` |
| sort | `cheapest`, `most active` | `sort` |
| unsupported | `sea view`, `quiet`, `parking`, `near MTR` | `Ignored:` |
| MTR line | `island line`, `tko line` | `mtrLine` |
| school net | `school net 41` | `schoolNet` (by name — see §7) |
| place | `TKO`, `KT`, `Sha Tin`, `east` | region / subregion / district |

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
| `small`, `compact`, `tiny` | small | `maxNetArea = 400` |
| `middle`, `mid`, `medium` (+ `size`, `sized`) | middle | `minNetArea = 400`, `maxNetArea = 700` |
| `large`, `big`, `spacious` | large | `minNetArea = 700` |

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
  `super`, `size`, `mansion`; `huge` alone is unresolved. The parser never
  claims to understand an intensity word it has no band for.
- **`mansion` is not a size.** In Hong Kong English it usually names a residential
  block, and 豪宅 is a market segment, not an area.
- **Estates without a usable area are excluded** while the filter is active.
  Since 35% of estates have no usable latest area, a size filter narrows the
  result set by construction; that is why the band is always visible as a default.

### Proposed intensity scale (not implemented)

If intensity should carry meaning, the defensible version is a five-band scale
derived from the same distribution, applied with the same default marking:

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
| 8B teacher | labels the positive and ambiguous rows |

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

### Human checkpoints

1. **Before bulk labelling:** approve the dataset spec and a 50-row sample
   (scope, phrasing style, label shape). Cheap, catches a wrong schema early.
2. **After bulk labelling:** review the 150-row audit and the full disagreement
   slice. Sign-off recorded on the issue; training does not start without it.
3. **Before shipping:** review the P5 metrics against the kill criterion, and the
   model card. The toggle ships only after that approval.

### Kill criterion

The student must beat `rules + lexicon` by **≥ 8 whole-query EM points** on the
150-item hand-written holdout. Below that, it does not ship, and the result is
written up with both standalone EM and recovery rate on lexicon-abstained
inputs. The holdout is human-labelled and never used for training.

## 7. Known gaps and follow-ups

- `small size` / `large size` leave `size` in `Unrecognised`; the middle family
  (`middle`/`mid`/`medium` + `size`/`sized`) consumes it.
- No hints for vague-size bands yet; the recorded decision expected alternatives
  such as 300–500 / 500–700 / 700–900.
- Chinese size words (`大單位`, `細單位`, `豪宅`) are not understood, although
  Chinese place names are.
- `school net N` sets the net **name**, because the filter is name-based and
  several nets share one; it therefore covers every net with that name and the UI
  says so.
- `shatn` resolves to the Sha Tin **district** (`301702`, with subregion `3017`
  filled in) while exact `Sha Tin` stops at the subregion `3017`; related rivals
  are excluded from the margin set, which is what produces the district.
- Hints are capped at four in gazetteer order, not ranked by distance.

## 8. Files and commands

| Path | What |
|---|---|
| `frontend/src/lib/lexicon.ts` | sentence → query spec |
| `frontend/src/lib/gazetteer.ts` / `.json` | place resolution and curated vocabulary |
| `frontend/src/lib/geo.ts` / `.json` | region → subregion → district model |
| `frontend/src/components/EstateSearch.tsx` | the input, disclosure rows and hints |
| `scripts/build_gazetteer.py`, `scripts/build_geo.py` | regenerate the artifacts |
| `make gazetteer-check`, `make geo-check` | fail on artifact drift |
| `frontend/README.md` | user-facing behaviour and the feature flag |
