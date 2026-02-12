/**
 * Pipeline Orchestrator: runs the full 14-step pipeline.
 *
 * 1. Fetch RSS  2. Normalize  3. Persist to DB  4. Deduplicate
 * 5. Build evidence pack  6. Check cache  7. Stage 1 Extract
 * 8. Stage 2 Score  9. Stage 3 Generate  10. Schema validate
 * 11. Evidence check  12. Score check  13. Cache results  14. Return result
 *
 * Graceful degradation:
 * - Feed failures = continue with remaining feeds
 * - Stage 1 failure = exit 1 (fatal)
 * - Stage 2/3 failure = exit 2 (partial results)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAllFeeds } from './fetcher.js';
import type { FetchResult } from './fetcher.js';
import { normalizeItems } from './normalizer.js';
import type { Item } from './normalizer.js';
import { deduplicate } from './deduplicator.js';
import { buildEvidencePack } from './evidence-pack.js';
import type { EvidencePack } from './evidence-pack.js';

import { createDatabase, closeDatabase } from '../storage/database.js';
import { ItemStore } from '../storage/item-store.js';
import type { ItemRow } from '../storage/item-store.js';
import { FeedStore } from '../storage/feed-store.js';
import { RunStore } from '../storage/run-store.js';
import { CacheStore, buildCacheKey } from '../storage/cache-store.js';

import type { LLMProvider } from '../agent/provider.js';
import { runExtractStage } from '../agent/stages/extract.js';
import type { ExtractOutput } from '../agent/schemas/extract-schema.js';
import { runScoreStage } from '../agent/stages/score.js';
import type { ScoreOutput } from '../agent/schemas/score-schema.js';
import { runGenerateStage } from '../agent/stages/generate.js';
import type { GenerateOutput } from '../agent/schemas/generate-schema.js';
import type { ScoredCluster } from '../agent/stages/generate.js';

import { validateReport, validateStageOutput } from '../validation/schema-validator.js';
import { checkEvidenceCoverage } from '../validation/evidence-checker.js';
import { checkScoreConsistency } from '../validation/score-checker.js';
import type { ScoreBreakdown } from '../validation/score-checker.js';

import { sha256 } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

import type { SignalForgeConfig, FeedConfig } from '../config/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../../prompts');

// ─── Public types ────────────────────────────────────────────

export interface Message {
  stage: string;
  message: string;
}

export interface PipelineOptions {
  window: string;
  filter?: string;
  maxItems: number;
  maxClusters: number;
  maxIdeasPerCluster: number;
  agentEnabled: boolean;
  provider: LLMProvider;
  config: SignalForgeConfig;
  dbPath?: string;
}

export interface PipelineResult {
  report: Report;
  warnings: Message[];
  errors: Message[];
  exitCode: 0 | 1 | 2;
}

export interface Report {
  metadata: ReportMetadata;
  feeds: FeedStatus[];
  clusters: ReportCluster[];
  scoredClusters: ScoredReportCluster[];
  opportunities: ReportOpportunity[];
  bestBet?: ReportBestBet;
  evidencePack: EvidencePack;
}

export interface ReportMetadata {
  runId: string;
  window: string;
  topic: string;
  promptVersion: string;
  model: string;
  provider: string;
  generatedAt: string;
  evidencePackHash: string;
}

export interface FeedStatus {
  feedId: string;
  ok: boolean;
  itemCount: number;
  error?: string;
}

export interface ReportCluster {
  id: string;
  label: string;
  summary: { claim: string; evidence: string[]; snippets?: string[] };
  keyphrases: string[];
  itemIds: string[];
  painSignals: Array<{
    id: string;
    type: string;
    statement: string;
    evidence: string[];
    snippets?: string[];
  }>;
}

export interface ScoredReportCluster {
  clusterId: string;
  score: number;
  rank: number;
  scoreBreakdown: ScoreBreakdown;
  whyNow: { claim: string; evidence: string[]; snippets?: string[] };
}

export interface ReportOpportunity {
  id: string;
  clusterId: string;
  title: string;
  description: string;
  targetAudience: string;
  painPoint: string;
  monetizationModel: string;
  mvpScope: string;
  validationSteps: string[];
  evidence: string[];
}

export interface ReportBestBet {
  clusterId: string;
  opportunityId: string;
  why: Array<{ claim: string; evidence: string[]; snippets?: string[] }>;
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Compute a combined SHA-256 of all prompt files in the prompts/ directory.
 */
function computePromptVersion(): string {
  try {
    const files = readdirSync(PROMPTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort();
    const contents = files.map((f) => readFileSync(join(PROMPTS_DIR, f), 'utf-8'));
    return sha256(contents.join('\n'));
  } catch {
    return sha256('no-prompts');
  }
}

/**
 * Convert Item to ItemRow for database persistence.
 */
function itemToRow(item: Item): ItemRow {
  return {
    id: item.id,
    sourceId: item.sourceId,
    tier: item.tier,
    weight: item.weight,
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    text: item.text,
    author: item.author ?? null,
    hash: item.hash,
    fetchedAt: item.fetchedAt,
    tags: item.tags ?? [],
    dedupedInto: null,
  };
}

/**
 * Merge extract output clusters with score output to produce ScoredCluster[]
 * suitable for the generate stage.
 */
function buildScoredClusters(
  extractOutput: ExtractOutput,
  scoreOutput: ScoreOutput,
  minScore: number,
): ScoredCluster[] {
  const scoreMap = new Map(
    scoreOutput.scoredClusters.map((sc) => [sc.clusterId, sc]),
  );

  const result: ScoredCluster[] = [];
  for (const cluster of extractOutput.clusters) {
    const scored = scoreMap.get(cluster.id);
    if (!scored || scored.score < minScore) continue;

    result.push({
      id: cluster.id,
      label: cluster.label,
      score: scored.score,
      rank: scored.rank,
      scoreBreakdown: scored.scoreBreakdown as unknown as Record<string, { score: number; max: number }>,
      summary: cluster.summary,
      keyphrases: cluster.keyphrases,
      painSignals: cluster.painSignals.map((ps) => ({
        id: ps.id,
        type: ps.type,
        statement: ps.statement,
        evidence: ps.evidence,
        snippets: ps.snippets,
      })),
    });
  }

  return result;
}

// ─── Main pipeline ───────────────────────────────────────────

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const {
    window,
    filter,
    maxItems,
    maxClusters,
    maxIdeasPerCluster,
    agentEnabled,
    provider,
    config,
    dbPath,
  } = options;

  const runId = randomUUID();
  const warnings: Message[] = [];
  const errors: Message[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  const promptVersion = computePromptVersion();
  const topic = filter ?? '';

  // Initialize report with empty state
  let extractOutput: ExtractOutput | null = null;
  let scoreOutput: ScoreOutput | null = null;
  let generateOutput: GenerateOutput | null = null;
  let evidencePack: EvidencePack | null = null;
  const feedStatuses: FeedStatus[] = [];

  // Open database
  const resolvedDbPath = dbPath ?? join(process.cwd(), '.signalforge', 'data.db');
  const db = createDatabase(resolvedDbPath);
  const itemStore = new ItemStore(db);
  const feedStore = new FeedStore(db);
  const runStore = new RunStore(db);
  const cacheStore = new CacheStore(db);

  const endPipeline = logger.time('Pipeline');

  try {
    // ── Step 1: Fetch RSS feeds ──────────────────────────────
    const endFetch = logger.time('Step 1: Fetch RSS');
    const fetchResults: FetchResult[] = await fetchAllFeeds(config.feeds, window);
    endFetch();

    // Record feed statuses and update feed store
    let totalItemsCollected = 0;
    for (const result of fetchResults) {
      feedStatuses.push({
        feedId: result.feedId,
        ok: result.ok,
        itemCount: result.items.length,
        error: result.error,
      });

      if (!result.ok) {
        warnings.push({
          stage: 'fetch',
          message: `Feed "${result.feedId}" failed: ${result.error}`,
        });
      }

      totalItemsCollected += result.items.length;

      // Update feed status in DB
      const feedConfig = config.feeds.find((f) => f.id === result.feedId);
      if (feedConfig) {
        feedStore.upsert({
          id: feedConfig.id,
          url: feedConfig.url,
          tier: feedConfig.tier,
          weight: feedConfig.weight,
          enabled: feedConfig.enabled,
          tags: feedConfig.tags,
          lastFetchedAt: result.fetchedAt,
          lastStatus: { ok: result.ok, itemCount: result.items.length, error: result.error },
        });
      }
    }

    const successfulResults = fetchResults.filter((r) => r.ok);
    if (successfulResults.length === 0) {
      errors.push({ stage: 'fetch', message: 'All feeds failed' });
      exitCode = 1;
      return buildResult(runId, window, topic, promptVersion, provider, feedStatuses, null, exitCode, warnings, errors);
    }

    logger.info(`Fetched ${totalItemsCollected} items from ${successfulResults.length}/${fetchResults.length} feeds`);

    // ── Step 2: Normalize ────────────────────────────────────
    const endNormalize = logger.time('Step 2: Normalize');
    const allItems: Item[] = [];
    for (const result of successfulResults) {
      const feedConfig = config.feeds.find((f) => f.id === result.feedId);
      if (feedConfig) {
        const normalized = normalizeItems(result.items, feedConfig);
        allItems.push(...normalized);
      }
    }
    endNormalize();

    logger.info(`Normalized ${allItems.length} items`);

    // ── Step 3: Persist to DB ────────────────────────────────
    const endPersist = logger.time('Step 3: Persist to DB');
    try {
      const rows = allItems.map(itemToRow);
      itemStore.insertMany(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ stage: 'persist', message: `Database error: ${msg}` });
      exitCode = 1;
      return buildResult(runId, window, topic, promptVersion, provider, feedStatuses, null, exitCode, warnings, errors);
    }
    endPersist();

    // ── Step 4: Deduplicate ──────────────────────────────────
    const endDedup = logger.time('Step 4: Deduplicate');
    const deduplicationResult = deduplicate(allItems, {
      semanticDedup: false,
      threshold: config.thresholds.dedupeThreshold,
    });
    endDedup();

    // Mark deduped items in the store
    for (const entry of deduplicationResult.mergeLog) {
      for (const dupId of entry.duplicateIds) {
        itemStore.markDeduped(dupId, entry.canonical);
      }
    }

    const dedupedItems = deduplicationResult.items;
    logger.info(`Deduplicated: ${allItems.length} -> ${dedupedItems.length} items`);

    // ── Step 5: Build evidence pack ──────────────────────────
    const endEvidencePack = logger.time('Step 5: Build evidence pack');
    evidencePack = buildEvidencePack({
      items: dedupedItems,
      feeds: config.feeds,
      window,
      topic,
      thresholds: config.thresholds,
      maxClusters,
      maxIdeasPerCluster,
      contextWindowTokens: config.agent.contextWindowTokens,
      reserveTokens: config.agent.reserveTokens,
      maxItems,
      totalItemsCollected,
    });
    endEvidencePack();

    // Create run record
    runStore.create({
      runId,
      window,
      topic,
      evidencePackHash: evidencePack.hash,
    });

    // If agent is not enabled, return with evidence pack only
    if (!agentEnabled) {
      logger.info('Agent disabled — returning evidence pack without analysis');
      runStore.updateStatus(runId, 'completed');
      return buildResult(runId, window, topic, promptVersion, provider, feedStatuses, evidencePack, 0, warnings, errors);
    }

    // ── Step 6: Check cache ──────────────────────────────────
    const endCacheCheck = logger.time('Step 6: Check cache');

    const extractCacheKey = buildCacheKey(evidencePack.hash, promptVersion, provider.model, provider.name, 'extract');
    const scoreCacheKey = buildCacheKey(evidencePack.hash, promptVersion, provider.model, provider.name, 'score');
    const generateCacheKey = buildCacheKey(evidencePack.hash, promptVersion, provider.model, provider.name, 'generate');

    const cachedExtract = cacheStore.get(extractCacheKey) as ExtractOutput | null;
    const cachedScore = cacheStore.get(scoreCacheKey) as ScoreOutput | null;
    const cachedGenerate = cacheStore.get(generateCacheKey) as GenerateOutput | null;

    if (cachedExtract && cachedScore && cachedGenerate) {
      logger.info('Full cache hit — skipping all agent stages');
      extractOutput = cachedExtract;
      scoreOutput = cachedScore;
      generateOutput = cachedGenerate;
      endCacheCheck();
    } else {
      endCacheCheck();

      // ── Step 7: Stage 1 Extract ────────────────────────────
      if (cachedExtract) {
        logger.info('Cache hit for Stage 1 Extract');
        extractOutput = cachedExtract;
      } else {
        const endExtract = logger.time('Step 7: Stage 1 Extract');
        try {
          extractOutput = await runExtractStage(provider, {
            evidencePack,
            maxClusters,
          });
          endExtract();

          // Validate extract stage output
          const extractValidation = validateStageOutput('extract', extractOutput);
          if (!extractValidation.ok) {
            warnings.push({
              stage: 'extract-validation',
              message: `Extract validation warnings: ${extractValidation.errors.join('; ')}`,
            });
          }
        } catch (err) {
          endExtract();
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ stage: 'extract', message: `Stage 1 Extract failed: ${msg}` });
          exitCode = 1;
          runStore.updateStatus(runId, 'failed');
          return buildResult(runId, window, topic, promptVersion, provider, feedStatuses, evidencePack, exitCode, warnings, errors);
        }
      }

      // ── Step 8: Stage 2 Score ──────────────────────────────
      if (cachedScore) {
        logger.info('Cache hit for Stage 2 Score');
        scoreOutput = cachedScore;
      } else {
        const endScore = logger.time('Step 8: Stage 2 Score');
        try {
          scoreOutput = await runScoreStage(provider, {
            clusters: extractOutput!.clusters,
          });
          endScore();

          // Validate score stage output
          const scoreValidation = validateStageOutput('score', scoreOutput);
          if (!scoreValidation.ok) {
            warnings.push({
              stage: 'score-validation',
              message: `Score validation warnings: ${scoreValidation.errors.join('; ')}`,
            });
          }
        } catch (err) {
          endScore();
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ stage: 'score', message: `Stage 2 Score failed: ${msg}` });
          exitCode = 2;
          // Continue with partial results — extract output is available
        }
      }

      // ── Step 9: Stage 3 Generate ───────────────────────────
      if (scoreOutput && !cachedGenerate) {
        const minScore = config.thresholds.minScore;
        const qualifyingClusters = buildScoredClusters(extractOutput!, scoreOutput, minScore);

        if (qualifyingClusters.length > 0) {
          const endGenerate = logger.time('Step 9: Stage 3 Generate');
          try {
            generateOutput = await runGenerateStage(provider, {
              qualifyingClusters,
              items: evidencePack.items,
              maxIdeasPerCluster,
            });
            endGenerate();

            // Validate generate stage output
            const generateValidation = validateStageOutput('generate', generateOutput);
            if (!generateValidation.ok) {
              warnings.push({
                stage: 'generate-validation',
                message: `Generate validation warnings: ${generateValidation.errors.join('; ')}`,
              });
            }
          } catch (err) {
            endGenerate();
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({ stage: 'generate', message: `Stage 3 Generate failed: ${msg}` });
            exitCode = 2;
            // Continue with partial results — extract + score outputs are available
          }
        } else {
          warnings.push({
            stage: 'generate',
            message: `No clusters met the minimum score threshold (${minScore})`,
          });
        }
      } else if (cachedGenerate) {
        logger.info('Cache hit for Stage 3 Generate');
        generateOutput = cachedGenerate;
      }
    }

    // ── Step 10: Schema validation ───────────────────────────
    const endSchemaValidation = logger.time('Step 10: Schema validation');
    if (generateOutput) {
      const reportData = assembleReportData(
        extractOutput!,
        scoreOutput!,
        generateOutput,
      );
      const schemaResult = validateReport(reportData);
      if (!schemaResult.ok) {
        for (const err of schemaResult.errors) {
          warnings.push({ stage: 'schema-validation', message: err });
        }
      }
    }
    endSchemaValidation();

    // ── Step 11: Evidence coverage check ─────────────────────
    const endEvidenceCheck = logger.time('Step 11: Evidence coverage check');
    if (extractOutput && evidencePack) {
      const evidenceReport = buildEvidenceCheckReport(extractOutput, generateOutput);
      const evidenceResult = checkEvidenceCoverage(evidenceReport, evidencePack);
      if (!evidenceResult.ok) {
        for (const err of evidenceResult.errors) {
          warnings.push({ stage: 'evidence-coverage', message: err });
        }
      }
    }
    endEvidenceCheck();

    // ── Step 12: Score consistency check ──────────────────────
    const endScoreCheck = logger.time('Step 12: Score consistency check');
    if (scoreOutput) {
      const scoreClusters = scoreOutput.scoredClusters.map((sc) => ({
        id: sc.clusterId,
        score: sc.score,
        rank: sc.rank,
        scoreBreakdown: sc.scoreBreakdown as ScoreBreakdown,
      }));
      const scoreResult = checkScoreConsistency(scoreClusters);
      if (!scoreResult.ok) {
        for (const err of scoreResult.errors) {
          warnings.push({ stage: 'score-consistency', message: err });
        }
      }
    }
    endScoreCheck();

    // ── Step 13: Cache valid results ─────────────────────────
    const endCache = logger.time('Step 13: Cache results');
    if (extractOutput && !cachedExtract) {
      cacheStore.set(extractCacheKey, 'extract', extractOutput);
    }
    if (scoreOutput && !cachedScore) {
      cacheStore.set(scoreCacheKey, 'score', scoreOutput);
    }
    if (generateOutput && !cachedGenerate) {
      cacheStore.set(generateCacheKey, 'generate', generateOutput);
    }
    endCache();

    // ── Step 14: Return result ───────────────────────────────
    runStore.updateStatus(runId, exitCode === 0 ? 'completed' : 'partial');

    const report = buildReport(
      runId, window, topic, promptVersion, provider,
      feedStatuses, evidencePack, extractOutput, scoreOutput, generateOutput,
    );

    endPipeline();
    return { report, warnings, errors, exitCode };

  } finally {
    closeDatabase(db);
  }
}

// ─── Report assembly helpers ─────────────────────────────────

function buildResult(
  runId: string,
  window: string,
  topic: string,
  promptVersion: string,
  provider: LLMProvider,
  feedStatuses: FeedStatus[],
  evidencePack: EvidencePack | null,
  exitCode: 0 | 1 | 2,
  warnings: Message[],
  errors: Message[],
): PipelineResult {
  const report = buildReport(
    runId, window, topic, promptVersion, provider,
    feedStatuses, evidencePack, null, null, null,
  );
  return { report, warnings, errors, exitCode };
}

function buildReport(
  runId: string,
  window: string,
  topic: string,
  promptVersion: string,
  provider: LLMProvider,
  feedStatuses: FeedStatus[],
  evidencePack: EvidencePack | null,
  extractOutput: ExtractOutput | null,
  scoreOutput: ScoreOutput | null,
  generateOutput: GenerateOutput | null,
): Report {
  const metadata: ReportMetadata = {
    runId,
    window,
    topic,
    promptVersion,
    model: provider.model,
    provider: provider.name,
    generatedAt: new Date().toISOString(),
    evidencePackHash: evidencePack?.hash ?? '',
  };

  const clusters: ReportCluster[] = extractOutput
    ? extractOutput.clusters.map((c) => ({
        id: c.id,
        label: c.label,
        summary: c.summary,
        keyphrases: c.keyphrases,
        itemIds: c.itemIds,
        painSignals: c.painSignals.map((ps) => ({
          id: ps.id,
          type: ps.type,
          statement: ps.statement,
          evidence: ps.evidence,
          snippets: ps.snippets,
        })),
      }))
    : [];

  const scoredClusters: ScoredReportCluster[] = scoreOutput
    ? scoreOutput.scoredClusters.map((sc) => ({
        clusterId: sc.clusterId,
        score: sc.score,
        rank: sc.rank,
        scoreBreakdown: sc.scoreBreakdown as ScoreBreakdown,
        whyNow: sc.whyNow,
      }))
    : [];

  const opportunities: ReportOpportunity[] = generateOutput
    ? generateOutput.opportunities.map((op) => ({
        id: op.id,
        clusterId: op.clusterId,
        title: op.title,
        description: op.description,
        targetAudience: op.targetAudience,
        painPoint: op.painPoint,
        monetizationModel: op.monetizationModel,
        mvpScope: op.mvpScope,
        validationSteps: op.validationSteps,
        evidence: op.evidence,
      }))
    : [];

  const bestBet: ReportBestBet | undefined = generateOutput
    ? {
        clusterId: generateOutput.bestBet.clusterId,
        opportunityId: generateOutput.bestBet.opportunityId,
        why: generateOutput.bestBet.why,
      }
    : undefined;

  const emptyEvidencePack: EvidencePack = {
    metadata: {
      window,
      topic,
      thresholds: { minScore: 65, minClusterSize: 2, dedupeThreshold: 0.88 },
      maxClusters: 12,
      maxIdeasPerCluster: 3,
    },
    feeds: [],
    items: [],
    stats: {
      totalItemsCollected: 0,
      totalItemsAfterDedup: 0,
      totalItemsSentToAgent: 0,
      itemsFilteredByTokenLimit: 0,
    },
    hash: '',
  };

  return {
    metadata,
    feeds: feedStatuses,
    clusters,
    scoredClusters,
    opportunities,
    bestBet,
    evidencePack: evidencePack ?? emptyEvidencePack,
  };
}

/**
 * Assemble a minimal report data structure for JSON Schema validation.
 */
function assembleReportData(
  extractOutput: ExtractOutput,
  scoreOutput: ScoreOutput,
  generateOutput: GenerateOutput,
): unknown {
  return {
    clusters: extractOutput.clusters,
    scoredClusters: scoreOutput.scoredClusters,
    opportunities: generateOutput.opportunities,
    bestBet: generateOutput.bestBet,
  };
}

/**
 * Build a report-like object suitable for the evidence checker.
 */
function buildEvidenceCheckReport(
  extractOutput: ExtractOutput,
  generateOutput: GenerateOutput | null,
): Parameters<typeof checkEvidenceCoverage>[0] {
  const clusters = extractOutput.clusters.map((c) => ({
    id: c.id,
    itemIds: c.itemIds,
    painSignals: c.painSignals.map((ps) => ({
      id: ps.id,
      evidence: ps.evidence,
    })),
  }));

  const opportunities = generateOutput
    ? generateOutput.opportunities.map((op) => ({
        id: op.id,
        clusterId: op.clusterId,
        evidence: op.evidence,
      }))
    : [];

  const bestBet = generateOutput
    ? {
        clusterId: generateOutput.bestBet.clusterId,
        opportunityId: generateOutput.bestBet.opportunityId,
      }
    : { clusterId: '', opportunityId: '' };

  return { clusters, opportunities, bestBet };
}
