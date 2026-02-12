/**
 * RSS feed fetcher with concurrency control, timeouts, and retries.
 *
 * - p-limit(5) for max 5 concurrent feed fetches
 * - 10s per-feed timeout via AbortController
 * - 2 retries with exponential backoff (1s, 2s)
 * - Promise.allSettled for fault isolation
 */

import Parser from 'rss-parser';
import pLimit from 'p-limit';
import { parseDuration } from '../utils/duration.js';
import { logger } from '../utils/logger.js';
import { FeedFetchError } from '../utils/errors.js';
import type { FeedConfig } from '../config/schema.js';
import type { RawRSSItem } from './normalizer.js';

const CONCURRENCY = 5;
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 1_000;

export interface FetchResult {
  feedId: string;
  ok: boolean;
  items: RawRSSItem[];
  error?: string;
  fetchedAt: string;
}

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an item's publishedAt falls within the time window.
 */
function isWithinWindow(pubDate: string | undefined, windowMs: number): boolean {
  if (!pubDate) return true; // include items without a date
  const pub = new Date(pubDate).getTime();
  if (isNaN(pub)) return true; // include items with unparseable dates
  const cutoff = Date.now() - windowMs;
  return pub >= cutoff;
}

/**
 * Fetch a single RSS feed with timeout support.
 * Uses Promise.race since rss-parser's parseURL doesn't support AbortSignal.
 */
async function fetchWithTimeout(
  parser: Parser,
  url: string,
  timeoutMs: number
): Promise<Parser.Output<Record<string, unknown>>> {
  return Promise.race([
    parser.parseURL(url),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Feed fetch timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/**
 * Fetch a single feed with retries and exponential backoff.
 */
async function fetchSingleFeed(
  feed: FeedConfig,
  windowMs: number,
  parser: Parser
): Promise<FetchResult> {
  const fetchedAt = new Date().toISOString();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        logger.debug(`Retry ${attempt}/${MAX_RETRIES} for feed "${feed.id}" after ${backoffMs}ms`);
        await sleep(backoffMs);
      }

      const result = await fetchWithTimeout(parser, feed.url, TIMEOUT_MS);
      const rawItems: RawRSSItem[] = (result.items ?? [])
        .filter((item) => isWithinWindow(item.isoDate ?? item.pubDate, windowMs))
        .map((item) => ({
          title: item.title,
          link: item.link,
          content: item.content,
          contentSnippet: item.contentSnippet,
          summary: item.summary,
          pubDate: item.pubDate,
          isoDate: item.isoDate,
          creator: item.creator,
          author: item.author as string | undefined,
          categories: item.categories,
        }));

      logger.info(`Fetched feed "${feed.id}": ${rawItems.length} items within window`);

      return {
        feedId: feed.id,
        ok: true,
        items: rawItems,
        fetchedAt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(`Feed "${feed.id}" attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  const error = new FeedFetchError(feed.id, lastError!);
  logger.error(`Feed "${feed.id}" failed after ${MAX_RETRIES + 1} attempts`, {
    error: error.message,
  });

  return {
    feedId: feed.id,
    ok: false,
    items: [],
    error: error.message,
    fetchedAt,
  };
}

/**
 * Fetch all enabled feeds concurrently with p-limit(5) and Promise.allSettled.
 *
 * @param feeds - Feed configurations to fetch
 * @param window - Time window string (e.g. "24h", "7d")
 * @returns Array of FetchResult, one per enabled feed
 */
export async function fetchAllFeeds(
  feeds: FeedConfig[],
  window: string
): Promise<FetchResult[]> {
  const windowMs = parseDuration(window);
  const limit = pLimit(CONCURRENCY);
  const parser = new Parser();

  const enabledFeeds = feeds.filter((f) => f.enabled);
  logger.info(`Fetching ${enabledFeeds.length} feeds (window: ${window})`);

  const settled = await Promise.allSettled(
    enabledFeeds.map((feed) =>
      limit(() => fetchSingleFeed(feed, windowMs, parser))
    )
  );

  return settled.map((result, idx) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // This branch handles unexpected thrown errors that escaped retry logic
    const feed = enabledFeeds[idx];
    logger.error(`Feed "${feed.id}" threw unexpected error: ${result.reason}`);
    return {
      feedId: feed.id,
      ok: false,
      items: [],
      error: String(result.reason),
      fetchedAt: new Date().toISOString(),
    };
  });
}
