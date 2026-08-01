# Research Assistant AI Agent

An agent that takes a research question, autonomously searches OpenAlex,
reads and scores each candidate paper against your specific question using an LLM,
and returns a ranked, explained shortlist — so you know not just *what* to read,
but *why* it matters for your question.

```
User Query
   │
   ▼
1. planQuery()        LLM extracts core concepts + 2-4 alternate search phrasings
   │
   ▼
2. searchPapers()      OpenAlex API call per phrasing → merge + dedupe by paperId
   │
   ▼
3. filterCandidates()  drop no-abstract papers, cap to top ~25 by citation/recency heuristic
   │                   (controls LLM cost/latency before the expensive step)
   ▼
4. analyzePapers()     parallel Groq calls (bounded concurrency) → per-paper JSON:
   │                   { contribution, method, relevanceScore 0-100, rationale }
   ▼
5. rankPapers()        finalScore = 0.65·relevance + 0.25·log(citations) + 0.10·recency
   │
   ▼
6. persist + return    cache Query/Paper/QueryResult in Postgres, stream ranked results to UI
```

## Why these design choices (worth saying out loud in an interview)

- **OpenAlex over Semantic Scholar for paper search.** Semantic Scholar's free API key requires an institutional-affiliation review with no guaranteed turnaround — a real risk on a 2-day timeline. OpenAlex needs no key at all (a `mailto` param just joins a "polite pool" for steadier rate limits) and has comparable coverage. The client is isolated in `src/lib/openAlex.ts` behind the same `RawPaper` interface, so swapping sources again later is a one-file change.
- **No embeddings/vector DB.** Running an embedding model inside a serverless function
  has real cold-start/timeout risk on a 2-day build. Instead, the LLM itself judges
  relevance directly against the specific question — arguably more "agentic" than
  cosine similarity, and zero extra infra. The code is structured so pgvector could be
  bolted on later as a pre-filtering step before the LLM pass (see **Future Work**).
- **Relevance is weighted far above citation count (0.65 vs 0.25).** Citation count
  alone rewards old, famous, often-irrelevant papers. The test suite has an explicit
  regression test for this: a highly-cited-but-off-topic paper must rank below a
  low-citation-but-on-topic one.
- **filterCandidates() exists purely for cost control.** Every paper that survives it
  costs one Groq call. Capping to ~25 and pre-sorting by a cheap heuristic keeps
  pipeline latency and API cost bounded regardless of how broad the search is.
- **SSE streaming instead of a single blocking request.** The pipeline takes 10-20s;
  streaming stage updates (`planning → searching → filtering → analyzing → ranking`)
  to the frontend avoids a dead spinner and makes the agent's steps visible.
- **Papers are cached globally, results per-query.** A paper fetched once from
  OpenAlex is upserted and reused across every future query that surfaces it —
  only the per-query LLM analysis is query-specific and gets re-run.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend + Backend | Next.js 14 (App Router, TypeScript), API routes only |
| DB | PostgreSQL via Neon (free tier) |
| ORM | Prisma |
| Paper source | OpenAlex Works API |
| LLM | Groq — `llama-3.3-70b-versatile`, JSON mode |
| Styling | Tailwind + hand-rolled shadcn-style primitives |
| Testing | Vitest (unit), Playwright (E2E, mocked network) |
| Deploy | Vercel |

## Project structure

```
src/
  app/
    page.tsx                    landing/search page
    api/search/route.ts         POST — runs the pipeline, streams SSE progress + result
    api/queries/[id]/route.ts   GET  — fetch a cached prior result
  components/
    SearchExperience.tsx        client-side search form + SSE stream handling
    AgentSteps.tsx               live pipeline-stage progress UI
    PaperCard.tsx                ranked paper result card
    ui/                          button, card, input, badge, skeleton
  lib/
    prisma.ts                   Prisma client singleton
    openAlex.ts                   OpenAlex client (retry/backoff, multi-query merge, abstract reconstruction)
    groq.ts                      Groq client (JSON mode, zod validation, retry)
    utils.ts                     withRetry, mapWithConcurrency, cn
    pipeline/
      planQuery.ts               step 1
      searchPapers.ts            step 2
      filterCandidates.ts        step 3
      analyzePapers.ts           step 4
      rankPapers.ts               step 5
      index.ts                   orchestrator — steps 1-6 + persistence
prisma/schema.prisma             Query / Paper / QueryResult
tests/unit/                      Vitest — 28 tests, all pure/mocked, no live API calls
tests/e2e/                       Playwright — mocks /api/search at the network layer
```

## Local setup

**Prerequisites:** Node 18+, a free [Neon](https://console.neon.tech) Postgres database,
a free [Groq](https://console.groq.com/keys) API key.

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL, DIRECT_URL (from Neon), GROQ_API_KEY (from Groq)

npx prisma generate
npx prisma db push        # creates tables from schema.prisma — no migration files needed for this scale

npm run dev                # http://localhost:3000
```

> Neon gives you two connection strings on the dashboard — a pooled one (`-pooler` in
> the hostname) and a direct one. Put the pooled one in `DATABASE_URL` and the direct
> one in `DIRECT_URL`; Prisma uses the direct connection for schema pushes/migrations
> and the pooled one at runtime, which matters on serverless where connection count
> can spike.

## Testing

```bash
npm test              # Vitest — 28 unit tests, pure functions + mocked network, no API keys needed
npm run test:e2e       # Playwright — mocks the /api/search SSE stream, so no live keys needed either
```

What's covered:
- `filterCandidates`: abstract-presence filtering, min-year filtering, citation/recency
  heuristic ordering, cap enforcement, empty-input edge case.
- `rankPapers`: rank ordering, the relevance-vs-citations weighting regression test
  described above, score-range sanity, single-item and empty-input edge cases.
- `semanticScholar.ts`: successful parse, retry-on-429, exhausted-retry failure,
  multi-phrasing dedupe, partial-failure resilience.
- `analyzePapers`: per-paper analysis on success, graceful drop on individual LLM
  failure (one bad paper doesn't kill the whole search), concurrency-limit enforcement.
- `utils`: `withRetry` and `mapWithConcurrency` in isolation.
- E2E: landing page render, full search flow with live agent-step progress → ranked
  results, error state, empty-results state, example-query click-to-search.

A real end-to-end smoke test (hitting live OpenAlex + Groq) should be run
manually before each deploy — see **Manual smoke test** below.

### Manual smoke test (before every deploy)

```bash
npm run dev
```
Then in the browser, run 2-3 real queries spanning different specificity levels, e.g.:
- "retrieval-augmented generation for reducing hallucination" (well-covered topic)
- "efficient fine-tuning methods for transformers" (broad — checks filterCandidates caps sanely)
- something deliberately obscure (checks the empty-results state renders correctly)

Confirm: agent steps render in order, results are plausibly relevant, citation counts
and years look right, and rationale text actually explains the ranking.

## Deployment (Vercel + Neon)

1. Push this repo to GitHub.
2. In Vercel: **New Project** → import the repo.
3. Add environment variables: `DATABASE_URL`, `DIRECT_URL`, `GROQ_API_KEY`
   (`OPENALEX_MAILTO` is optional but recommended — see .env.example).
4. Deploy. Vercel runs `npm run build`, which runs `prisma generate` first (see
   `package.json`), then `next build`.
5. After first deploy, run `npx prisma db push` locally against the **production**
   `DATABASE_URL` once to create tables in prod (or wire it into a release step).
6. Smoke-test the deployed URL with the same manual checklist above.

Note on Vercel's Hobby plan: serverless functions cap at 60s execution time, which is
why `maxDuration = 60` is set on `/api/search` and why `filterCandidates` caps the LLM
pass to ~25 papers at concurrency 5 — comfortably inside that window for typical queries.

## Future work

- **pgvector-backed pre-filtering.** Add an embeddings pass (e.g. via a Groq or
  Cohere embeddings endpoint, avoiding in-process model weights entirely) to do a
  cheap semantic pre-filter *before* the LLM relevance pass, so `filterCandidates`
  becomes semantic instead of purely citation/recency-based. The pipeline is already
  staged so this slots in as a new step 3.5 without touching steps 1-2 or 4-6.
- **Multi-source search**: merge in arXiv (excellent, free, no key, ideal for AI/ML/NLP/CV — the OpenAlex client's RawPaper shape makes this a drop-in second source) and/or Crossref for DOI/metadata enrichment.
- **User accounts + saved searches**, rather than anonymous per-query rows.
- **Feedback loop**: let users mark a result as irrelevant, feed that back into
  future `planQuery` prompts for the same user.

## Resume bullets (adapt as needed)

- Built and deployed a full-stack AI research agent (Next.js/TypeScript, Postgres,
  Groq LLM) that autonomously searches, reads, and ranks academic papers against a
  user's specific research question, reducing literature-discovery time from hours to
  seconds.
- Designed a 5-stage agentic pipeline (query planning → multi-source search → cost-aware
  filtering → parallel LLM analysis → weighted ranking) with bounded-concurrency LLM
  calls and exponential-backoff retry logic across two external APIs.
- Implemented a weighted relevance-ranking algorithm combining LLM-judged relevance,
  log-scaled citation impact, and recency, validated with unit tests including a
  regression test proving the ranker favors on-topic papers over merely-famous ones.
- Streamed real-time agent-execution progress to the frontend via Server-Sent Events,
  and wrote a 28-test Vitest suite plus a mocked-network Playwright E2E suite covering
  the full search flow, error states, and empty-result states.
