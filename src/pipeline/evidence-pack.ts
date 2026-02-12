/**
 * Evidence Pack builder: token-aware filtering, sorting, and hashing.
 *
 * Builds the evidence pack sent to the LLM agent stages, ensuring the
 * total token count fits within the context window budget.
 */

import { sha256 } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { estimateTokens } from './token-estimator.js';
import type { Item } from './normalizer.js';
import type { FeedConfig, Thresholds } from '../config/schema.js';

/** Trimmed item representation sent to the agent. */
export interface EvidenceItem {
  id: string;
  sourceId: string;
  tier: 1 | 2 | 3;
  title: string;
  url: string;
  publishedAt: string;
  text: string;
  author?: string;
  tags?: string[];
}

/** Summary of a feed included in the evidence pack. */
export interface FeedSummary {
  id: string;
  url: string;
  tier: 1 | 2 | 3;
  weight: number;
  itemCount: number;
}

/** Statistics about the evidence pack filtering. */
export interface EvidencePackStats {
  totalItemsCollected: number;
  totalItemsAfterDedup: number;
  totalItemsSentToAgent: number;
  itemsFilteredByTokenLimit: number;
}

/** The evidence pack sent to agent stages. */
export interface EvidencePack {
  metadata: {
    window: string;
    topic: string;
    thresholds: Thresholds;
    maxClusters: number;
    maxIdeasPerCluster: number;
  };
  feeds: FeedSummary[];
  items: EvidenceItem[];
  stats: EvidencePackStats;
  hash: string;
}

/** Options for building an evidence pack. */
export interface BuildEvidencePackOptions {
  items: Item[];
  feeds: FeedConfig[];
  window: string;
  topic: string;
  thresholds: Thresholds;
  maxClusters: number;
  maxIdeasPerCluster: number;
  contextWindowTokens: number;
  reserveTokens: number;
  maxItems: number;
  totalItemsCollected: number;
}

/** Tier weight mapping for sorting priority. */
const TIER_WEIGHTS: Record<number, number> = {
  1: 1.0,
  2: 0.6,
  3: 0.4,
};

/**
 * Compute a recency score for an item (0..1).
 * More recent items get higher scores.
 * Items published at the window boundary get ~0, items published now get ~1.
 */
function computeRecencyScore(publishedAt: string, now: number, windowMs: number): number {
  const pubTime = new Date(publishedAt).getTime();
  if (isNaN(pubTime)) return 0.5; // fallback for unparseable dates
  const age = now - pubTime;
  if (age <= 0) return 1.0;
  if (age >= windowMs) return 0.0;
  return 1.0 - age / windowMs;
}

/**
 * Convert an Item to an EvidenceItem (trimmed representation for the agent).
 */
function toEvidenceItem(item: Item): EvidenceItem {
  const evidence: EvidenceItem = {
    id: item.id,
    sourceId: item.sourceId,
    tier: item.tier,
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    text: item.text,
  };
  if (item.author) evidence.author = item.author;
  if (item.tags && item.tags.length > 0) evidence.tags = item.tags;
  return evidence;
}

/**
 * Build feed summaries with item counts.
 */
function buildFeedSummaries(
  items: EvidenceItem[],
  feeds: FeedConfig[]
): FeedSummary[] {
  const countByFeed = new Map<string, number>();
  for (const item of items) {
    countByFeed.set(item.sourceId, (countByFeed.get(item.sourceId) ?? 0) + 1);
  }

  return feeds
    .filter((f) => f.enabled)
    .map((f) => ({
      id: f.id,
      url: f.url,
      tier: f.tier,
      weight: f.weight,
      itemCount: countByFeed.get(f.id) ?? 0,
    }));
}

/**
 * Compute a deterministic SHA-256 hash of the evidence pack contents.
 * Uses JSON.stringify with sorted keys for determinism.
 */
function computePackHash(pack: Omit<EvidencePack, 'hash'>): string {
  const serialized = JSON.stringify(pack, Object.keys(pack).sort());
  return sha256(serialized);
}

/**
 * Build a token-aware evidence pack from deduplicated items.
 *
 * Algorithm:
 * 1. Estimate avg tokens per item
 * 2. Compute maxItems from context window budget
 * 3. Cap at user-specified maxItems
 * 4. Sort items by tierWeight * recencyScore (descending)
 * 5. Take top N items
 */
export function buildEvidencePack(options: BuildEvidencePackOptions): EvidencePack {
  const {
    items,
    feeds,
    window,
    topic,
    thresholds,
    maxClusters,
    maxIdeasPerCluster,
    contextWindowTokens,
    reserveTokens,
    maxItems,
    totalItemsCollected,
  } = options;

  const now = Date.now();
  // Use a generous window for recency scoring (default to 7d if unable to determine)
  const windowMs = 7 * 24 * 60 * 60 * 1000;

  // Step 1: Estimate average tokens per item
  const totalTokens = items.reduce(
    (sum, item) => sum + estimateTokens(item.text) + estimateTokens(item.title),
    0
  );
  const avgTokensPerItem = items.length > 0 ? totalTokens / items.length : 100;

  // Step 2: Compute max items from token budget
  const availableTokens = contextWindowTokens - reserveTokens;
  const tokenBasedMax = avgTokensPerItem > 0
    ? Math.floor(availableTokens / avgTokensPerItem)
    : maxItems;

  // Step 3: Cap at user maxItems
  const effectiveMax = Math.min(tokenBasedMax, maxItems);

  // Step 4: Sort by tierWeight * recencyScore (descending)
  const scored = items.map((item) => ({
    item,
    score:
      (TIER_WEIGHTS[item.tier] ?? 0.4) *
      item.weight *
      computeRecencyScore(item.publishedAt, now, windowMs),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Step 5: Take top N
  const selected = scored.slice(0, effectiveMax).map((s) => s.item);
  const filtered = items.length - selected.length;

  if (filtered > 0) {
    logger.info(
      `Filtered ${items.length} items -> ${selected.length} sent to agent ` +
        `(${filtered} removed by token limit)`
    );
  }

  // Build evidence items and feed summaries
  const evidenceItems = selected.map(toEvidenceItem);
  const feedSummaries = buildFeedSummaries(evidenceItems, feeds);

  const stats: EvidencePackStats = {
    totalItemsCollected,
    totalItemsAfterDedup: items.length,
    totalItemsSentToAgent: evidenceItems.length,
    itemsFilteredByTokenLimit: filtered,
  };

  const packWithoutHash: Omit<EvidencePack, 'hash'> = {
    metadata: {
      window,
      topic,
      thresholds,
      maxClusters,
      maxIdeasPerCluster,
    },
    feeds: feedSummaries,
    items: evidenceItems,
    stats,
  };

  const hash = computePackHash(packWithoutHash);

  return {
    ...packWithoutHash,
    hash,
  };
}
