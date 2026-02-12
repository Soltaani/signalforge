/**
 * Pure transform: RawRSSItem[] -> Item[].
 *
 * Normalizes raw RSS entries into the unified Item schema used
 * throughout the pipeline.
 */

import { randomUUID } from 'node:crypto';
import { sha256 } from '../utils/hash.js';
import { normalizeUrl } from '../utils/url.js';
import type { FeedConfig } from '../config/schema.js';

/** Raw RSS item shape as returned by rss-parser. */
export interface RawRSSItem {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  pubDate?: string;
  isoDate?: string;
  creator?: string;
  author?: string;
  categories?: string[];
  [key: string]: unknown;
}

/** Normalized item used throughout the pipeline. */
export interface Item {
  id: string;
  sourceId: string;
  tier: 1 | 2 | 3;
  weight: number;
  title: string;
  url: string;
  publishedAt: string;
  text: string;
  author?: string;
  tags?: string[];
  hash: string;
  fetchedAt: string;
}

/**
 * Select the best text content from a raw RSS item.
 * Priority: content > contentSnippet > summary > title
 */
function selectText(raw: RawRSSItem): string {
  if (raw.content && raw.content.trim().length > 0) return raw.content.trim();
  if (raw.contentSnippet && raw.contentSnippet.trim().length > 0) return raw.contentSnippet.trim();
  if (raw.summary && raw.summary.trim().length > 0) return raw.summary.trim();
  return (raw.title ?? '').trim();
}

/**
 * Resolve the published date from a raw RSS item.
 * Falls back to current time if no date is available.
 */
function resolvePublishedAt(raw: RawRSSItem): string {
  const dateStr = raw.isoDate ?? raw.pubDate;
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Compute the dedup hash for an item.
 * SHA-256(normalizeUrl(url) + '|' + title.toLowerCase().trim())
 */
function computeHash(url: string, title: string): string {
  const normalizedUrl = normalizeUrl(url);
  const normalizedTitle = title.toLowerCase().trim();
  return sha256(`${normalizedUrl}|${normalizedTitle}`);
}

/**
 * Normalize raw RSS items from a single feed into the unified Item schema.
 */
export function normalizeItems(raw: RawRSSItem[], feed: FeedConfig): Item[] {
  const now = new Date().toISOString();

  return raw
    .filter((item) => item.title || item.link)
    .map((item): Item => {
      const title = (item.title ?? '').trim();
      const url = (item.link ?? '').trim();
      const author = item.creator ?? item.author;

      return {
        id: randomUUID(),
        sourceId: feed.id,
        tier: feed.tier,
        weight: feed.weight,
        title,
        url,
        publishedAt: resolvePublishedAt(item),
        text: selectText(item),
        author: author ? author.trim() : undefined,
        tags: feed.tags.length > 0 ? [...feed.tags] : undefined,
        hash: computeHash(url, title),
        fetchedAt: now,
      };
    });
}
