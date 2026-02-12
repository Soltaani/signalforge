/**
 * Token estimation heuristics for context window budgeting.
 *
 * Uses a simple character-based approximation (~4 chars per token for English).
 * Exact tokenization is unnecessary because reserveTokens provides a safety buffer.
 */

import type { EvidencePack } from './evidence-pack.js';

const CHARS_PER_TOKEN = 4;

/** Metadata overhead estimate in tokens (JSON keys, formatting, etc.). */
const METADATA_OVERHEAD_TOKENS = 200;

/**
 * Estimate the number of tokens in a text string.
 * Heuristic: ceil(text.length / 4) for English text.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate the total token count of an EvidencePack.
 * Sums all item text tokens plus metadata overhead.
 */
export function estimateEvidencePackTokens(pack: EvidencePack): number {
  const itemTokens = pack.items.reduce(
    (sum, item) => sum + estimateTokens(item.text) + estimateTokens(item.title),
    0
  );

  const feedTokens = pack.feeds.reduce(
    (sum, feed) => sum + estimateTokens(feed.id) + estimateTokens(feed.url),
    0
  );

  const metadataTokens =
    estimateTokens(pack.metadata.window) +
    estimateTokens(pack.metadata.topic) +
    METADATA_OVERHEAD_TOKENS;

  return itemTokens + feedTokens + metadataTokens;
}
