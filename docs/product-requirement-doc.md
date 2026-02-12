# Trend CLI — Product Requirements Document (PRD)

> **Version:** v1.1 (On-Demand, Agent-First)
> **Type:** Local-first CLI Tool
> **Status:** Draft (updated with review findings)

---

## 1. Overview

Trend CLI is a command-line opportunity detection engine that uses an AI Agent to turn fresh trend content into high-confidence micro-SaaS opportunities.

### What the CLI Does (Deterministic Plumbing)

- Fetch RSS feeds
- Normalize items into a single schema
- Cache and store locally (SQLite)
- Build an "Evidence Pack" (deduped items + metadata)
- Enforce strict validation (schema + evidence coverage)
- Render Markdown and emit JSON

### What the AI Agent Does (Reasoning)

- Cluster items into themes
- Name clusters and summarize them
- Extract repeated pain signals and workaround patterns
- Score clusters 0–100 with factor breakdown and rationale
- Generate micro-SaaS opportunities sized for 1–2 week MVPs
- Select a "Best Bet"
- Self-check: reject generic or ungrounded claims

> **Non-goal:** Not a news reader. No browsing. No "trust me" outputs. Everything must be grounded in the Evidence Pack.

---

## 2. Goals

### Primary

Generate high-confidence micro-SaaS opportunities grounded in real trend signals.

### Secondary

- Reduce research time
- Remove noise and duplicates
- Capture real user language (snippets)
- Produce repeatable, comparable runs

### Non-Goals (v1)

- Scheduling / cron
- Slack / email integrations
- Web dashboard
- Long-term trend memory / acceleration scoring

---

## 3. Target User

Technical solo founder who:

- Builds MVPs in 1–4 weeks
- Prefers CLI workflows
- Wants B2B paid tool ideas
- Values signal over volume

---

## 4. Key Concepts & Definitions

| Term              | Definition                                                                 |
| ----------------- | -------------------------------------------------------------------------- |
| **Item**          | Normalized RSS entry (headline or discussion)                              |
| **Evidence Pack** | Deduped items + tier/weights + constraints given to the agent              |
| **Cluster**       | Theme grouping of items with a label and summary                           |
| **Pain Signal**   | Complaint/urgency/workaround/monetization hint backed by item evidence     |
| **Opportunity**   | Micro-SaaS concept generated from a cluster                               |
| **Window**        | Time range analyzed (e.g., `24h`, `7d`)                                   |

---

## 5. System Overview

### 5.1 Pipeline (v1)

1. Collect RSS entries
2. Normalize into Item schema
3. Filter by window / keyword
4. Deduplicate (exact + optional semantic pre-pass)
5. Build Evidence Pack (with token-aware item filtering)
6. **Agent Stage 1 — Extract:** Cluster items + extract pain signals with evidence
7. **Agent Stage 2 — Score:** Score all clusters comparatively with anchor calibration
8. **Agent Stage 3 — Generate:** Produce opportunities for qualifying clusters + select best bet
9. Validate (JSON schema + evidence coverage)
10. Render Markdown + output JSON

> **Why multi-stage?** A single LLM call doing clustering + scoring + generation + self-critique is cognitively overloaded and produces inconsistent quality. Splitting into focused stages improves reliability, allows per-stage caching, and makes debugging easier. Each stage uses structured output (tool calling) for JSON reliability.

### 5.2 Hard Grounding Rule

The agent **must** treat the Evidence Pack as the only source of truth. Any claim without evidence must be downgraded or marked `"insufficient evidence"`.

### 5.3 Evidence-First Reasoning

The agent must follow an **evidence-first** pattern: retrieve and quote relevant item text *before* synthesizing claims. This prevents hallucination where the model generates a plausible claim and then backfills citation IDs. The prompt structure for each stage should force the model to cite snippets first, then derive conclusions.

### 5.4 No Agentic SDK — Deterministic Pipeline with Thin Provider Abstraction

**Decision:** We do NOT use an agentic framework (OpenAI Agents SDK, LangChain, CrewAI, etc.). We roll a thin provider abstraction over the raw OpenAI and Anthropic SDKs.

**Rationale:** The pipeline is 3 sequential, deterministic LLM calls — not an autonomous agent. There is no tool-use loop, no multi-turn reasoning, no LLM-driven branching, and no memory between runs. The CLI controls the flow; the LLM only processes data at each stage. Agentic SDKs add abstraction, dependencies, and patterns (autonomous planning, tool loops, agent delegation) that don't match this use case.

**Architecture:**

```
┌─────────────────────────────────────────────────┐
│  CLI (commander)                                │
│  Orchestrates: fetch → dedupe → pack → analyze  │
└──────────┬──────────────────────────────────────┘
           │ calls sequentially
           ▼
┌─────────────────────────────────────────────────┐
│  Pipeline Orchestrator                          │
│  Stage 1 (Extract) → validate                  │
│  Stage 2 (Score)   → validate                  │
│  Stage 3 (Generate)→ validate                  │
│  All flow control is deterministic / CLI-driven │
└──────────┬──────────────────────────────────────┘
           │ uses
           ▼
┌─────────────────────────────────────────────────┐
│  Provider Abstraction (~200 LOC)                │
│                                                 │
│  interface LLMProvider {                        │
│    call<T>(params: {                            │
│      systemPrompt: string;                      │
│      userContent: string;                       │
│      outputSchema: ZodType<T>;                  │
│      temperature?: number;                      │
│      maxTokens?: number;                        │
│    }): Promise<T>;                              │
│  }                                              │
│                                                 │
│  Implementations:                               │
│    OpenAIProvider  — zodResponseFormat + .parse()│
│    AnthropicProvider — betaZodTool + toolRunner  │
│                                                 │
│  Shared: Zod schema in, typed parsed output out │
└─────────────────────────────────────────────────┘
```

**What the provider abstraction handles:**
- Accepts a Zod schema + system prompt + user content
- Converts to provider-native structured output (OpenAI `zodResponseFormat` / Anthropic `betaZodTool`)
- Returns typed, parsed output or throws a structured validation error
- Token counting / context window checks before sending
- Retry logic (1 retry with validation errors in prompt)

**What it does NOT handle (and shouldn't):**
- Autonomous tool-calling loops
- Multi-turn conversations or memory
- Agent-to-agent delegation
- LLM-driven control flow decisions

---

## 6. Functional Requirements

### 6.1 Data Collection (CLI)

**Must:**

- Pull from RSS URLs
- Support subreddit RSS
- Collect 1,000+ items per run, with token-aware filtering down to ~500 items before agent analysis (configurable via `--maxItems`, default `500`)

**Per-feed behavior:**

| Setting           | Default                                      |
| ----------------- | -------------------------------------------- |
| Timeout           | 10 s                                         |
| Retry             | 2 (exponential backoff)                      |
| Failure isolation | One feed failing must not crash the whole run |

**Stored fields (minimum):**

`id`, `sourceId`, `tier`, `weight`, `title`, `url`, `publishedAt`, `text`, `hash`, `fetchedAt`

### 6.2 Normalization (CLI)

- Convert disparate RSS fields into the unified Item schema
- `text` should be the best available content (`content` > `summary` > `snippet`)
- Always preserve `url` and `publishedAt` if available

### 6.3 Deduplication (CLI)

**Exact:**

- Same `url` or same `hash` → duplicate
- URL normalization before comparison: lowercase host, strip trailing slashes, remove tracking query params (`utm_*`, `ref`, `source`), normalize `http` → `https`

**Optional semantic (v1-lite):**

- Similarity threshold (default `0.88`) to merge near-duplicates
- Embedding model must be specified in config (not hardcoded)
- Default: off for v1. Enable with `--semantic-dedup`

**Canonical selection rule (tie-breaking order):**

1. Prefer higher Tier (Tier 1 > Tier 2 > Tier 3)
2. Prefer richer text (longer content)
3. Prefer most recent `publishedAt`

### 6.4 Evidence Pack (CLI → Agent)

The CLI constructs an Evidence Pack containing:

- **Run metadata** — window, topic, thresholds
- **Feed weights + tiers + tags**
- **Deduped items** — `id` / `title` / `text` / `url` / `publishedAt` / `source` / `tier` / `weight`
- **Limits** — max clusters, max ideas, token budgets
- **Stats** — `totalItemsCollected`, `totalItemsAfterDedup`, `totalItemsSentToAgent`

> **Requirement:** The Evidence Pack is hashed (`evidencePackHash`) for caching and repeatability.

**Token-aware filtering:** Before sending to the agent, the CLI must estimate the token count of the evidence pack and filter items if it would exceed the model's context window. Filtering priority: sort by `(tier weight * recency)`, take top N that fit within `contextWindowTokens - reserveTokens`. Log how many items were filtered and why.

**Token budget calculation:**

```
maxItemsForContext = (contextWindowTokens - reserveTokens) / avgTokensPerItem
```

Where `reserveTokens` accounts for system prompt + expected output size (default: 30,000 tokens). `avgTokensPerItem` is estimated per run from actual item sizes.

### 6.5 Agent Analysis (Core v1)

The agent must output **strict JSON** via structured output (tool calling / JSON mode). Each stage is a separate LLM call.

#### Stage 1 — Extract (Cluster + Pain Signals)

**Input:** Evidence Pack
**Output:** Clusters with itemIds, pain signals with verbatim snippets

- Group related items into clusters
- Provide cluster label, summary, and included `itemIds`
- Explain clustering briefly via keyphrases
- Extract pain signals and classify into one of:
  `complaint` | `urgency` | `workaround` | `monetization` | `buyer` | `risk`
- Each signal must include `evidence: [itemId...]` and verbatim short snippets from the source items
- **Evidence-first:** The prompt must instruct the model to quote item text before synthesizing labels/summaries

#### Stage 2 — Score (Comparative Scoring)

**Input:** All clusters from Stage 1 (without full item text — just cluster summaries + pain signals)
**Output:** Scores + rankings + factor breakdowns

Score each cluster 0–100 with the following factor breakdown:

| Factor               | Max Points |
| -------------------- | ---------- |
| Frequency            | 20         |
| Pain Intensity       | 20         |
| Buyer Clarity        | 15         |
| Monetization Signal  | 20         |
| Build Simplicity     | 15         |
| Novelty              | 10         |
| **Total**            | **100**    |

Provide 1–2 bullet reasons per factor, grounded in evidence.

**Scoring anchors (include in prompt):**

| Factor    | 0–5 (Low)                | 6–12 (Medium)              | 13+ (High)                      |
| --------- | ------------------------ | -------------------------- | ------------------------------- |
| Frequency | 1–2 items mention this   | 3–7 items across sources   | 8+ items, multiple Tier 1       |
| Pain      | Mild inconvenience       | Clear frustration/complaint| Workarounds or money being spent|
| Buyer     | No clear buyer           | Implied buyer role          | Explicit buyer + budget signals |
| Monetize  | No willingness to pay    | Adjacent paid tools exist   | Direct "I'd pay for X" signals  |
| Build     | Requires deep infra      | Standard web/API stack      | Weekend-buildable               |
| Novelty   | 10+ existing competitors | Few competitors, known gap  | No obvious existing solution    |

**After scoring all clusters, the agent must rank them 1–N and flag any scoring inconsistencies.**

**Confidence field:** Each scored factor includes an optional `confidence: "high" | "medium" | "low"` field. If evidence is thin, the agent must score conservatively and set confidence to `"low"`.

#### Stage 3 — Generate (Opportunities + Best Bet)

**Input:** Top clusters (score >= threshold, default `65`) + relevant item text
**Output:** Opportunities + best bet selection

For qualifying clusters, generate 1–3 opportunities with:

- **ICP** — Ideal Customer Profile
- **JTBD** — Job To Be Done
- **Core workflow steps**
- **MVP scope** — in / out
- **Pricing hypothesis**
- **"Why now"**
- **Differentiation wedge**
- **Validation checklist**
- **Risks / mitigations**

Every field that implies facts must cite evidence via `evidence`.

Pick exactly one best bet opportunity and explain why (with evidence).

#### Agent Self-Check Rules

These rules are enforced structurally via per-stage prompts, not as a single afterthought:

- **Stage 1:** If no pain signals are found for a cluster, it must still be emitted but flagged with an empty `painSignals` array and a warning
- **Stage 2:** If buyer/monetization evidence is weak, the agent must:
  - Score conservatively (cap Buyer Clarity at 5, Monetization at 8)
  - Set `confidence: "low"` on those factors
- **Stage 2:** If a cluster is mostly press coverage without direct user pain, cap Pain Intensity at 8 and Monetization at 5
- **Stage 3:** "Generic ideas" (e.g., "AI-powered dashboard") must be penalized unless pain intensity + evidence is unusually strong. The prompt includes examples of generic vs. specific ideas
- **Stage 3:** If no cluster meets the score threshold, the agent must still select a best bet from whatever is available, with a warning noting the low confidence

### 6.6 Validation (CLI)

The CLI must validate agent output after each stage:

1. **JSON Schema validation** (strict, per-stage sub-schema)
2. **Evidence coverage checks:**
   - All clusters reference valid `itemIds` from the Evidence Pack
   - All pain signals reference >= 1 valid item
   - All opportunities reference >= 1 valid item
   - Orphaned `itemId` references (hallucinated IDs) are flagged as errors
3. **Score consistency checks:**
   - Factor scores do not exceed their `max`
   - Total score equals sum of factor scores
   - Rankings are consistent with scores (no rank inversions)

**If a stage fails validation:**

- Retry that stage once with the validation errors included in the prompt
- If still invalid: extract any valid partial results, emit warnings, continue to next stage with what's available
- If Stage 1 (Extract) fails completely: abort with exit code `1` (no recovery possible)
- If Stage 2 or 3 fails: output partial results + errors, exit code `2`

**Structured output preference:** Use provider-native structured output (OpenAI JSON mode, Anthropic tool use) to minimize raw JSON parsing failures. Define each stage's output as a tool schema.

### 6.7 Reporting (CLI)

#### Markdown Output

Must include:

- Title + generated date/time + window + topic
- Executive summary (3–6 bullets)
- Ranked clusters:
  - Label, score, factor breakdown
  - Representative headlines (with links)
  - Pain signals (with evidence links)
  - Opportunities (structured)
- Best bet recommendation
- Validation plan (next 7 days)
- Feed health (failures / warnings)

#### JSON Output

Must include:

- `metadata` + config snapshot
- `feeds` status
- `clusters` + `opportunities` + `bestBet`
- `warnings` / `errors` (if any)

---

## 7. CLI Interface

### Commands

```
trend scan --window 24h --filter "micro saas"
```
Prints summary to stdout (top clusters + best bet). `--filter` does keyword matching on item titles/text (case-insensitive substring). Omit for unfiltered scan.

```
trend report --window 7d --out trends.md --format both
```
Writes `trends.md` + `trends.json`.

```
trend drill <clusterId> --out drill.md
```
Expands one cluster with full evidence + refined angles. Accepts cluster ID or quoted label (fuzzy-matched).

```
trend feeds
```
Lists feed config + last status.

```
trend validate <report.json>
```
Runs schema + evidence coverage checks on a previously generated report.

```
trend purge
```
Deletes local DB and cache.

### CLI Flags

**Core flags (on commands):**

| Flag                        | Default   | Description                         |
| --------------------------- | --------- | ----------------------------------- |
| `--window <duration>`       | `24h`     | Time range to analyze               |
| `--filter <keywords>`       | —         | Keyword filter on item titles/text  |
| `--out <path>`              | stdout    | Output file path                    |
| `--format <md\|json\|both>` | `md`      | Output format                       |
| `--progress`                | `false`   | Print step timings                  |
| `--maxItems <n>`            | `500`     | Max items sent to agent (after dedup, token-aware) |
| `--maxClusters <n>`         | `12`      | Max clusters to generate            |
| `--maxIdeasPerCluster <n>`  | `3`       | Max ideas per cluster               |

**Agent flags (move most to config file):**

| Flag                        | Default   | Description                    |
| --------------------------- | --------- | ------------------------------ |
| `--agent on\|off`           | `on`      | Enable/disable agent           |
| `--provider <name>`         | —         | Model provider (config default)|
| `--model <name>`            | —         | Model name (config default)    |

> **Design note:** Provider, model, endpoint, temperature, maxTokens, budget, and seed are primarily config-file settings (`trend.config.json` → `agent` section). CLI flags override config but should not be the primary interface for these. This keeps the CLI surface small for the common case.

---

## 8. Default RSS Sources (v1)

| Tier | Source              | Weight | Enabled         |
| ---- | ------------------- | ------ | --------------- |
| 1    | Hacker News RSS     | 1.0    | Yes             |
| 1    | Reddit RSS          | 1.0    | Yes             |
| 1    | TechCrunch RSS      | 1.0    | Yes             |
| 1    | VentureBeat RSS     | 1.0    | Yes             |
| 2    | The Verge RSS       | 0.6    | Yes             |
| 2    | Engadget RSS        | 0.6    | Yes             |
| 2    | WIRED RSS           | 0.6    | Yes             |
| 3    | GeekWire RSS        | 0.4    | No (default)    |

---

## 9. Feed Management (Config)

Must support:

- Enable/disable feeds
- Add custom RSS URLs
- Per-feed weight override
- Tags per feed
- Graceful failure handling + status reporting

**Config file location:** `trend.config.json` in cwd, or `~/.config/trend/config.json`.

---

## 10. Non-Functional Requirements

### Performance

- < 60 seconds for 1,000 items (excluding model calls; enforce `--budget` / `--maxTokens`)
- Print step timings with `--progress`

### Local-First

- SQLite default storage
- All data stored in a configurable directory
- `trend purge` clears all local state

### Determinism / Repeatability

- Cache agent output by (`evidencePackHash`, `promptVersion`, `model`, `provider`)
- Low temperature defaults
- Record model/provider/settings in metadata
- **Prompt versioning:** Prompts are stored as versioned templates. The prompt content hash is included in the cache key so that prompt changes invalidate stale caches automatically

### Reliability

- Partial results allowed
- Clear warnings on feed failures
- Exit codes:

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| `0`  | Success                                            |
| `1`  | Fatal error                                        |
| `2`  | Partial success / validation failed with partial output |

### Privacy

- By default, only the Evidence Pack is sent to the model endpoint
- `--redact` option removes author fields (if present)

---

## 11. Success Criteria (Measurable)

- Generate >= 3 opportunities with score >= 65 per weekly scan
- >= 1 opportunity per month with score >= 75 and >= 5 distinct evidence links
- 100% evidence coverage: all opportunities pass evidence validation (schema enforces this)
- Single run completes in < 3 minutes end-to-end (including model calls, for typical 7-feed scan)
- All agent stages produce valid JSON on first or second attempt >= 90% of the time

---

## 12. Risks & Mitigations

| Risk                         | Mitigation                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| Hallucinated evidence IDs    | Evidence-first prompting + post-hoc validator that resolves all itemId refs         |
| Generic idea soup            | Scoring anchors + examples of generic vs specific in prompt + novelty penalty       |
| Token overflow               | Token-aware filtering + dynamic maxItems + context window estimation before send    |
| Model drift across versions  | Cache key includes prompt hash + model version; warn user if model changed          |
| Score inflation (70-85 bias) | Scoring anchors with concrete examples + forced ranking + comparative prompting     |
| JSON validation failures     | Structured output APIs (tool calling) + per-stage validation + retry with errors    |
| RSS feed flakiness           | Per-feed timeout/retry + `Promise.allSettled` isolation + feed health status        |
| Inconsistent quality later clusters | Multi-stage pipeline prevents context degradation within a single call       |

---

## 13. Scope

### In Scope (v1)

- RSS ingestion, normalization, caching
- Evidence Pack generation
- Agent analysis + strict validation
- Markdown + JSON output
- Drill + validate + purge commands

### Out of Scope (v1)

- Scheduling
- Notifications
- Web UI
- Long-term trend memory

---

## 14. Roadmap

- **v2:** Acceleration scoring + trend memory (week-over-week)
- **v3:** Opportunity lifecycle tracking (validate → build → launch)

---

## Appendix A — Strict JSON Schema (v1)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://trendcli.dev/schemas/report.v1.json",
  "title": "Trend CLI Report v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["metadata", "feeds", "clusters", "bestBet"],
  "properties": {
    "metadata": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "version",
        "generatedAt",
        "window",
        "topic",
        "evidencePackHash",
        "agent"
      ],
      "properties": {
        "version": { "type": "string", "const": "v1" },
        "generatedAt": { "type": "string", "format": "date-time" },
        "window": { "type": "string", "minLength": 1 },
        "topic": { "type": "string" },
        "evidencePackHash": { "type": "string", "minLength": 8 },
        "agent": {
          "type": "object",
          "additionalProperties": false,
          "required": ["enabled", "provider", "model", "temperature"],
          "properties": {
            "enabled": { "type": "boolean" },
            "provider": { "type": "string", "minLength": 1 },
            "model": { "type": "string", "minLength": 1 },
            "temperature": { "type": "number", "minimum": 0, "maximum": 1 },
            "maxTokens": { "type": "integer", "minimum": 1 },
            "budget": { "type": "string" },
            "seed": { "type": "integer", "minimum": 0 }
          }
        },
        "thresholds": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "minScore": { "type": "integer", "minimum": 0, "maximum": 100 },
            "minClusterSize": { "type": "integer", "minimum": 1 },
            "dedupeThreshold": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        "stats": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "totalItemsCollected": { "type": "integer", "minimum": 0 },
            "totalItemsAfterDedup": { "type": "integer", "minimum": 0 },
            "totalItemsSentToAgent": { "type": "integer", "minimum": 0 },
            "itemsFilteredByTokenLimit": { "type": "integer", "minimum": 0 }
          }
        },
        "promptVersion": {
          "type": "string",
          "description": "Hash of the prompt templates used for this run"
        }
      }
    },

    "feeds": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "url", "tier", "weight", "enabled", "status"],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "url": { "type": "string", "minLength": 1 },
          "tier": { "type": "integer", "enum": [1, 2, 3] },
          "weight": { "type": "number", "minimum": 0, "maximum": 5 },
          "enabled": { "type": "boolean" },
          "tags": { "type": "array", "items": { "type": "string" } },
          "status": {
            "type": "object",
            "additionalProperties": false,
            "required": ["ok"],
            "properties": {
              "ok": { "type": "boolean" },
              "fetchedAt": { "type": "string", "format": "date-time" },
              "itemCount": { "type": "integer", "minimum": 0 },
              "error": { "type": "string" }
            }
          }
        }
      }
    },

    "items": {
      "description": "Optional in report output; required in drill output.",
      "type": "array",
      "items": { "$ref": "#/$defs/item" }
    },

    "clusters": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/cluster" }
    },

    "bestBet": {
      "type": "object",
      "additionalProperties": false,
      "required": ["clusterId", "opportunityId", "why"],
      "properties": {
        "clusterId": { "type": "string", "minLength": 1 },
        "opportunityId": { "type": "string", "minLength": 1 },
        "why": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/groundedClaim" }
        }
      }
    },

    "warnings": {
      "type": "array",
      "items": { "$ref": "#/$defs/message" }
    },
    "errors": {
      "type": "array",
      "items": { "$ref": "#/$defs/message" }
    }
  },

  "$defs": {
    "message": {
      "type": "object",
      "additionalProperties": false,
      "required": ["code", "message"],
      "properties": {
        "code": { "type": "string", "minLength": 1 },
        "message": { "type": "string", "minLength": 1 },
        "details": { "type": "object" }
      }
    },

    "item": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "sourceId",
        "tier",
        "weight",
        "title",
        "url",
        "publishedAt",
        "text",
        "hash"
      ],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "sourceId": { "type": "string", "minLength": 1 },
        "tier": { "type": "integer", "enum": [1, 2, 3] },
        "weight": { "type": "number", "minimum": 0, "maximum": 5 },
        "title": { "type": "string", "minLength": 1 },
        "url": { "type": "string", "minLength": 1 },
        "publishedAt": { "type": "string", "format": "date-time" },
        "text": { "type": "string" },
        "author": { "type": "string" },
        "tags": { "type": "array", "items": { "type": "string" } },
        "hash": { "type": "string", "minLength": 8 },
        "fetchedAt": { "type": "string", "format": "date-time" }
      }
    },

    "groundedClaim": {
      "type": "object",
      "additionalProperties": false,
      "required": ["claim", "evidence"],
      "properties": {
        "claim": { "type": "string", "minLength": 1 },
        "evidence": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        },
        "snippets": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },

    "scoreBreakdown": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "frequency",
        "painIntensity",
        "buyerClarity",
        "monetizationSignal",
        "buildSimplicity",
        "novelty"
      ],
      "properties": {
        "frequency": { "$ref": "#/$defs/scoredFactor" },
        "painIntensity": { "$ref": "#/$defs/scoredFactor" },
        "buyerClarity": { "$ref": "#/$defs/scoredFactor" },
        "monetizationSignal": { "$ref": "#/$defs/scoredFactor" },
        "buildSimplicity": { "$ref": "#/$defs/scoredFactor" },
        "novelty": { "$ref": "#/$defs/scoredFactor" }
      }
    },

    "scoredFactor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["score", "max", "reasons"],
      "properties": {
        "score": { "type": "integer", "minimum": 0 },
        "max": { "type": "integer", "minimum": 1 },
        "confidence": {
          "type": "string",
          "enum": ["high", "medium", "low"],
          "description": "Agent's confidence in this score given available evidence"
        },
        "reasons": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/groundedClaim" }
        }
      }
    },

    "painSignal": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "type", "statement", "evidence"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "type": {
          "type": "string",
          "enum": ["complaint", "urgency", "workaround", "monetization", "buyer", "risk"]
        },
        "statement": { "type": "string", "minLength": 1 },
        "evidence": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        },
        "snippets": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },

    "opportunity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "name",
        "icp",
        "jtbd",
        "coreWorkflow",
        "mvpScope",
        "pricingHypothesis",
        "whyNow",
        "differentiation",
        "validationChecklist",
        "risks",
        "evidence"
      ],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "name": { "type": "string", "minLength": 1 },
        "icp": { "$ref": "#/$defs/groundedClaim" },
        "jtbd": { "$ref": "#/$defs/groundedClaim" },
        "coreWorkflow": {
          "type": "array",
          "minItems": 2,
          "items": { "type": "string", "minLength": 1 }
        },
        "mvpScope": {
          "type": "object",
          "additionalProperties": false,
          "required": ["in", "out"],
          "properties": {
            "in": { "type": "array", "minItems": 1, "items": { "type": "string" } },
            "out": { "type": "array", "minItems": 1, "items": { "type": "string" } }
          }
        },
        "pricingHypothesis": { "$ref": "#/$defs/groundedClaim" },
        "whyNow": { "$ref": "#/$defs/groundedClaim" },
        "differentiation": { "$ref": "#/$defs/groundedClaim" },
        "validationChecklist": {
          "type": "array",
          "minItems": 3,
          "items": { "type": "string", "minLength": 1 }
        },
        "risks": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["risk", "mitigation", "evidence"],
            "properties": {
              "risk": { "type": "string", "minLength": 1 },
              "mitigation": { "type": "string", "minLength": 1 },
              "evidence": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string", "minLength": 1 }
              }
            }
          }
        },
        "evidence": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        }
      }
    },

    "cluster": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "label",
        "summary",
        "itemIds",
        "weightedFrequency",
        "score",
        "scoreBreakdown",
        "whyNow",
        "representativeItems",
        "painSignals",
        "opportunities"
      ],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "label": { "type": "string", "minLength": 1 },
        "summary": { "$ref": "#/$defs/groundedClaim" },
        "keyphrases": {
          "type": "array",
          "items": { "type": "string" }
        },
        "itemIds": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        },
        "weightedFrequency": { "type": "number", "minimum": 0 },
        "score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "scoreBreakdown": { "$ref": "#/$defs/scoreBreakdown" },
        "whyNow": { "$ref": "#/$defs/groundedClaim" },
        "representativeItems": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        },
        "painSignals": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/painSignal" }
        },
        "opportunities": {
          "type": "array",
          "items": { "$ref": "#/$defs/opportunity" }
        }
      }
    }
  }
}
```

---

## Appendix B — Implementation Notes

> Included so the PRD is directly actionable. Library versions and API patterns confirmed via documentation.

### Dependencies

| Package | Version | Purpose |
| ------- | ------- | ------- |
| `better-sqlite3` | ^12.x | SQLite storage (synchronous API, WAL mode) |
| `rss-parser` | ^3.x | RSS/Atom feed parsing |
| `commander` | ^13.x | CLI framework (subcommands, options, arguments) |
| `ajv` | ^8.x (`ajv/dist/2020`) | JSON Schema 2020-12 validation |
| `ajv-formats` | ^3.x | Format validation (date-time, uri, etc.) |
| `zod` | ^3.x | Runtime schema definition (shared by both provider SDKs) |
| `openai` | ^6.x | OpenAI provider (structured output via `zodResponseFormat`) |
| `@anthropic-ai/sdk` | latest | Anthropic provider (structured output via `betaZodTool`) |
| `p-limit` | ^6.x | Concurrency control for RSS fetching |
| `typescript` | ^5.8+ | Language |

### Provider Abstraction (see 5.4 for architecture)

Both provider SDKs use **Zod schemas** for structured output. The provider abstraction (see Section 5.4) wraps both behind a single interface: Zod schema in, typed parsed output out. Switching providers is a config change, not a code change.

**OpenAI implementation — `zodResponseFormat` + `.parse()`:**

```typescript
import { zodResponseFormat } from 'openai/helpers/zod';

// Inside OpenAIProvider.call<T>():
const completion = await this.client.chat.completions.parse({
  model: this.config.model,          // 'gpt-5.2'
  messages: [
    { role: 'system', content: params.systemPrompt },
    { role: 'user', content: params.userContent },
  ],
  response_format: zodResponseFormat(params.outputSchema, 'stage_output'),
  temperature: params.temperature ?? 0.2,
});
return completion.choices[0]?.message.parsed as T;
```

**Anthropic implementation — `betaZodTool` + tool runner:**

```typescript
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';

// Inside AnthropicProvider.call<T>():
const tool = betaZodTool({
  name: 'submit_output',
  description: 'Submit structured analysis output',
  inputSchema: params.outputSchema,   // same Zod schema
  run: async (input) => JSON.stringify(input),
});
const result = await this.client.beta.messages.toolRunner({
  model: this.config.model,           // 'claude-sonnet-4-5-20250929'
  max_tokens: params.maxTokens ?? 8192,
  messages: [
    { role: 'user', content: `${params.systemPrompt}\n\n${params.userContent}` },
  ],
  tools: [tool],
});
// extract parsed tool input from result
```

**Pipeline orchestrator usage (provider-agnostic):**

```typescript
// provider is OpenAIProvider or AnthropicProvider — same interface
const clusters = await provider.call({
  systemPrompt: extractPrompt,
  userContent: JSON.stringify(evidencePack),
  outputSchema: ClusterOutputSchema,   // Zod schema
});
// clusters is typed ClusterOutput — no JSON.parse, no casting
```

### Available Models

| Provider | Model | Context Window | Max Output | Structured Output | Notes |
| -------- | ----- | -------------- | ---------- | ----------------- | ----- |
| OpenAI | `gpt-5.2` | 400K | 128K | `zodResponseFormat` | Default flagship. Best for Stage 1 (Extract) and Stage 3 (Generate) |
| OpenAI | `gpt-5-mini` | 400K | 128K | `zodResponseFormat` | Cheaper/faster, good for Stage 2 (scoring) |
| Anthropic | `claude-sonnet-4-5-20250929` | 200K | 8K | `betaZodTool` | Alternative provider, solid structured output |
| Anthropic | `claude-haiku-4-5-20251001` | 200K | 8K | `betaZodTool` | Fast/cheap, use for scoring stage |

> **Note:** GPT-4o, GPT-4.1, and o4-mini are [retired as of Feb 13, 2026](https://openai.com/index/retiring-gpt-4o-and-older-models/). Do not use them. GPT-5.2 is the current default. The 400K context window means token-aware filtering is less critical with OpenAI but still important for cost control.

### SQLite Usage

```typescript
import Database from 'better-sqlite3';

const db = new Database('trend.db');
db.pragma('journal_mode = WAL');       // concurrent read performance
db.pragma('foreign_keys = ON');

// Transactions for batch inserts
const insertItem = db.prepare(`INSERT INTO items (...) VALUES (...)`);
const insertMany = db.transaction((items) => {
  for (const item of items) insertItem.run(item);
});
```

**Tables:** `items`, `feeds`, `runs`, `cache`
- `items`: id, sourceId, tier, weight, title, url, publishedAt, text, author, hash, fetchedAt, tags (JSON), dedupedInto (nullable FK)
- `feeds`: id, url, tier, weight, enabled, tags (JSON), lastFetchedAt, lastStatus (JSON)
- `runs`: runId, window, topic, evidencePackHash, status, createdAt
- `cache`: cacheKey (hash of evidencePackHash + promptVersion + model + provider), reportJson, createdAt

### Ajv Validation Setup

```typescript
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

const validate = ajv.compile(reportSchema);
if (!validate(data)) {
  // validate.errors contains detailed error objects with keyword, params, path
  for (const err of validate.errors) {
    console.error(`${err.instancePath}: ${err.message}`);
  }
}
```

### CLI Structure

```typescript
import { Command } from 'commander';

const program = new Command();
program.name('trend').description('Trend-driven opportunity detection engine').version('1.0.0');

program.command('scan')
  .description('Quick scan: top clusters + best bet to stdout')
  .option('--window <duration>', 'time range', '24h')
  .option('--filter <keywords>', 'keyword filter on items')
  .option('--maxItems <n>', 'max items to agent', '500')
  .action(async (options) => { /* ... */ });

program.command('report')
  .description('Full report to file')
  .option('--window <duration>', 'time range', '7d')
  .option('--out <path>', 'output path')
  .option('--format <type>', 'md|json|both', 'md')
  .action(async (options) => { /* ... */ });

program.command('drill')
  .description('Deep-dive into a cluster')
  .argument('<clusterId>', 'cluster ID or label')
  .option('--out <path>', 'output path')
  .action(async (clusterId, options) => { /* ... */ });
```

### Config Schema

Config file (`trend.config.json` or `~/.config/trend/config.json`) must define:

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
    { "id": "hn", "url": "https://hnrss.org/frontpage", "tier": 1, "weight": 1.0, "enabled": true, "tags": ["tech"] }
  ],
  "thresholds": {
    "minScore": 65,
    "minClusterSize": 2,
    "dedupeThreshold": 0.88
  }
}
```

### Prompt Versioning

Prompt templates are stored as versioned files (e.g., `prompts/extract-v1.md`). The SHA-256 hash of all prompt files used in a run is recorded as `promptVersion` in metadata and included in cache keys. Changing a prompt automatically invalidates cached results.
