# ADR 0016 — Search YouTube inside the workspace

## Status

Accepted 2026-11-26 — backend shipped in PR #41, UI in PR #42.

## Context

The product starts with a learner pasting a YouTube URL. That is friction, and
it also means the app learns nothing about a video until after the learner has
committed to it. The learner asked for a search box that returns candidate
lectures, with a quick signal of whether each one looks like study material and
what field it belongs to (CNTT, Toán, Hóa, Nấu ăn…).

Two constraints shape the decision:

1. YouTube's oEmbed (already used by `/video-info`) has title and channel but
   no duration, category, tags or search. Getting those needs the Data API v3.
2. Searching the HTML page or reverse-engineering InnerTube would avoid a key
   but is brittle and a poor fit for a real product. It is rejected.

## Decision

### Search source

`GET /api/youtube/search?q=&page_token=` is a public, anonymous proxy to
`search.list` + `videos.list` on the server. The API key stays server-side in
`YOUTUBE_DATA_API_KEY` (a `SecretStr`), and nothing about the endpoint's errors
or logs includes the query string that carries it.

The feature is **default-off**: both `YOUTUBE_SEARCH_ENABLED=true` and a key are
required. With no key the endpoint answers `200 {unavailable: true}` and the UI
keeps the existing paste-a-link box. This mirrors the ASR runtime decision.

### Budget

`search.list` costs 100 units and `videos.list` 1. A successful page consumes
101 units from a process-wide `DailyQuota` (`YOUTUBE_SEARCH_DAILY_UNITS`,
default 4000, leaving headroom under the usual 10.000/day). Results are cached
for `YOUTUBE_SEARCH_CACHE_TTL_SECONDS` (default 600s) and fetches are serialised
so concurrent identical searches cannot spend the quota twice. The endpoint
also joins the existing per-IP GET burst limiter. These counters are in memory:
moving to multiple workers requires Redis, the same known gap as AI quota and
SSE.

### Study fit (cheap preflight)

For each result the service reuses `content_policy.evaluate(..., check_length=False)`
with Data API title/channel as the evidence. Blocklist, allowlist and
non-lecture title patterns still apply; duration from `contentDetails.duration`
is checked against `CONTENT_MIN_DURATION_SECONDS`. The UI gets `fit`:

- `likely` — "Có vẻ là bài giảng"
- `unknown` — "Chưa rõ" or "Quá ngắn để học"
- `blocked` — "Không phù hợp", with a short reason

No caption fetch and no AI call happen during search. The full layer-1/2 gate
still runs when the learner actually loads the video.

### Study field (the "gắn thẻ" the learner asked for)

YouTube's `categoryId` is too coarse and author tags are noisy. A deterministic
classifier in `app/services/video_topics.py` matches the query, title, channel
and tags against a fixed vocabulary: Công nghệ thông tin, Toán học, Vật lý,
Hóa học, Sinh học, Nấu ăn, Ngôn ngữ, Kinh tế, Lịch sử · Địa lý, Y tế,
Âm nhạc · Nghệ thuật. Weights are title 3, channel 2, query 2, tags 1: the
result's own title must not be painted by whatever the learner typed in the
search box. No match returns `khac` / "Chưa xác định". There is no score or
percentage — a result either has a field or it does not.

This is deliberately not the learner's `projects.tags`, which describe saved
work after import, and not a cross-lecture concept graph.

### UI flow

The Workspace top bar gains a "Tìm video" toggle next to the URL box. Typing a
query shows thumbnails, channel, duration, field badge and fit badge. Clicking
a result fills the existing URL box **and starts loading it**, so one click is
enough to study. The paste-a-link flow remains untouched. The search page is a
selection surface, not a full YouTube client: no comments, subscriptions or
infinite recommendations. The Home page can reuse the same component later via
a `/app?video=<id>` deep link; that is out of scope here.

## Tests

Backend tests inject a fake Data API client whose `.get()` records calls. They
cover field classification, duration parsing, fit badges, caching, the process
quota, blocklist behaviour, short queries and quota-exceeded errors. A test
asserts the fake key never appears in a response. `conftest.py` forces search
off for every test, so no test can reach Google or read the real key. Frontend
tests use a stubbed `fetch`.

## Consequences

- A Data API key must be created and injected by the owner; the app does not
  ship one and this work never reads `.env`.
- Search quality is bounded by the fixed vocabulary; adding a field is a
  one-line rule plus a test. An AI-batched classifier can be added later if the
  deterministic labels prove too narrow, at the cost of one AI call per search.
- Every result's "likely" label is a preflight hint, not the final gate.
