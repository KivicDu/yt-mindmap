# ADR 0014 — Self-check and optional review: closing the study loop

## Status

Accepted 2026-11-26 — implemented in backend PR #31 and frontend PR #32.
The review reminder is opt-in (`next_review_at = NULL` by default) and the
answer key stays server-side.

## Context

The product today ends where the map ends: build it, save it, maybe share it.
Nothing in the app asks the learner to use the map again, so "study with it" is
a story told in the README rather than a path through the UI.

Three moments of one lecture were identified:

| Stage | The learner's question | The map's role |
|---|---|---|
| **a. while watching** | "Where am I in the argument?" | a live map, read at a glance |
| **b. while revising** | "I forgot this — where do I jump?" | an index with timestamps |
| **c. after revising** | "How much of this do I actually hold?" | **hidden**, then rebuilt by the learner |

(a) and (b) are two visits to the same complete map. (c) was left out because it
looked like it needed an **incomplete** map — one the learner fills in — and
that contradicts (b), where a missing branch means revising the wrong thing.

That contradiction only holds if (c) *replaces* (b). It does not: (c) runs
**after** (b), when a complete map already exists. Hiding a map is not the same
as not having one. (c) is therefore a **mode of access to the same artifact**,
not a second artifact, and not a second content pipeline.

Two more facts make (c) cheap:

1. **The map does not depend on the video.** Since ADR 0003 the node tree is the
   source of truth and the transcript is only an input to it. A check can run
   months later, with no YouTube call and no captions, even if the video is gone.
2. **A self-written map is the product of thinking, not the act of it.** The
   Thinking Maps of ADR 0013 are a learner's technique. When the AI writes the
   bubble map, the learner receives the result of the operation without
   performing it. (c) is the only stage where the learner writes, so it is the
   only stage that can claim to teach rather than to summarise.

The last constraint is about honesty: **no single "understanding percentage" can
be defended.** The weight of "recalled a branch" against "explained a main idea"
would be invented, and a reviewer will ask where it came from. Two countable
fractions can be defended; one weighted percentage cannot.

## Decision

### 1. One artifact, three access modes

The stored map is never duplicated, and (c) never mutates it.

| Stage | What changes | What must not change |
|---|---|---|
| a | renderer state: which branches are expanded | `nodes` |
| b | nothing (read, seek, export) | `nodes` |
| c | renderer state: some labels hidden; plus a new attempt row | `nodes` |

An attempt is read-only with respect to the project's content. Failing a check
must never be able to damage the answer key.

### 2. Hiding is renderer state, and it samples

The check does not blank the map. It samples **target nodes** (default 12, spread
across the timeline so a 2-hour lecture is covered end to end) and, for each one,
hides that node's `label` and `note` while keeping its parent label and timestamp
visible (`label` is the canonical node field per ADR 0003):

> `12:40 · Tuần hoàn` → *"Nhánh này nói về gì?"* → learner types the idea.

- Works for every layout, because it only needs `label`, `time`, `children`.
- The surrounding map stays visible, so the learner keeps their bearings; this
  is a check, not an exam.
- Notes and pins are hidden too — they are the learner's own answer key.
- Sampling is deterministic for a given project and attempt number, so the same
  attempt always asks the same 12 questions; a retry asks a different set.

A map with fewer than 5 target nodes gets no check ("Bài này quá ngắn để tự
kiểm") instead of a meaningless 2/2.

### 3. Two signals, two counted results

| Signal | How it is asked | What it measures | Needs the model? |
|---|---|---|---|
| **Recall** | the sampled branches above | whether the structure is still there | no (see §4) |
| **Main ideas** | 5–8 questions generated **from the map** | whether the ideas are understood | yes, to grade |

The result is displayed as **fractions**, never as one percentage:

> Bạn dựng lại đúng **9/12 nhánh** và nắm **4/6 ý chính**.
> Phần yếu nhất: 12:40–18:20.

A one-line summary is allowed; a weighted "73%" is not. Stored as
`asked` / `correct`, so any later aggregation is a choice made from counted
numbers rather than a number invented at write time.

### 4. Grading is deterministic first, the model second

Answer checking runs in this order, and stops as soon as it can decide:

1. **Normalise** — case, diacritics, punctuation, digits versus words
   (`bốn` ↔ `4`), collapse whitespace.
2. **Match** — token overlap and keyword containment against the node's label
   and note; scores above a threshold pass, below a threshold fail.
3. **Only in the ambiguous band** (roughly 0.4–0.7) is the model asked
   "same idea, yes or no?", seeing just the target node and the learner's text.

Consequences: most answers cost nothing, the same answer scores the same way
twice, and the model never sees a transcript.

**Every graded item has an override**: *"AI chấm sai, tôi đúng"*. The override
flips the mark and is stored as `overridden = true`. The learner is the
authority on their own understanding; the override rate is also the honest
quality signal for the grader.

### 5. Questions come from the map, not the transcript

`build_quiz_prompt(markdown)` asks for 5–8 questions covering the top-level
topics, each with a short expected-answer key, written in the lecture's language.
It reads the stored map only. Because Markdown is a compatibility projection of
ADR 0003, the prompt input is regenerated from `nodes` with
`node_tree.tree_to_markdown` rather than trusting a stale stored `markdown` blob:

- no YouTube call, no captions, no playhead;
- cached per project (and invalidated when the map changes), so reopening a
  check costs no call;
- degradation is explicit: if the model is unavailable, the recall half still
  works and the UI says the idea questions are unavailable, rather than showing
  a half-empty result.

### 6. Review scheduling is opt-in and lazy

`projects.next_review_at` is nullable, and **NULL means off**. Off is the
default: a learner who does not want a schedule must see no new UI at all.

- A toggle in the project — "Nhắc tôi ôn lại" — starts the schedule.
- Intervals are 1 → 3 → 7 → 16 days, learner-editable. A completed attempt moves
  one step forward; a weak one (below half) steps back one.
- **No scheduler process.** Due projects are computed when the dashboard is
  read (`next_review_at <= now`), the same lazy approach as `purge_expired` in
  ADR 0011. A restart cannot lose a reminder, because the reminder is a column.
- The dashboard gains one block — "Cần ôn hôm nay" — rendered only when at least
  one project has a non-null `next_review_at`.

### 7. Storage

New table `review_attempts`:

| Column | Meaning |
|---|---|
| `project_id`, `user_id` | who checked which map |
| `kind` | `recall` or `ideas` |
| `asked`, `correct` | counted fractions, not percentages |
| `overridden` | how many marks the learner corrected |
| `weak_ranges` | JSON list of `[start, end]` seconds with the weakest answers |
| `created_at` | when |

`weak_ranges` needs the same timestamp arithmetic the planned coverage warning
needs ("which minutes have no branch"), so both features should share one helper.
That helper does **not** exist yet: `product-scope.md` still lists the coverage
warning as missing, so it must be built as part of this work, not treated as an
existing API.

The table is for the learner's own history and for the next-review step. It is
not used to rank learners, and there is no "score" column to compare across
projects.

### 8. Access

Attempts are per user and writable only by people who may edit the project:
the owner, an invited editor, **or a public-link holder whose `link_role` grants
edit access** (`app/services/sharing.py:can_edit`). A read-only viewer of a
shared link can read the map but cannot create an attempt — the same rule that
already stops viewers from editing nodes. A shared project therefore has one
map and several independent attempt histories.

This does not weaken the share gate: every public link still requires
`content_verified = true`, so an unverified project cannot be reached through a
link and has no shared-attempt path. Attempts never set or clear
`content_verified`; they only read a map that was already allowed.

## Consequences

- (c) ships as a **mode**, not a second product: no second schema for maps, no
  second AI content pipeline, no migration of existing projects.
- Cost of a check: one cached call to generate the questions, zero calls for
  most answers, and at most one call per ambiguous answer.
- The loop survives the video: a map saved months ago can be checked with no
  network dependency beyond the model.
- Results are fractions, so the report can claim "9/12 branches recalled" and
  defend it. It cannot claim "understood 73%", and it must not try.
- AI grading is an estimate. The override button is the escape hatch, and the
  override rate is reported as the grader's error signal.
- Opt-in review means most users never see it. Discoverability therefore has to
  come from the end of a session ("Kiểm tra lại bài này"), not from the
  dashboard.
- Two small write paths are added to a hot row (`next_review_at`) and a new
  table. Both are negligible next to the JSON blobs already stored per project.

## Alternatives considered

**One understanding percentage.** Rejected: the weights are arbitrary and
indefensible, and a rounded number reads as a measurement when it is a
convention.

**Hide the whole map and ask for a full rebuild.** Rejected: a 60-node map
cannot be retyped, and the cliff would make the learner quit on the first try.
Sampling 12 targets measures the same thing without the cliff.

**Let the model write a fresh reference map for each check.** Rejected: it would
differ from the learner's map, so a correct answer could be marked wrong, and
the learner would stop trusting the result. The stored map is the answer key.

**Model-only grading.** Rejected: a call per answer, non-deterministic scores
for the same text, and no way to explain a mark. Deterministic matching first,
the model only as a tie-breaker.

**Email or push reminders.** Deferred: needs a scheduler and deliverability work.
A dashboard block plus the opt-in column is enough for one learner and a handful
of lectures.

**SM-2 / FSRS scheduling.** Deferred: both need per-item history and a
self-rating, which is more UI than the feature deserves now. Fixed 1/3/7/16 with
a manual edit covers the same behaviour at this scale.

**Grade against the transcript instead of the map.** Rejected: it re-couples the
check to YouTube and to captions, and the map is the thing the learner studied.

## Implementation plan

1. **Schema** — `projects.next_review_at` (nullable, indexed) and the
   `review_attempts` table, with one Alembic migration. Defaults keep every
   existing row valid and switched off.
2. **Service** (`backend/app/services/review.py`) — deterministic sampling,
   normalisation, token matching, the ambiguity band, attempt recording, the
   next-review step. Pure functions where possible, so they are tested without a
   database.
3. **Engine** (`backend/ai_engine.py`) — `build_quiz_prompt(markdown)` and
   `grade_answer(target, learner_text)`, both map-only. Unit tests assert the
   prompt carries no transcript and that an unknown answer shape degrades to
   "unscored" rather than a wrong mark.
4. **Routes** — `POST /api/projects/{id}/quiz` (generate or return cached),
   `POST /api/projects/{id}/attempt` (record and advance the schedule),
   `PATCH /api/projects/{id}/review` (toggle, interval), `GET /api/review/due`.
   Every one goes through the existing project-role check. The two AI-backed
   routes must be added to `is_ai_path()` in
   `backend/app/middleware/rate_limit.py`; otherwise quiz generation and
   ambiguous-answer grading would bypass the per-minute AI limit and the daily
   quota that every other Gemini route pays.
5. **Frontend** — a self-check panel in the workspace (hide target labels, one
   input per target, override button), a review toggle in the project header,
   and the "Cần ôn hôm nay" block on the dashboard, rendered only when enabled.
   Hidden state lives in the renderer, never in `nodes`.
6. **Verify** — a real lecture: 12 targets across the timeline, an answer the
   deterministic matcher accepts, one it rejects, one it sends to the model, one
   override; then confirm `nodes` is byte-identical before and after, and that
   the dashboard block appears only after the toggle.

Out of scope: cross-lecture concept graphs, spaced repetition per node, email or
push reminders, learner ranking, and any change to how the map is generated.

## How we will know it works

| Stage | Metric | Where it comes from |
|---|---|---|
| a | time to first map < 30 s | client timer, already true |
| a | branches visible stays bounded on a long lecture | expansion policy, measured by eye |
| b | share of lecture minutes covered by a branch | the same timestamp helper as `weak_ranges` |
| b | seeks per session started from the map | click events on nodes |
| c | branches recalled, ideas correct, override rate | `review_attempts` |
| c | second attempt after 3 days scores higher than the first | `review_attempts` history |

The last row is the only real evidence that the loop teaches anything. If a
second attempt is no better than the first, the check is a quiz, not a study
method, and the report should say so.
