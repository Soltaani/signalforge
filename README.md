# SignalForge

Trend-driven opportunity detection engine. SignalForge scans RSS feeds, clusters emerging trends using LLM analysis, scores them by market potential, and generates actionable product opportunities.

## Requirements

- Node.js 22+
- An OpenAI or Anthropic API key

## Installation

```sh
npm install
npm run build
npm link
```

Or run directly without building:

```sh
npx tsx src/index.ts <command>
```

## Quick Start

Set your API key:

```sh
export OPENAI_API_KEY="sk-..."
# or
export ANTHROPIC_API_KEY="sk-ant-..."
```

Run a scan:

```sh
signalforge scan
```

This fetches all enabled RSS feeds, deduplicates items, clusters them with an LLM, scores each cluster, and outputs a Markdown report to stdout.

## Commands

### `scan`

The primary command. Fetches feeds, analyzes trends, and generates a report.

```sh
signalforge scan [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-w, --window <duration>` | `24h` | Time window for RSS items (`24h`, `7d`, `30d`) |
| `-f, --filter <keyword>` | — | Keyword filter for items |
| `--max-items <n>` | `500` | Maximum items to process |
| `--max-clusters <n>` | `12` | Maximum clusters to extract |
| `--max-ideas <n>` | `3` | Maximum ideas per cluster |
| `-p, --provider <name>` | `openai` | LLM provider (`openai` or `anthropic`) |
| `-m, --model <name>` | `gpt-5.2` | LLM model name |
| `--no-agent` | — | Skip LLM analysis (output raw evidence pack) |
| `-o, --output <format>` | `md` | Output format (`md` or `json`) |
| `--out-file <path>` | — | Write output to file instead of stdout |
| `--progress` | `false` | Show progress timings |
| `--semantic-dedup` | `false` | Enable semantic deduplication |

Examples:

```sh
# Scan the last 7 days, output JSON to a file
signalforge scan --window 7d --output json --out-file report.json

# Use Anthropic instead of OpenAI
signalforge scan --provider anthropic --model claude-sonnet-4-5-20250929

# Quick scan without LLM (just fetch + dedupe + evidence pack)
signalforge scan --no-agent

# Filter for AI-related items only
signalforge scan --filter "artificial intelligence"
```

### `report`

Show past run results from the database.

```sh
signalforge report [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--run-id <id>` | — | Show a specific run by ID |
| `--format <fmt>` | `md` | Output format (`md` or `json`) |
| `--last <n>` | `10` | Show last N runs |

```sh
# List recent runs
signalforge report

# View a specific run as JSON
signalforge report --run-id abc123 --format json
```

### `drill`

Deep dive into a specific cluster from a past run.

```sh
signalforge drill <cluster-id> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--run-id <id>` | latest | Run ID to look up |
| `--format <fmt>` | `md` | Output format (`md` or `json`) |

```sh
signalforge drill cluster-ai-agents
signalforge drill cluster-ai-agents --format json
```

### `feeds`

Manage RSS feeds.

```sh
signalforge feeds list              # List all feeds with status
signalforge feeds add <id> <url>    # Add a new feed
signalforge feeds remove <id>       # Remove a feed
signalforge feeds toggle <id>       # Enable/disable a feed
signalforge feeds test <id>         # Test fetch a feed
```

Add feed options:

| Option | Default | Description |
|--------|---------|-------------|
| `-t, --tier <n>` | `2` | Feed tier (1, 2, or 3) |
| `-w, --weight <n>` | `1.0` | Feed weight (0-5) |
| `--tags <tags>` | — | Comma-separated tags |

```sh
# Add a tier-1 feed with tags
signalforge feeds add indiehackers https://www.indiehackers.com/feed.xml -t 1 --tags "startups,indie"

# Disable a feed without removing it
signalforge feeds toggle geekwire

# Verify a feed URL works
signalforge feeds test hn
```

### `validate`

Validate a report JSON file against the schema.

```sh
signalforge validate report.json
```

### `purge`

Clear cached data and/or stored items.

```sh
signalforge purge [options]
```

| Option | Description |
|--------|-------------|
| `--cache` | Clear the agent output cache |
| `--items` | Clear stored RSS items |
| `--older-than <duration>` | Only purge data older than duration (e.g. `30d`) |

```sh
# Clear all cached LLM outputs
signalforge purge --cache

# Remove items older than 30 days
signalforge purge --items --older-than 30d

# Clear everything
signalforge purge --cache --items
```

## Configuration

SignalForge loads configuration from multiple sources (last wins):

1. Built-in defaults
2. `~/.config/signalforge/config.json` (global)
3. `./signalforge.config.json` (project-local)
4. CLI flags

The default config includes 8 feeds (Hacker News, Reddit, TechCrunch, VentureBeat, The Verge, Engadget, Wired, GeekWire) and uses OpenAI as the LLM provider.

### Config structure

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
    {
      "id": "hn",
      "url": "https://hnrss.org/frontpage",
      "tier": 1,
      "weight": 1.0,
      "enabled": true,
      "tags": ["tech", "startups"]
    }
  ],
  "thresholds": {
    "minScore": 65,
    "minClusterSize": 2,
    "dedupeThreshold": 0.88
  }
}
```

### Feed tiers

| Tier | Weight | Description |
|------|--------|-------------|
| 1 | 1.0 | Primary sources (HN, Reddit, TechCrunch) |
| 2 | 0.6 | Secondary sources (The Verge, Engadget, Wired) |
| 3 | 0.4 | Niche/supplementary sources |

Higher-tier feeds get priority when the token budget requires filtering items.

## How It Works

SignalForge runs a 3-stage LLM pipeline on RSS feed data:

1. **Extract** — Clusters related items, identifies pain signals, and extracts key phrases
2. **Score** — Scores each cluster (0-100) across 6 factors: frequency, pain intensity, buyer clarity, monetization signal, build simplicity, novelty
3. **Generate** — Produces actionable product opportunities for qualifying clusters (score >= 65) and picks a "best bet"

Results are cached by a composite key of (evidence pack hash + prompt version + model + provider). Changing feeds, prompts, or models automatically invalidates the cache.

## Data Storage

SignalForge stores data in SQLite at `.signalforge/data.db` in the current working directory. This includes:

- Fetched RSS items
- Feed status and metadata
- Run history
- Cached LLM outputs

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Fatal error (Stage 1 failure, DB error, config error) |
| 2 | Partial success (Stage 2/3 failure, output includes partial results) |

## Development

```sh
# Run in development mode
npm run dev -- scan --window 24h

# Run tests
npm test

# Watch mode
npm run test:watch

# Type check
npx tsc --noEmit
```

## License

MIT
