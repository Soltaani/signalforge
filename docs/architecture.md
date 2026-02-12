# Trend CLI — Architecture Document

> **Source PRD:** `product-requirement-doc.md` v1.1
> **Generated:** 2026-02-11
> **Stack:** TypeScript 5.8+ · Node.js 22+ · ESM

---

## 1. Project Structure

```
trend-cli/
├── package.json
├── tsconfig.json
├── trend.config.json              # Default config (committed)
├── prompts/
│   ├── extract-v1.md              # Stage 1 prompt template
│   ├── score-v1.md                # Stage 2 prompt template
│   └── generate-v1.md             # Stage 3 prompt template
├── src/
│   ├── index.ts                   # CLI entrypoint (commander setup)
│   ├── commands/
│   │   ├── scan.ts                # `trend scan` command handler
│   │   ├── report.ts              # `trend report` command handler
│   │   ├── drill.ts               # `trend drill` command handler
│   │   ├── feeds.ts               # `trend feeds` command handler
│   │   ├── validate.ts            # `trend validate` command handler
│   │   └── purge.ts               # `trend purge` command handler
│   ├── pipeline/
│   │   ├── orchestrator.ts        # Runs fetch → dedupe → pack → analyze → validate → render
│   │   ├── fetcher.ts             # RSS fetching with p-limit concurrency
│   │   ├── normalizer.ts          # RSS → Item schema normalization
│   │   ├── deduplicator.ts        # Exact + optional semantic dedup
│   │   ├── evidence-pack.ts       # Evidence Pack builder (token-aware filtering)
│   │   └── token-estimator.ts     # Token counting / context window math
│   ├── agent/
│   │   ├── provider.ts            # LLMProvider interface + factory
│   │   ├── openai-provider.ts     # OpenAI implementation (zodResponseFormat)
│   │   ├── anthropic-provider.ts  # Anthropic implementation (betaZodTool)
│   │   ├── stages/
│   │   │   ├── extract.ts         # Stage 1: Cluster + Pain Signals
│   │   │   ├── score.ts           # Stage 2: Comparative Scoring
│   │   │   └── generate.ts        # Stage 3: Opportunities + Best Bet
│   │   └── schemas/
│   │       ├── extract-schema.ts  # Zod schema for Stage 1 output
│   │       ├── score-schema.ts    # Zod schema for Stage 2 output
│   │       └── generate-schema.ts # Zod schema for Stage 3 output
│   ├── validation/
│   │   ├── schema-validator.ts    # Ajv 2020-12 JSON Schema validation
│   │   ├── evidence-checker.ts    # Evidence coverage / orphan ID detection
│   │   └── score-checker.ts       # Score consistency / rank inversion checks
│   ├── storage/
│   │   ├── database.ts            # SQLite connection + migrations
│   │   ├── item-store.ts          # CRUD for items table
│   │   ├── feed-store.ts          # CRUD for feeds table
│   │   ├── run-store.ts           # CRUD for runs table
│   │   └── cache-store.ts         # Agent output cache (by composite key)
│   ├── rendering/
│   │   ├── markdown-renderer.ts   # Report → Markdown
│   │   └── json-renderer.ts       # Report → JSON
│   ├── config/
│   │   ├── loader.ts              # Config file discovery + merge + validation
│   │   ├── defaults.ts            # Default config values
│   │   └── schema.ts              # Config Zod schema
│   └── utils/
│       ├── url.ts                 # URL normalization (strip tracking params, etc.)
│       ├── hash.ts                # SHA-256 hashing (evidence pack, prompts, items)
│       ├── duration.ts            # Parse "24h", "7d" → ms
│       ├── logger.ts              # Structured logging + --progress timings
│       └── errors.ts              # Custom error classes + exit codes
├── schemas/
│   └── report.v1.json             # JSON Schema 2020-12 for final report
└── tests/
    ├── unit/
    │   ├── normalizer.test.ts
    │   ├── deduplicator.test.ts
    │   ├── evidence-pack.test.ts
    │   ├── token-estimator.test.ts
    │   ├── url.test.ts
    │   ├── schema-validator.test.ts
    │   ├── evidence-checker.test.ts
    │   └── score-checker.test.ts
    ├── integration/
    │   ├── pipeline.test.ts
    │   ├── openai-provider.test.ts
    │   └── anthropic-provider.test.ts
    └── fixtures/
        ├── rss-samples/            # Sample RSS XML for testing
        ├── evidence-packs/         # Sample evidence packs
        └── agent-outputs/          # Sample stage outputs for validation tests
```

---

## 2. High-Level Data Flow

```
                     ┌─────────────┐
                     │  RSS Feeds  │
                     │ (7 default) │
                     └──────┬──────┘
                            │ p-limit (concurrency=5)
                            ▼
                     ┌─────────────┐
                     │   Fetcher   │  Per-feed: 10s timeout, 2 retries
                     │  (fetcher)  │  Promise.allSettled isolation
                     └──────┬──────┘
                            │ raw RSS entries
                            ▼
                     ┌─────────────┐
                     │ Normalizer  │  RSS fields → Item schema
                     │(normalizer) │  content > summary > snippet
                     └──────┬──────┘
                            │ Item[]
                            ▼
                  ┌──────────────────┐
                  │   SQLite Store   │  Persist items + feed status
                  │   (database)     │  WAL mode, batch transactions
                  └────────┬─────────┘
                           │ Item[]
                           ▼
                  ┌──────────────────┐
                  │  Deduplicator    │  Exact: url/hash match
                  │ (deduplicator)   │  Optional: semantic (0.88 threshold)
                  └────────┬─────────┘
                           │ deduped Item[]
                           ▼
                  ┌──────────────────┐
                  │  Evidence Pack   │  Token-aware filtering
                  │  Builder         │  Sort by tier*weight*recency
                  │(evidence-pack)   │  Hash for caching
                  └────────┬─────────┘
                           │ EvidencePack
                           ▼
              ┌────────────────────────────┐
              │    Pipeline Orchestrator    │
              │       (orchestrator)        │
              │                            │
              │  ┌──────────────────────┐  │
              │  │ Stage 1: Extract     │  │  LLM call #1
              │  │ → Clusters + Pain    │  │  Validate → retry if needed
              │  └──────────┬───────────┘  │
              │             │              │
              │  ┌──────────▼───────────┐  │
              │  │ Stage 2: Score       │  │  LLM call #2
              │  │ → Scores + Rankings  │  │  Validate → retry if needed
              │  └──────────┬───────────┘  │
              │             │              │
              │  ┌──────────▼───────────┐  │
              │  │ Stage 3: Generate    │  │  LLM call #3
              │  │ → Opportunities      │  │  Validate → retry if needed
              │  └──────────┬───────────┘  │
              └─────────────┼──────────────┘
                            │ validated report
                            ▼
                  ┌──────────────────┐
                  │    Renderers     │  Markdown + JSON
                  │  (rendering/)    │  stdout or file
                  └──────────────────┘
```

---

## 3. Module Specifications

### 3.1 CLI Entrypoint (`src/index.ts`)

**Dependency:** `commander` ^13.x

```typescript
import { Command } from 'commander';

const program = new Command();
program
  .name('trend')
  .description('Trend-driven opportunity detection engine')
  .version('1.0.0');

// Register subcommands
program.command('scan')   /* → ./commands/scan.ts   */
program.command('report') /* → ./commands/report.ts */
program.command('drill')  /* → ./commands/drill.ts  */
program.command('feeds')  /* → ./commands/feeds.ts  */
program.command('validate') /* → ./commands/validate.ts */
program.command('purge')  /* → ./commands/purge.ts  */

// Use parseAsync for async action handlers
await program.parseAsync(process.argv);
```

Each command handler:
1. Loads + merges config (file defaults + CLI flag overrides)
2. Calls the pipeline orchestrator with resolved options
3. Handles exit codes (0 = success, 1 = fatal, 2 = partial)

---

### 3.2 Pipeline Orchestrator (`src/pipeline/orchestrator.ts`)

The orchestrator is the central coordinator. It owns the pipeline sequence and all flow control is deterministic — no LLM-driven branching.

```typescript
interface PipelineOptions {
  window: string;           // "24h" | "7d" etc.
  filter?: string;          // keyword filter
  maxItems: number;         // default 500
  maxClusters: number;      // default 12
  maxIdeasPerCluster: number; // default 3
  agentEnabled: boolean;
  provider: LLMProvider;
  config: TrendConfig;
}

interface PipelineResult {
  report: Report;           // Full JSON report matching schema
  warnings: Message[];
  errors: Message[];
  exitCode: 0 | 1 | 2;
}

async function runPipeline(options: PipelineOptions): Promise<PipelineResult>
```

**Pipeline sequence:**

| Step | Module | Description | Can fail? |
|------|--------|-------------|-----------|
| 1 | `fetcher` | Fetch RSS feeds concurrently | Per-feed (isolated) |
| 2 | `normalizer` | Normalize raw entries → `Item[]` | No (pure transform) |
| 3 | `item-store` | Persist to SQLite | Fatal if DB error |
| 4 | `deduplicator` | Exact + optional semantic dedup | No |
| 5 | `evidence-pack` | Token-aware filtering + hash | No |
| 6 | `cache-store` | Check cache by composite key | No (miss = continue) |
| 7 | `extract` (Stage 1) | LLM: clusters + pain signals | Fatal if fails after retry |
| 8 | `score` (Stage 2) | LLM: scoring + rankings | Partial ok (exit 2) |
| 9 | `generate` (Stage 3) | LLM: opportunities + best bet | Partial ok (exit 2) |
| 10 | `schema-validator` | JSON Schema 2020-12 validation | Warnings |
| 11 | `evidence-checker` | Evidence coverage validation | Warnings |
| 12 | `score-checker` | Score consistency checks | Warnings |
| 13 | `cache-store` | Cache valid results | No |
| 14 | `renderers` | Output Markdown / JSON | No |

---

### 3.3 RSS Fetcher (`src/pipeline/fetcher.ts`)

**Dependencies:** `rss-parser` ^3.x, `p-limit` ^6.x

```typescript
import Parser from 'rss-parser';
import pLimit from 'p-limit';

interface FetchResult {
  feedId: string;
  ok: boolean;
  items: RawRSSItem[];
  error?: string;
  fetchedAt: string;
}

async function fetchAllFeeds(
  feeds: FeedConfig[],
  window: string
): Promise<FetchResult[]>
```

**Behavior:**
- Concurrency: `p-limit(5)` — max 5 feeds fetched in parallel
- Per-feed timeout: 10 seconds (via `AbortController` + `setTimeout`)
- Retry: 2 attempts with exponential backoff (1s, 2s)
- Isolation: `Promise.allSettled` — one feed failure never crashes the run
- Window filter: Only return items with `publishedAt` within the time window

```typescript
// p-limit usage pattern (from docs — ESM import)
import pLimit from 'p-limit';

const limit = pLimit(5);

const results = await Promise.allSettled(
  feeds.filter(f => f.enabled).map(feed =>
    limit(() => fetchSingleFeed(feed, window))
  )
);
```

---

### 3.4 Normalizer (`src/pipeline/normalizer.ts`)

Pure function. Transforms raw RSS entries into the unified `Item` schema.

```typescript
interface Item {
  id: string;          // Generated UUID
  sourceId: string;    // Feed ID
  tier: 1 | 2 | 3;
  weight: number;
  title: string;
  url: string;
  publishedAt: string; // ISO 8601
  text: string;        // Best content: content > summary > snippet
  author?: string;
  tags?: string[];
  hash: string;        // SHA-256 of normalized(url + title)
  fetchedAt: string;   // ISO 8601
}

function normalizeItems(raw: RawRSSItem[], feed: FeedConfig): Item[]
```

**Text priority:** `item.content` > `item.contentSnippet` > `item.summary` > `item.title`

**Hash computation:** `SHA-256(normalizeUrl(url) + '|' + title.toLowerCase().trim())`

---

### 3.5 Deduplicator (`src/pipeline/deduplicator.ts`)

```typescript
interface DeduplicationResult {
  items: Item[];              // Deduplicated items (canonical winners)
  duplicatesRemoved: number;
  mergeLog: Array<{ canonical: string; duplicateIds: string[] }>;
}

function deduplicate(items: Item[], options: {
  semanticDedup?: boolean;
  threshold?: number;         // default 0.88
}): DeduplicationResult
```

**Exact dedup:**
1. Normalize URLs (lowercase host, strip trailing `/`, remove `utm_*` / `ref` / `source` params, `http→https`)
2. Group by normalized URL or hash
3. Pick canonical by tie-breaking: higher tier > longer text > more recent `publishedAt`

**Semantic dedup (optional, `--semantic-dedup`):**
- Compare text similarity using configurable embedding model
- Merge items above threshold (default 0.88)
- Same canonical selection rules apply

---

### 3.6 Evidence Pack Builder (`src/pipeline/evidence-pack.ts`)

```typescript
interface EvidencePack {
  metadata: {
    window: string;
    topic: string;
    thresholds: Thresholds;
    maxClusters: number;
    maxIdeasPerCluster: number;
  };
  feeds: FeedSummary[];
  items: EvidenceItem[];       // Trimmed items sent to agent
  stats: {
    totalItemsCollected: number;
    totalItemsAfterDedup: number;
    totalItemsSentToAgent: number;
    itemsFilteredByTokenLimit: number;
  };
  hash: string;                // SHA-256 of deterministic JSON
}
```

**Token-aware filtering algorithm:**

```
1. Estimate avgTokensPerItem = mean(items.map(estimateTokens))
2. maxItems = floor((contextWindowTokens - reserveTokens) / avgTokensPerItem)
3. Cap at user --maxItems (default 500)
4. Sort items by: tierWeight * recencyScore (descending)
5. Take top min(maxItems, cappedMaxItems) items
6. Log: "Filtered {N} items → {M} sent to agent ({K} removed by token limit)"
```

**Hash:** `SHA-256` of the deterministic JSON serialization of the evidence pack (sorted keys).

---

### 3.7 Token Estimator (`src/pipeline/token-estimator.ts`)

```typescript
function estimateTokens(text: string): number
// Heuristic: ~4 chars per token for English text
// Returns ceil(text.length / 4)

function estimateEvidencePackTokens(pack: EvidencePack): number
// Sum of all item text tokens + metadata overhead
```

Simple character-based heuristic (`chars / 4`). Sufficient for budget estimation — exact tokenization is not needed since we have `reserveTokens` as a buffer.

---

### 3.8 LLM Provider Abstraction (`src/agent/provider.ts`)

~200 LOC. The core interface both providers implement:

```typescript
interface LLMCallParams<T> {
  systemPrompt: string;
  userContent: string;
  outputSchema: ZodType<T>;
  temperature?: number;       // default 0.2
  maxTokens?: number;         // default 8192
}

interface LLMProvider {
  call<T>(params: LLMCallParams<T>): Promise<T>;
  readonly name: string;      // "openai" | "anthropic"
  readonly model: string;     // "gpt-5.2" | "claude-sonnet-4-5-20250929"
}

function createProvider(config: AgentConfig): LLMProvider
```

**Retry strategy:** If the first call returns invalid data (Zod parse failure or structured output refusal), retry once with the validation errors appended to the user content. If second attempt fails, throw `ProviderError`.

---

### 3.9 OpenAI Provider (`src/agent/openai-provider.ts`)

**Dependency:** `openai` ^6.x

```typescript
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';

class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  async call<T>(params: LLMCallParams<T>): Promise<T> {
    const completion = await this.client.chat.completions.parse({
      model: this.config.model,   // 'gpt-5.2'
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userContent },
      ],
      response_format: zodResponseFormat(params.outputSchema, 'stage_output'),
      temperature: params.temperature ?? 0.2,
    });

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      throw new ProviderError('No parsed response from OpenAI');
    }
    return parsed as T;
  }
}
```

**Key API details (from Context7 / OpenAI Node SDK v6.1.0):**
- `zodResponseFormat()` converts Zod schema → JSON Schema for the API
- `client.chat.completions.parse()` auto-parses response into typed object
- `completion.choices[0].message.parsed` contains the strongly-typed result
- `beta.chat` namespace is removed in v6 — use `chat.completions` directly

---

### 3.10 Anthropic Provider (`src/agent/anthropic-provider.ts`)

**Dependency:** `@anthropic-ai/sdk` latest

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';

class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  async call<T>(params: LLMCallParams<T>): Promise<T> {
    const tool = betaZodTool({
      name: 'submit_output',
      description: 'Submit structured analysis output',
      inputSchema: params.outputSchema,
      run: async (input) => JSON.stringify(input),
    });

    const result = await this.client.beta.messages.toolRunner({
      model: this.config.model,    // 'claude-sonnet-4-5-20250929'
      max_tokens: params.maxTokens ?? 8192,
      messages: [
        {
          role: 'user',
          content: `${params.systemPrompt}\n\n${params.userContent}`,
        },
      ],
      tools: [tool],
    });

    // Extract the tool call input from the final message
    const toolUseBlock = result.content.find(
      (block) => block.type === 'tool_use'
    );
    if (!toolUseBlock) {
      throw new ProviderError('No tool use in Anthropic response');
    }
    return toolUseBlock.input as T;
  }
}
```

**Key API details (from Context7 / Anthropic SDK TS):**
- `betaZodTool()` accepts `name`, `inputSchema` (Zod), `description`, `run`
- `client.beta.messages.toolRunner()` handles the tool-calling loop
- System prompt is sent as part of the user message (Anthropic messages API)
- `max_tokens` is required (default 8192 is reasonable for stage outputs)

---

### 3.11 Agent Stages (`src/agent/stages/`)

Each stage is a function that builds the prompt and calls the provider.

#### Stage 1 — Extract (`extract.ts`)

```typescript
interface ExtractInput {
  evidencePack: EvidencePack;
  maxClusters: number;
}

interface ExtractOutput {
  clusters: Array<{
    id: string;
    label: string;
    summary: { claim: string; evidence: string[]; snippets?: string[] };
    keyphrases: string[];
    itemIds: string[];
    painSignals: PainSignal[];
  }>;
}

async function runExtractStage(
  provider: LLMProvider,
  input: ExtractInput
): Promise<ExtractOutput>
```

**Prompt strategy:** Evidence-first — instruct the model to quote item text *before* synthesizing labels/summaries. This prevents hallucination where the model generates a plausible claim then backfills citations.

#### Stage 2 — Score (`score.ts`)

```typescript
interface ScoreInput {
  clusters: ExtractOutput['clusters'];  // Summaries + pain signals only (no full item text)
}

interface ScoreOutput {
  scoredClusters: Array<{
    clusterId: string;
    score: number;
    rank: number;
    scoreBreakdown: ScoreBreakdown;
    whyNow: GroundedClaim;
  }>;
}
```

**Prompt includes:** Scoring anchors table (0–5, 6–12, 13+) with concrete examples for each factor. Forced comparative ranking after scoring all clusters.

#### Stage 3 — Generate (`generate.ts`)

```typescript
interface GenerateInput {
  qualifyingClusters: ScoredCluster[];  // score >= threshold (default 65)
  items: EvidenceItem[];                 // Full item text for qualifying clusters only
  maxIdeasPerCluster: number;
}

interface GenerateOutput {
  opportunities: Opportunity[];
  bestBet: {
    clusterId: string;
    opportunityId: string;
    why: GroundedClaim[];
  };
}
```

**Prompt includes:** Examples of generic vs specific ideas. Penalizes "AI-powered dashboard" style generics unless evidence is unusually strong.

---

### 3.12 Zod Schemas (`src/agent/schemas/`)

Shared Zod schemas define the structured output contract for each stage. These schemas serve double duty:
1. Passed to `zodResponseFormat` (OpenAI) or `betaZodTool` (Anthropic) for structured output
2. Used for TypeScript type inference (`z.infer<typeof Schema>`)

```typescript
// Example: extract-schema.ts
import { z } from 'zod';

export const PainSignalSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'complaint', 'urgency', 'workaround',
    'monetization', 'buyer', 'risk'
  ]),
  statement: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  snippets: z.array(z.string()).optional(),
});

export const GroundedClaimSchema = z.object({
  claim: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  snippets: z.array(z.string()).optional(),
});

export const ExtractOutputSchema = z.object({
  clusters: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    summary: GroundedClaimSchema,
    keyphrases: z.array(z.string()),
    itemIds: z.array(z.string().min(1)).min(1),
    painSignals: z.array(PainSignalSchema),
  })).min(1),
});

export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;
```

---

### 3.13 Validation Layer (`src/validation/`)

Three validators run after each stage and on the final report:

#### Schema Validator (`schema-validator.ts`)

**Dependencies:** `ajv` ^8.x (2020-12 draft), `ajv-formats` ^3.x

```typescript
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

// Compile once, reuse
const validateReport = ajv.compile(reportSchemaJSON);

function validateStageOutput(stage: string, data: unknown): ValidationResult {
  const validate = ajv.compile(stageSchemas[stage]);
  const valid = validate(data);
  if (!valid) {
    return {
      ok: false,
      errors: validate.errors!.map(err =>
        `${err.instancePath}: ${err.message}`
      ),
    };
  }
  return { ok: true, errors: [] };
}
```

#### Evidence Checker (`evidence-checker.ts`)

```typescript
function checkEvidenceCoverage(
  report: Report,
  evidencePack: EvidencePack
): ValidationResult {
  const validItemIds = new Set(evidencePack.items.map(i => i.id));
  const errors: string[] = [];

  // Check all cluster itemIds exist
  for (const cluster of report.clusters) {
    for (const itemId of cluster.itemIds) {
      if (!validItemIds.has(itemId)) {
        errors.push(`Orphaned itemId "${itemId}" in cluster "${cluster.id}"`);
      }
    }
    // Check pain signal evidence
    for (const signal of cluster.painSignals) {
      for (const eid of signal.evidence) {
        if (!validItemIds.has(eid)) {
          errors.push(`Orphaned evidence "${eid}" in pain signal "${signal.id}"`);
        }
      }
    }
  }
  // ... similar for opportunities, bestBet
  return { ok: errors.length === 0, errors };
}
```

#### Score Checker (`score-checker.ts`)

```typescript
function checkScoreConsistency(clusters: Cluster[]): ValidationResult {
  const errors: string[] = [];

  for (const c of clusters) {
    const bd = c.scoreBreakdown;
    // Factor scores must not exceed their max
    if (bd.frequency.score > bd.frequency.max) { /* ... */ }
    // Total must equal sum
    const sum = bd.frequency.score + bd.painIntensity.score
      + bd.buyerClarity.score + bd.monetizationSignal.score
      + bd.buildSimplicity.score + bd.novelty.score;
    if (c.score !== sum) {
      errors.push(`Cluster "${c.id}": score ${c.score} != sum ${sum}`);
    }
  }

  // Check rank inversions
  const sorted = [...clusters].sort((a, b) => b.score - a.score);
  // ... verify rank field matches sort order

  return { ok: errors.length === 0, errors };
}
```

---

### 3.14 SQLite Storage (`src/storage/database.ts`)

**Dependency:** `better-sqlite3` ^12.x

```typescript
import Database from 'better-sqlite3';

function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
```

#### Schema (4 tables)

```sql
-- Items table
CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,
  sourceId     TEXT NOT NULL,
  tier         INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
  weight       REAL NOT NULL CHECK(weight >= 0 AND weight <= 5),
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  publishedAt  TEXT NOT NULL,           -- ISO 8601
  text         TEXT DEFAULT '',
  author       TEXT,
  hash         TEXT NOT NULL,
  fetchedAt    TEXT NOT NULL,           -- ISO 8601
  tags         TEXT DEFAULT '[]',       -- JSON array
  dedupedInto  TEXT REFERENCES items(id),
  UNIQUE(hash)
);
CREATE INDEX idx_items_publishedAt ON items(publishedAt);
CREATE INDEX idx_items_sourceId ON items(sourceId);
CREATE INDEX idx_items_hash ON items(hash);

-- Feeds table
CREATE TABLE IF NOT EXISTS feeds (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  tier          INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
  weight        REAL NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  tags          TEXT DEFAULT '[]',      -- JSON array
  lastFetchedAt TEXT,
  lastStatus    TEXT DEFAULT '{}'       -- JSON object
);

-- Runs table
CREATE TABLE IF NOT EXISTS runs (
  runId             TEXT PRIMARY KEY,
  window            TEXT NOT NULL,
  topic             TEXT DEFAULT '',
  evidencePackHash  TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'running',
  createdAt         TEXT NOT NULL        -- ISO 8601
);

-- Cache table
CREATE TABLE IF NOT EXISTS cache (
  cacheKey    TEXT PRIMARY KEY,          -- hash(evidencePackHash + promptVersion + model + provider)
  stageId     TEXT NOT NULL,             -- 'extract' | 'score' | 'generate'
  reportJson  TEXT NOT NULL,             -- JSON blob
  createdAt   TEXT NOT NULL              -- ISO 8601
);
CREATE INDEX idx_cache_stageId ON cache(stageId);
```

#### Batch Insert Pattern

```typescript
const insertItem = db.prepare(`
  INSERT OR IGNORE INTO items (id, sourceId, tier, weight, title, url, publishedAt, text, author, hash, fetchedAt, tags)
  VALUES (@id, @sourceId, @tier, @weight, @title, @url, @publishedAt, @text, @author, @hash, @fetchedAt, @tags)
`);

const insertMany = db.transaction((items: Item[]) => {
  for (const item of items) {
    insertItem.run({
      ...item,
      tags: JSON.stringify(item.tags ?? []),
    });
  }
});

// Usage: insertMany(normalizedItems);
```

---

### 3.15 Cache Strategy (`src/storage/cache-store.ts`)

Cache key composition:

```typescript
function buildCacheKey(
  evidencePackHash: string,
  promptVersion: string,     // SHA-256 of all prompt files
  model: string,
  provider: string,
  stageId: string
): string {
  return sha256(`${evidencePackHash}|${promptVersion}|${model}|${provider}|${stageId}`);
}
```

**Cache hit:** Return cached stage output, skip LLM call.
**Cache invalidation:** Automatic — changing any of (evidence pack, prompts, model, provider) produces a different key.

---

### 3.16 Prompt Versioning

Prompts live in `prompts/` as versioned Markdown files:

```
prompts/
  extract-v1.md
  score-v1.md
  generate-v1.md
```

At startup, all prompt files are read and their combined SHA-256 hash is computed:

```typescript
function computePromptVersion(promptDir: string): string {
  const files = glob.sync('*.md', { cwd: promptDir });
  const contents = files.sort().map(f => readFileSync(join(promptDir, f), 'utf-8'));
  return sha256(contents.join('\n'));
}
```

This hash is recorded as `metadata.promptVersion` in the report and used in cache keys.

---

### 3.17 Config Loader (`src/config/loader.ts`)

**Resolution order (last wins):**

1. Built-in defaults (`src/config/defaults.ts`)
2. Global config: `~/.config/trend/config.json`
3. Local config: `./trend.config.json` (cwd)
4. CLI flags (highest priority)

```typescript
import { z } from 'zod';

const AgentConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  model: z.string().default('gpt-5.2'),
  temperature: z.number().min(0).max(1).default(0.2),
  endpoint: z.string().nullable().default(null),
  maxTokens: z.number().int().positive().nullable().default(null),
  contextWindowTokens: z.number().int().positive().default(400_000),
  reserveTokens: z.number().int().positive().default(30_000),
});

const FeedConfigSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  weight: z.number().min(0).max(5),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

const TrendConfigSchema = z.object({
  agent: AgentConfigSchema,
  feeds: z.array(FeedConfigSchema).min(1),
  thresholds: z.object({
    minScore: z.number().int().min(0).max(100).default(65),
    minClusterSize: z.number().int().min(1).default(2),
    dedupeThreshold: z.number().min(0).max(1).default(0.88),
  }),
});

export type TrendConfig = z.infer<typeof TrendConfigSchema>;
```

---

### 3.18 Rendering (`src/rendering/`)

#### Markdown Renderer (`markdown-renderer.ts`)

Generates a report with these sections:
1. Title + date + window + topic
2. Executive summary (3–6 bullets)
3. Ranked clusters (label, score, factor breakdown, headlines with links, pain signals, opportunities)
4. Best bet recommendation
5. Validation plan (next 7 days)
6. Feed health (failures / warnings)

#### JSON Renderer (`json-renderer.ts`)

Outputs the full report matching `schemas/report.v1.json`:
- `metadata` + config snapshot
- `feeds` status
- `clusters` + `opportunities` + `bestBet`
- `warnings` / `errors`

---

### 3.19 Error Handling (`src/utils/errors.ts`)

```typescript
class TrendError extends Error {
  constructor(
    message: string,
    public code: string,
    public exitCode: 0 | 1 | 2
  ) {
    super(message);
  }
}

class FeedFetchError extends TrendError {
  constructor(feedId: string, cause: Error) {
    super(`Feed ${feedId} failed: ${cause.message}`, 'FEED_FETCH_ERROR', 2);
  }
}

class ProviderError extends TrendError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR', 1);
  }
}

class ValidationError extends TrendError {
  constructor(stage: string, errors: string[]) {
    super(
      `Validation failed for ${stage}: ${errors.join('; ')}`,
      'VALIDATION_ERROR',
      2
    );
  }
}

// Exit codes:
// 0 = Success
// 1 = Fatal error (Stage 1 failure, DB error, config error)
// 2 = Partial success (Stage 2/3 failure with partial output)
```

---

## 4. Dependency Graph

```
src/index.ts
  └─ commands/*
       └─ pipeline/orchestrator.ts
            ├─ pipeline/fetcher.ts          → rss-parser, p-limit
            ├─ pipeline/normalizer.ts       → (pure)
            ├─ pipeline/deduplicator.ts     → utils/url, utils/hash
            ├─ pipeline/evidence-pack.ts    → pipeline/token-estimator, utils/hash
            ├─ agent/provider.ts
            │    ├─ agent/openai-provider   → openai (zodResponseFormat)
            │    └─ agent/anthropic-provider → @anthropic-ai/sdk (betaZodTool)
            ├─ agent/stages/*              → agent/schemas/*, prompts/*
            ├─ validation/*                → ajv, ajv-formats
            ├─ storage/*                   → better-sqlite3
            └─ rendering/*                 → (pure)
```

**No circular dependencies.** The dependency flow is strictly top-down:

```
CLI commands → orchestrator → pipeline modules → agent/storage/validation → utils
```

---

## 5. Key Design Decisions

### 5.1 No Agentic Framework

The pipeline is 3 sequential, deterministic LLM calls. There is no tool-use loop, no multi-turn reasoning, no LLM-driven branching. The CLI controls all flow. This means no OpenAI Agents SDK, no LangChain, no CrewAI — just a thin provider abstraction over the raw SDKs (~200 LOC).

### 5.2 Zod as the Single Schema Source

Zod schemas serve as the single source of truth for:
- **Structured output contracts** (passed to both provider SDKs)
- **TypeScript types** (via `z.infer<>`)
- **Runtime validation** (parse stage outputs before post-processing)

The JSON Schema in `schemas/report.v1.json` is for external consumers and the `trend validate` command. Internally, Zod schemas are authoritative.

### 5.3 Per-Stage Caching

Each stage is cached independently by `(evidencePackHash + promptVersion + model + provider + stageId)`. This means:
- Changing the score prompt only invalidates Stage 2 + 3 cache (not Stage 1)
- Switching models invalidates all stages
- Same evidence pack + same prompts + same model = instant cache hit

### 5.4 Structured Output Over Raw JSON Parsing

Both providers use their native structured output mechanisms:
- OpenAI: `zodResponseFormat` + `.parse()` — response is typed at the SDK level
- Anthropic: `betaZodTool` + `toolRunner` — model is forced to emit valid tool input

This eliminates the need for `JSON.parse()` + manual Zod `.parse()` on raw text. The SDKs handle schema enforcement and parsing internally.

### 5.5 Evidence-First Prompting

All stage prompts instruct the model to:
1. First quote relevant item text (verbatim snippets)
2. Then synthesize claims/labels/summaries

This prevents the common failure mode where the model generates a plausible-sounding claim and backfills citation IDs that may not match real content.

### 5.6 Graceful Degradation

| Failure | Recovery |
|---------|----------|
| Feed fetch fails | Skip feed, log warning, continue with remaining |
| Stage 1 fails (after retry) | Abort — exit code 1 |
| Stage 2 fails (after retry) | Output Stage 1 results + errors — exit code 2 |
| Stage 3 fails (after retry) | Output Stage 1+2 results + errors — exit code 2 |
| Validation finds orphaned IDs | Log warnings, include in output, don't abort |
| Score inconsistency | Log warnings, include in output |

---

## 6. Configuration Defaults

```json
{
  "agent": {
    "provider": "openai",
    "model": "gpt-5.2",
    "temperature": 0.2,
    "endpoint": null,
    "maxTokens": null,
    "contextWindowTokens": 400000,
    "reserveTokens": 30000
  },
  "feeds": [
    { "id": "hn",         "url": "https://hnrss.org/frontpage",                           "tier": 1, "weight": 1.0, "enabled": true,  "tags": ["tech", "startups"] },
    { "id": "reddit",     "url": "https://www.reddit.com/r/SaaS+microsaas+startups/.rss", "tier": 1, "weight": 1.0, "enabled": true,  "tags": ["saas", "startups"] },
    { "id": "techcrunch", "url": "https://techcrunch.com/feed/",                           "tier": 1, "weight": 1.0, "enabled": true,  "tags": ["tech", "funding"] },
    { "id": "venturebeat","url": "https://venturebeat.com/feed/",                          "tier": 1, "weight": 1.0, "enabled": true,  "tags": ["tech", "ai"] },
    { "id": "verge",      "url": "https://www.theverge.com/rss/index.xml",                "tier": 2, "weight": 0.6, "enabled": true,  "tags": ["tech"] },
    { "id": "engadget",   "url": "https://www.engadget.com/rss.xml",                      "tier": 2, "weight": 0.6, "enabled": true,  "tags": ["tech"] },
    { "id": "wired",      "url": "https://www.wired.com/feed/rss",                        "tier": 2, "weight": 0.6, "enabled": true,  "tags": ["tech"] },
    { "id": "geekwire",   "url": "https://www.geekwire.com/feed/",                        "tier": 3, "weight": 0.4, "enabled": false, "tags": ["tech", "seattle"] }
  ],
  "thresholds": {
    "minScore": 65,
    "minClusterSize": 2,
    "dedupeThreshold": 0.88
  }
}
```

---

## 7. Build & Runtime

### package.json essentials

```json
{
  "name": "trend-cli",
  "version": "1.0.0",
  "type": "module",
  "bin": { "trend": "./dist/index.js" },
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^12.4.1",
    "rss-parser": "^3.13.0",
    "commander": "^13.1.0",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "zod": "^3.24.2",
    "openai": "^6.1.0",
    "@anthropic-ai/sdk": "^0.39.0",
    "p-limit": "^6.2.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.0.0",
    "vitest": "^3.0.0",
    "tsx": "^4.19.0"
  }
}
```

### tsconfig.json essentials

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## 8. Implementation Order

Recommended build sequence — each layer depends only on completed layers:

| Phase | Modules | Why first |
|-------|---------|-----------|
| **1. Foundation** | `utils/*`, `config/*`, `storage/database.ts` | Everything depends on config, hashing, and DB |
| **2. Data Pipeline** | `fetcher`, `normalizer`, `deduplicator`, `evidence-pack`, `token-estimator` | Core data flow, testable without LLM |
| **3. Storage** | `item-store`, `feed-store`, `run-store`, `cache-store` | Persist pipeline output |
| **4. Provider** | `provider.ts`, `openai-provider.ts`, `anthropic-provider.ts` | LLM abstraction, testable with mocks |
| **5. Schemas** | `agent/schemas/*` | Define contracts before stages |
| **6. Agent Stages** | `extract.ts`, `score.ts`, `generate.ts` | Core AI logic |
| **7. Validation** | `schema-validator`, `evidence-checker`, `score-checker` | Post-processing checks |
| **8. Orchestrator** | `pipeline/orchestrator.ts` | Wire everything together |
| **9. Rendering** | `markdown-renderer.ts`, `json-renderer.ts` | Output formatting |
| **10. CLI** | `commands/*`, `index.ts` | User-facing layer |
| **11. Prompts** | `prompts/*.md` | Iterate on prompt quality |
