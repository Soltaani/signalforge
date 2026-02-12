import type Database from 'better-sqlite3';

export interface FeedRow {
  id: string;
  url: string;
  tier: 1 | 2 | 3;
  weight: number;
  enabled: boolean;
  tags: string[];
  lastFetchedAt: string | null;
  lastStatus: Record<string, unknown>;
}

interface FeedDbRow {
  id: string;
  url: string;
  tier: number;
  weight: number;
  enabled: number;
  tags: string;
  lastFetchedAt: string | null;
  lastStatus: string;
}

function rowToFeed(row: FeedDbRow): FeedRow {
  return {
    id: row.id,
    url: row.url,
    tier: row.tier as 1 | 2 | 3,
    weight: row.weight,
    enabled: row.enabled === 1,
    tags: JSON.parse(row.tags) as string[],
    lastFetchedAt: row.lastFetchedAt,
    lastStatus: JSON.parse(row.lastStatus) as Record<string, unknown>,
  };
}

export class FeedStore {
  private readonly upsertStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly getAllStmt: Database.Statement;
  private readonly getEnabledStmt: Database.Statement;
  private readonly updateFetchStatusStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO feeds (id, url, tier, weight, enabled, tags, lastFetchedAt, lastStatus)
      VALUES (@id, @url, @tier, @weight, @enabled, @tags, @lastFetchedAt, @lastStatus)
      ON CONFLICT(id) DO UPDATE SET
        url           = excluded.url,
        tier          = excluded.tier,
        weight        = excluded.weight,
        enabled       = excluded.enabled,
        tags          = excluded.tags,
        lastFetchedAt = COALESCE(excluded.lastFetchedAt, feeds.lastFetchedAt),
        lastStatus    = COALESCE(excluded.lastStatus, feeds.lastStatus)
    `);

    this.getByIdStmt = db.prepare('SELECT * FROM feeds WHERE id = ?');
    this.getAllStmt = db.prepare('SELECT * FROM feeds ORDER BY tier ASC, weight DESC');
    this.getEnabledStmt = db.prepare(
      'SELECT * FROM feeds WHERE enabled = 1 ORDER BY tier ASC, weight DESC'
    );
    this.updateFetchStatusStmt = db.prepare(
      'UPDATE feeds SET lastFetchedAt = ?, lastStatus = ? WHERE id = ?'
    );
  }

  upsert(feed: FeedRow): void {
    this.upsertStmt.run({
      id: feed.id,
      url: feed.url,
      tier: feed.tier,
      weight: feed.weight,
      enabled: feed.enabled ? 1 : 0,
      tags: JSON.stringify(feed.tags ?? []),
      lastFetchedAt: feed.lastFetchedAt ?? null,
      lastStatus: JSON.stringify(feed.lastStatus ?? {}),
    });
  }

  upsertMany(feeds: FeedRow[]): void {
    const tx = this.db.transaction((items: FeedRow[]) => {
      for (const feed of items) {
        this.upsert(feed);
      }
    });
    tx(feeds);
  }

  getById(id: string): FeedRow | undefined {
    const row = this.getByIdStmt.get(id) as FeedDbRow | undefined;
    return row ? rowToFeed(row) : undefined;
  }

  getAll(): FeedRow[] {
    const rows = this.getAllStmt.all() as FeedDbRow[];
    return rows.map(rowToFeed);
  }

  getEnabled(): FeedRow[] {
    const rows = this.getEnabledStmt.all() as FeedDbRow[];
    return rows.map(rowToFeed);
  }

  updateFetchStatus(id: string, lastFetchedAt: string, lastStatus: Record<string, unknown>): void {
    this.updateFetchStatusStmt.run(lastFetchedAt, JSON.stringify(lastStatus), id);
  }
}
