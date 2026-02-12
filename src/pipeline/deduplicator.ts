/**
 * Deduplication module: exact dedup by normalized URL or hash,
 * with optional semantic dedup support.
 *
 * Canonical selection tiebreak: higher tier > longer text > more recent publishedAt.
 */

import { normalizeUrl } from '../utils/url.js';
import { logger } from '../utils/logger.js';
import type { Item } from './normalizer.js';

export interface MergeLogEntry {
  canonical: string;
  duplicateIds: string[];
}

export interface DeduplicationResult {
  items: Item[];
  duplicatesRemoved: number;
  mergeLog: MergeLogEntry[];
}

export interface DeduplicateOptions {
  semanticDedup?: boolean;
  threshold?: number;
}

const DEFAULT_THRESHOLD = 0.88;

/**
 * Compare two items for canonical selection.
 * Returns the preferred item (the "canonical" one).
 *
 * Tiebreak rules:
 *  1. Higher tier (lower number = higher tier, so tier 1 > tier 2)
 *  2. Longer text
 *  3. More recent publishedAt
 */
function pickCanonical(a: Item, b: Item): Item {
  // Higher tier = lower tier number
  if (a.tier !== b.tier) return a.tier < b.tier ? a : b;

  // Longer text
  if (a.text.length !== b.text.length) return a.text.length > b.text.length ? a : b;

  // More recent publishedAt
  const aTime = new Date(a.publishedAt).getTime();
  const bTime = new Date(b.publishedAt).getTime();
  if (aTime !== bTime) return aTime > bTime ? a : b;

  // Fallback: keep first
  return a;
}

/**
 * Select the canonical item from a group of duplicates.
 */
function selectCanonical(group: Item[]): { canonical: Item; duplicates: Item[] } {
  let canonical = group[0];
  for (let i = 1; i < group.length; i++) {
    canonical = pickCanonical(canonical, group[i]);
  }
  const duplicates = group.filter((item) => item.id !== canonical.id);
  return { canonical, duplicates };
}

/**
 * Perform exact deduplication by normalized URL and hash.
 */
function exactDedup(items: Item[]): {
  uniqueItems: Item[];
  duplicatesRemoved: number;
  mergeLog: MergeLogEntry[];
} {
  // Group items by normalized URL
  const urlGroups = new Map<string, Item[]>();
  // Also group by hash for items without valid URLs
  const hashGroups = new Map<string, Item[]>();

  for (const item of items) {
    const normalizedUrl = item.url ? normalizeUrl(item.url) : '';

    if (normalizedUrl) {
      const group = urlGroups.get(normalizedUrl);
      if (group) {
        group.push(item);
      } else {
        urlGroups.set(normalizedUrl, [item]);
      }
    } else {
      const group = hashGroups.get(item.hash);
      if (group) {
        group.push(item);
      } else {
        hashGroups.set(item.hash, [item]);
      }
    }
  }

  // Also check for hash collisions across URL groups
  // Items with different URLs but the same hash should be deduped
  const seenHashes = new Map<string, string>(); // hash -> canonical URL group key
  const mergedUrlGroups = new Map<string, Item[]>();

  for (const [url, group] of urlGroups) {
    const hash = group[0].hash;
    const existingUrl = seenHashes.get(hash);
    if (existingUrl && mergedUrlGroups.has(existingUrl)) {
      // Merge into existing group
      mergedUrlGroups.get(existingUrl)!.push(...group);
    } else {
      seenHashes.set(hash, url);
      mergedUrlGroups.set(url, [...group]);
    }
  }

  const uniqueItems: Item[] = [];
  const mergeLog: MergeLogEntry[] = [];
  let duplicatesRemoved = 0;

  // Process URL-based groups
  for (const group of mergedUrlGroups.values()) {
    if (group.length === 1) {
      uniqueItems.push(group[0]);
    } else {
      const { canonical, duplicates } = selectCanonical(group);
      uniqueItems.push(canonical);
      duplicatesRemoved += duplicates.length;
      mergeLog.push({
        canonical: canonical.id,
        duplicateIds: duplicates.map((d) => d.id),
      });
    }
  }

  // Process hash-only groups
  for (const group of hashGroups.values()) {
    if (group.length === 1) {
      uniqueItems.push(group[0]);
    } else {
      const { canonical, duplicates } = selectCanonical(group);
      uniqueItems.push(canonical);
      duplicatesRemoved += duplicates.length;
      mergeLog.push({
        canonical: canonical.id,
        duplicateIds: duplicates.map((d) => d.id),
      });
    }
  }

  return { uniqueItems, duplicatesRemoved, mergeLog };
}

/**
 * Deduplicate items using exact matching (URL/hash) and optionally semantic similarity.
 *
 * @param items - Items to deduplicate
 * @param options - Deduplication options
 * @returns DeduplicationResult with canonical items, count of removed duplicates, and merge log
 */
export function deduplicate(
  items: Item[],
  options: DeduplicateOptions = {}
): DeduplicationResult {
  const { semanticDedup = false, threshold = DEFAULT_THRESHOLD } = options;

  // Step 1: Exact dedup
  const { uniqueItems, duplicatesRemoved, mergeLog } = exactDedup(items);

  // Step 2: Optional semantic dedup
  if (semanticDedup) {
    logger.warn(
      `Semantic dedup requested (threshold=${threshold}) but not yet implemented. ` +
        'Returning exact dedup results only.'
    );
    // Semantic dedup would compare text similarity using embeddings.
    // When implemented, it would:
    // 1. Compute embeddings for each item's text
    // 2. Find pairs with similarity above threshold
    // 3. Merge them using the same canonical selection rules
  }

  logger.info(
    `Deduplication: ${items.length} items -> ${uniqueItems.length} unique ` +
      `(${duplicatesRemoved} duplicates removed)`,
    { duplicatesRemoved, mergeLogEntries: mergeLog.length }
  );

  return {
    items: uniqueItems,
    duplicatesRemoved,
    mergeLog,
  };
}
