# Case Graph Reasoner

A Neo4j reasoning layer over Mongo legal-case data. Case questions are answered through relationships, evidence chains, cohorts, and stage history rather than isolated documents.

## Run locally

```bash
npm install
cp .env.example .env       # then fill in OPENAI_API_KEY (and Vertex if you have it)
npm run setup              # one command, A→Z: Docker Neo4j → clear → schema → ingest → signals → cohorts → similarity
npm run dev                # starts the Next.js UI at http://localhost:3000
```

## Reviewer / handoff quick start

The repo ships with a populated `.cache/ocr-llm-facts.json` (≈4 MB), which is a deterministic snapshot of every LLM-extracted OCR fact for the assessment Mongo dataset, keyed by `sha256(chunk_text)`. Because the OCR text in Mongo is fixed, every chunk hash is a hit on the next ingest, so `npm run setup` reproduces the full graph **without re-billing OpenAI**.

```bash
# 1. clone, install, set up env
npm install
cp .env.example .env
# edit .env → set OPENAI_API_KEY (the LLM enrichment uses cache → no spend, but the
# agent at request time calls OpenAI for chat answers).

# 2. one command — uses the shipped cache, ~5 minutes, $0 of OpenAI on extraction
npm run setup

# 3. start the UI
npm run dev
```

What `npm run setup` does, end-to-end:

1. Brings up local Neo4j in Docker.
2. Clears the graph and applies the schema (constraints + indexes).
3. Ingests cases, contacts, documents from Mongo.
4. Runs the **dual OCR fact extractor** for every `DocumentChunk`:
   - Deterministic regex pass (fast, free, always runs).
   - LLM pass (`gpt-4.1-mini`, batched, gated by `ENABLE_LLM_OCR_FACTS`). Reads `.cache/ocr-llm-facts.json` first; only chunks not in the cache call OpenAI.
5. Builds derived signals, cohorts, and similarity scores.
6. Runs `npm run verify:graph` to print node/edge counts plus OCR-fact diagnostics (by `kind`, by `source: regex|llm`, by `extractorVersion`, chunk-hash coverage).

If you want to skip the LLM pass entirely (regex-only graph, no OpenAI calls at all during ingest), set `ENABLE_LLM_OCR_FACTS=false` in `.env` before running setup. The `.env.example` ships it `true` because the cache makes it free.

To force a fresh extraction (will hit OpenAI), bump `OCR_LLM_EXTRACTOR_VERSION` in `.env` (e.g. `openai-ocr-v2`); cache keys are versioned, so a bump invalidates every entry.

## Environment

**LLM provider**

- `LLM_PROVIDER` — `vertex` or `openai`. Required in production. In development, auto-detects Vertex when Vertex env is present, otherwise OpenAI.
- `LLM_MODEL` — optional model override (default: `gemini-2.5-pro` for Vertex, `gpt-4.1` for OpenAI).
- `OPENAI_API_KEY` — required when provider is `openai`.
- `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` — required when provider is `vertex`.
- `GOOGLE_VERTEX_API_KEY` *or* `GOOGLE_APPLICATION_CREDENTIALS` — one of these must be set for Vertex auth. The path form (`GOOGLE_APPLICATION_CREDENTIALS`) is also satisfied by `gcloud auth application-default login`.
- `SEMANTIC_SIMILARITY_ENABLED` — `true` adds Vertex embeddings to the similarity score; falls back to signal-only on failure.
- `EMBEDDING_PROVIDER` — `vertex` or `openai`. Defaults to whichever has env present (Vertex if Vertex creds are set, otherwise OpenAI). Set explicitly when you want OpenAI embeddings even with Vertex creds present (useful when Vertex embedding quota is unprovisioned on a fresh GCP project).
- `VERTEX_EMBEDDING_MODEL` — Vertex embedding model id (default `text-embedding-004`).
- `OPENAI_EMBEDDING_MODEL` — OpenAI embedding model id (default `text-embedding-3-small`, returns 768-dim vectors when used by this project).
- `EMBEDDING_REQUEST_DELAY_MS` — milliseconds to sleep between embedding calls (default `1500`). Lower (e.g. `250`) on a high-quota provider; raise (e.g. `12000`) to stay under a 5-RPM tier.

**OCR LLM enrichment**

- `ENABLE_LLM_OCR_FACTS` — `true` runs an OpenAI pass over every OCR chunk during ingest, in addition to the deterministic regex extractor. Default `false` (regex only).
- `OPENAI_MODEL` — model id used for OCR enrichment (default `gpt-4.1-mini`). Independent of `LLM_MODEL`, which is the agent's chat model.
- `OCR_LLM_EXTRACTOR_VERSION` — version stamp persisted on every LLM-derived `EvidenceFact` and used as the cache key prefix (default `openai-ocr-v1`). Bump this to invalidate the file cache and re-run.
- `OCR_LLM_BATCH_SIZE` — number of chunks sent in a single OpenAI call (default `5`). Cuts wall time and per-call prompt overhead.
- `OCR_LLM_CONCURRENCY` — number of in-flight OpenAI calls (default `8`). Lower if you hit rate limits, raise on higher-tier accounts.
- `OCR_LLM_PROGRESS_EVERY` — print a progress line every N chunks (default `25`). Progress always includes elapsed time, ETA, tokens, and an estimated USD cost.
- `OCR_LLM_PRICE_INPUT_PER_MTOK` / `OCR_LLM_PRICE_OUTPUT_PER_MTOK` — override the built-in price table (USD per 1M tokens) for cost estimates.

**Data stores**

- `MONGODB_URI` — read-only source.
- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` — derived graph.

**Tracing & evals (optional)**

- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_PROMPT_LABEL` — when set, every tool call emits an OpenTelemetry span and prompts can be overridden remotely.
- `RUN_LLM_EVALS` — `true` to actually call the model in `npm run eval:golden`; otherwise eval definitions are only schema-checked.

**Test/dev flags**

- `SKIP_LLM_HEALTH_CHECK`, `SKIP_NEO4J_HEALTH_CHECK` — skip the corresponding startup probe.
- `BOOTSTRAP_INGEST` — set by `npm run setup` to chain ingest after schema.
- `AGENT_ADVANCED_TOOLS` — `true` exposes `getCaseGraphContext` to the agent (off by default to keep the tool surface focused).
- `ALLOW_TEST_GRAPH_LOAD` — guards `load-test-graph.ts`; only set inside the integration test runner.

## Model provider

The agent uses `src/llm/provider.ts` instead of binding to a single SDK. `LLM_PROVIDER=vertex` selects Vertex AI; `LLM_PROVIDER=openai` selects the local fallback. Both consume the Vercel AI SDK model interface, so switching providers does not change graph reads or readiness logic.

## Agent boundary

The agent is **prompt-guided typed tool selection plus graph-grounded tool execution**. The model chooses from the registered typed tools; the system prompt and tool descriptions explain when to use readiness, OCR evidence, comparable-case, medical-evidence, valuation, contacts, experts, and portfolio-aggregate tools. There is no regex-based turn policy that forces a scripted tool path, and there is no dynamic-Cypher escape hatch — every graph read is a typed tool whose Cypher lives in version control.

## Scripts

| Script                       | What it does                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run setup`              | One command, A→Z: Docker Neo4j → clear graph → apply schema → Mongo ingest → signals → cohorts → similarity edges → `verify:graph` summary. Idempotent and rerunnable. Set `BOOTSTRAP_SKIP_VERIFY=true` to skip the verify step. |
| `npm run schema`             | Apply constraints/indexes only (no data changes)                                                                                   |
| `npm run ingest`             | Non-clearing re-ingest: `MERGE`s source data and rebuilds derived analytics. This is rerunnable, but it is **not** true incremental CDC. Use `setup` for a clean slate. |
| `npm run similarity`         | Recompute `SIMILAR_TO` edges only (uses `SEMANTIC_SIMILARITY_ENABLED` if set)                                                       |
| `npm run clear`              | Delete all graph data (manual escape hatch)                                                                                        |
| `npm run dev` / `npm run build` | Next.js UI                                                                                                                       |
| `npm run test:unit`          | Pure unit tests (no Neo4j)                                                                                                         |
| `npm run test:integration`   | Spins up an isolated Neo4j on `:7688`, loads fixtures, exercises tools                                                             |
| `npm run smoke:readiness`    | Same isolated container, runs the readiness-tool integration suite end-to-end                                                      |
| `npm run eval:golden`        | Validates `evals/golden-agent.jsonl`; runs against the live model when `RUN_LLM_EVALS=true`                                        |
| `npm run verify:graph`       | Audits the live graph: counts per node label and relationship type, StageEvent source distribution, cohorts with timing provenance, samples |
| `npm run verify:cohorts`     | Cohort-only view: members, activity-log vs snapshot breakdown, confidence, common signals                                          |
| `npm run verify:readiness-fix` | Picks a real case + target stage and prints the structured output of the three readiness tools end-to-end                        |

## Submission verification

Run these before handoff:

```bash
npm run test:unit
npm run lint
npm run eval:golden
npm run test:integration
```

Expected result: unit tests, lint, golden-eval definition validation, and integration tests pass. `npm run eval:golden` only schema-checks `evals/golden-agent.jsonl` by default; set `RUN_LLM_EVALS=true` to call the live model and score tool sequencing. If the integration runner starts Neo4j before Bolt is ready, rerun `npm run test:integration`; the test suite itself uses an isolated Neo4j on `:7688`.

## Notes

- Chat is stateless: messages are not persisted between turns.
- The OpenAI fallback exists so reviewers can run the assessment without a Vertex project.
- `npm run build` is self-contained (no Google Fonts fetch).
- Neo4j Browser is reachable at `http://localhost:7474` for ad-hoc graph inspection.

## Reviewer demo path

1. Sparse readiness: `When will case 6938747665d3d3eb1c9967a4 be ready for file_claim?` The correct answer is low-confidence/no-estimate, because `file_claim` has one snapshot-only peer.
2. OCR evidence: ask for NII, disability, Regulation 15, salary slips, or missing-document evidence. The trace should show `DocumentChunk` / `EvidenceFact` hits with document provenance.
3. Comparable/value context: ask for comparable work-accident cases with disability evidence or value context. The answer should cite graph facts and report insufficient evidence when filters are too narrow.
4. Fastest stage timing: ask `Which cases reached file_claim fastest?` or another stage. The tool should expose whether timing came from activity-log transitions or current-stage snapshots.

## Examples

Captured against the production-ingested graph (70 cases). Real prompts → real tool calls → real answer style. Open the **Reasoning trace** panel under each chat reply to see Cypher, parameters, evidence chips, and per-step timing.

### 1. Case lookup with experts and SoL flag

```
> Show me details on case 6938746a65d3d3eb1c99679d.
```

| Tool call | Returns |
|---|---|
| `getCaseOverview({ caseId })` | `caseName: "(7488) סארה עוזרי"`, `legalStage: "case_building"`, `experts: [{name: "ליה סואעד", side: "ours"}, {name: "יזן מלכה", side: "ours"}]`, `legalFlags: { approachingSoL: false, monthsToSoL: 68 }` |

The agent's answer:
> Case (7488) סארה עוזרי · liability · case_building (active) · 16 months since event · SoL not urgent (68 months remaining). Two ours-experts on file: ליה סואעד, יזן מלכה. Missing critical: דיווח לעירייה, שאלון סטטורי.

### 2. Readiness on a sparse stage — system refuses to fabricate

```
> When will case 6938747665d3d3eb1c9967a4 be ready for file_claim?
```

| Tool call | Returns |
|---|---|
| `findCase({ query: "6938747665…" })` | 1 hit: `(7489) ריתאל פוקס`, liability, currently `case_building` |
| `deriveReadinessPattern({ caseId, targetStage: "file_claim" })` | `availability: "sparse_stage"`, `cohortAvailable: false`, `historicalPeerCount: 1` (below `MIN_COHORT_SIZE`), `observedCommonSignals: []` |
| `estimateTimeToStage({ caseId, targetStage: "file_claim" })` | `timingStatus: "no_estimate"`, `confidence: "low"`, `remainingDaysMedian: null`, `behindByDaysMedian: null`. Two uncertainty reasons: no cohort, and `0 activity-log peers below the 3-peer minimum (1 additional peer carries only a current-stage snapshot)`. |

The agent's answer:
> No reliable timing estimate is available. Only one historical peer reached `file_claim` in the entire portfolio, and its 332-day timing is a snapshot of case age at stage entry, not a measured transition. Confidence is **low** and no median is reported.

### 3. Fastest-to-stage with snapshot caveat

```
> Which cases reached settlement fastest?
```

| Tool call | Returns |
|---|---|
| `rankCasesByStageTransitionTime({ targetStage: "settlement" })` | 2 hits at 226 / 509 days. **`allTimingFromSnapshotOnly: true`**, `activityLogHitCount: 0`, `snapshotHitCount: 2`. |

The agent's answer:
> Two cases reached settlement: 226 days (`695459c5…` קורן) and 509 days (`694d52af…` בן דיין). **All durations are case-age at stage entry, not measured transitions** — true activity-log timing is not available for either case.

### 4. Insurer search and portfolio rollup (post-canonicalization)

```
> How many cases involve הראל as the insurer?
```

| Tool call | Returns |
|---|---|
| `searchCases({ insurer: "הראל" })` | 4 cases, all with normalized insurer node `הראל` (collapsed across raw variants `הראל`, `הראל ביטוח`, `הראל חברה לביטוח בע"מ`). |

```
> Distribution of cases by insurer.
```

| Tool call | Returns |
|---|---|
| `portfolioAggregates({ dimension: "insurer" })` | 23 distinct insurer buckets after the heuristic-driven canonicalization (legal-form-suffix stripping + 4-entry override table). Top: `ביטוח לאומי` 6, `איילון` 12 (covers the raw variants `איילון`, `איילון חברה לביטוח`, `איילון חברה לביטוח בע"מ`), `הראל` 5, etc. |

### 5. Cross-case contact dedup

```
> Show me all the lawyers we work with.
```

| Tool call | Returns |
|---|---|
| `listPortfolioContacts({ contactType: "lawyer" })` | 2 distinct lawyers. Each row carries `underlyingDedupKeys[]` listing the underlying `Contact` nodes that share the same `(normalizedName, contactType)` identity — visible signal of partial source-data anonymization (raw + hashed contact-detail variants for the same person). |

The agent's answer:
> Two lawyers across the portfolio: `אחמד אוזן` (1 case) and `נועם הוסלאמהץ` (1 case). Each appears under multiple Contact records due to raw + hashed contact-detail variants in source data — collapsed by `(normalizedName, contactType)`.

### What's not in the trace

When the data genuinely doesn't support a question, the agent says so rather than hallucinating: `availability: "none"`, `confidence: "low"`, explicit `uncertaintyReasons[]`. Examples 2 and 3 above show this pattern in action.

## LLM OCR enrichment

The OCR pipeline is dual-extractor:

- **Regex extraction is the deterministic baseline** and always runs (`src/pipeline/ingest/ocrFacts.ts`). Each fact is stamped with `source: "regex"` and `extractorVersion: "regex-v1"`.
- **OpenAI extraction runs only at ingest time** when `ENABLE_LLM_OCR_FACTS=true`. Chunks are batched (default 5 per OpenAI call, see `OCR_LLM_BATCH_SIZE`) and sent to `OPENAI_MODEL` (default `gpt-4.1-mini`) with a strict prompt covering the same 8 `EvidenceFactKind`s the regex extractor produces. Response is validated with Zod *per chunk*: unknown kinds are dropped, quotes are capped to 700 chars, quotes that don't appear in **that chunk's** text are rejected (which doubles as cross-chunk attribution defense), confidence is clamped to `[0, 1]`. LLM facts are stored as the same `EvidenceFact` nodes with `source: "llm"`.
- **Unchanged chunks are skipped** via a sha256 `chunkHash` on every `DocumentChunk`. The cache file at `.cache/ocr-llm-facts.json` keys by `${OCR_LLM_EXTRACTOR_VERSION}:${chunkHash}`, so re-ingest only calls OpenAI for new or changed chunks. (Neo4j is not the cache because the ingest path delete-then-inserts per document.)
- **Throughput is tuned with two env vars**, no code changes: `OCR_LLM_BATCH_SIZE` (default 5) and `OCR_LLM_CONCURRENCY` (default 8). Live progress prints elapsed time, rate, ETA, token counts, and an estimated USD cost so you see signs of life on a multi-thousand-chunk corpus.
- **LLM failures degrade quality, do not break ingest.** Each batch is wrapped in `try/catch`; on failure the regex baseline still lands in the graph and a warning is logged.
- **Tools don't change.** `searchDocumentEvidence`, `getCaseDocumentFacts`, `searchCasesByMedicalEvidence`, `findComparableCasesByFacts`, and `getCaseValueContext` already query `EvidenceFact`; LLM-derived facts join the same indexes automatically.
- **Readiness signals now include OCR facts.** `EvidenceFact` nodes emit `evidenceFactKind:*` and `evidenceFactSubtype:*` `ReadinessSignal`s, so document substance can participate in cohort mining and still point back to the originating fact/document/chunk.
- **Request-time chat still receives only retrieved evidence**, not the corpus. The LLM only ever sees one chunk's text at ingest time, never at request time.

## Privacy

The most sensitive fields are excluded at the ingest layer and never enter the graph at all: ID numbers, bank account details, and street/house number/postal code. OCR is graph-indexed as `DocumentChunk` nodes plus source-linked `EvidenceFact` nodes so the agent can answer document-substance, disability, NII, missing-document, and value questions from graph queries rather than metadata alone. Full communication bodies are still not modeled; contact phone/email and communication subject/preview are carried into the graph for relational reasoning (dedup, participant edges) and pass through tool traces, local turn logs, and Langfuse exports unredacted.

### What leaves the box (per provider)

| Path                                | Sent to                              | Payload                                                                                                                                              |
| ----------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent reasoning                     | OpenAI **or** Vertex (whichever `LLM_PROVIDER` resolves to) | The system prompt, the user message, and every tool input/output JSON — including raw Hebrew names, contact phone/email, and communication previews. |
| OCR evidence tools                  | OpenAI **or** Vertex through agent reasoning only | Retrieved OCR snippets and extracted fact quotes returned by graph tools, capped before being sent to the model. Full OCR blobs are not returned by tools. |
| Case-similarity embeddings          | OpenAI **or** Vertex (per `EMBEDDING_PROVIDER`) | One structured blob per case: `caseName`, `caseType`, `legalStage`, normalized injuries / body parts / insurers, document categories and types. **No** `aiGeneratedSummary`, **no** communication content, **no** contact email/phone. |
| Trace export                        | Langfuse (only if `LANGFUSE_PUBLIC_KEY` is set) | Same payload as the agent reasoning path, plus Cypher + parameters for each tool call.                                                               |

The embedding path is deliberately the narrowest: it carries graph-derived facts only, so two cases can be compared in vector space without the embedding provider ever seeing free-text narrative or claimant identifiers. If `caseName` (which contains the client surname) is also unacceptable for your destination provider, drop it from `caseEmbeddingText` in `src/pipeline/similarity/embeddings.ts`.

## Tradeoffs

- Readiness is composed from atomic tools the model can choose: pattern derivation, case comparison, timing estimate, timeline, evidence. When a stage is too sparse for a cohort, the tools return a low-confidence sparse-stage fallback rather than throwing.
- Cohort and peer-level timing both filter to activity-log-sourced StageEvents only; below the 3-member floor, `medianDaysToStage` is `null` and `timingStatus: "no_estimate"`. Snapshot-sourced StageEvents are still kept for cohort *membership* and per-row evidence — they just don't drive the aggregate. When the rank tool returns only snapshot rows, the tool surfaces `allTimingFromSnapshotOnly: true` and the agent caveats the answer.
- Similarity stays explainable through readiness signals; embeddings add `semanticScore` when `SEMANTIC_SIMILARITY_ENABLED=true`.
- Cohorts require 5 members to form, 12 for medium confidence, 25 for high. When same-type history is thin, the result widens to global and surfaces that context in `uncertaintyReasons`.
- Insurer canonicalization is heuristic-driven (legal-form suffix stripping over a 7-token stopword set) with a 4-entry override table for edge cases like `ביטוח ישיר` (where `ביטוח` is brand, not suffix) and `המוסד לביטוח לאומי` → `ביטוח לאומי`. Any new insurer that follows the brand+suffix convention auto-canonicalizes without code changes.

## Known limitations

| Limitation | Current behavior |
|---|---|
| Sparse stage history | Only a few activity-log rows contain parseable stage transitions, so timing tools prefer activity-log evidence and return `no_estimate` when the peer floor is not met. |
| `file_claim` has one peer | The system intentionally refuses to fabricate a learned readiness pattern or median for this stage. |
| Limited OCR ontology | OCR facts cover a bounded set of legal/medical evidence kinds; unknown fact types remain searchable as text chunks but are not extracted as structured facts. |
| Batch analytics | Ingest is rerunnable and idempotent, but derived signals/cohorts/similarity are rebuilt rather than updated via CDC. |
| Similarity scale | Signal similarity is explainable, but pairwise recomputation is O(n²); production scale would need candidate generation, persisted embeddings, or ANN/vector indexing. |
