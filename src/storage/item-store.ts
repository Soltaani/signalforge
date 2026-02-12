import type Database from 'better-sqlite3';

export interface ItemRow {
  id: string;
  sourceId: string;
  tier: 1 | 2 | 3;
  weight: number;
  title: string;
  url: string;
  publishedAt: string;
  text: string;
  author: string | null;
  hash: string;
  fetchedAt: string;
  tags: string[];
  dedupedInto: string | null;
}

interface ItemDbRow {
  id: string;
  sourceId: string;
  tier: number;
  weight: number;
  title: string;
  url: string;
  publishedAt: string;
  text: string;
  author: string | null;
  hash: string;
  fetchedAt: string;
  tags: string;
  dedupedInto: string | null;
}

function rowToItem(row: ItemDbRow): ItemRow {
  return {
    ...row,
    tier: row.tier as 1 | 2 | 3,
    tags: JSON.parse(row.tags) as string[],
  };
}

export class ItemStore {
  private readonly insertStmt: Database.Statement;
  private readonly insertManyTx: Database.Transaction<(items: ItemRow[]) => void>;
  private readonly getByIdStmt: Database.Statement;
  private readonly getByWindowStmt: Database.Statement;
  private readonly getBySourceIdStmt: Database.Statement;
  private readonly markDedupedStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT OR IGNORE INTO items
        (id, sourceId, tier, weight, title, url, publishedAt, text, author, hash, fetchedAt, tags, dedupedInto)
      VALUES
        (@id, @sourceId, @tier, @weight, @title, @url, @publishedAt, @text, @author, @hash, @fetchedAt, @tags, @dedupedInto)
    `);

    this.insertManyTx = db.transaction((items: ItemRow[]) => {
      for (const item of items) {
        this.insertStmt.run({
          ...item,
          tags: JSON.stringify(item.tags ?? []),
        });
      }
    });

    this.getByIdStmt = db.prepare('SELECT * FROM items WHERE id = ?');

    this.getByWindowStmt = db.prepare(
      'SELECT * FROM items WHERE publishedAt >= ? AND publishedAt <= ? ORDER BY publishedAt DESC'
    );

    this.getBySourceIdStmt = db.prepare(
      'SELECT * FROM items WHERE sourceId = ? ORDER BY publishedAt DESC'
    );

    this.markDedupedStmt = db.prepare(
      'UPDATE items SET dedupedInto = ? WHERE id = ?'
    );
  }

  insertMany(items: ItemRow[]): void {
    this.insertManyTx(items);
  }

  getById(id: string): ItemRow | undefined {
    const row = this.getByIdStmt.get(id) as ItemDbRow | undefined;
    return row ? rowToItem(row) : undefined;
  }

  getByWindow(from: string, to: string): ItemRow[] {
    const rows = this.getByWindowStmt.all(from, to) as ItemDbRow[];
    return rows.map(rowToItem);
  }

  getBySourceId(sourceId: string): ItemRow[] {
    const rows = this.getBySourceIdStmt.all(sourceId) as ItemDbRow[];
    return rows.map(rowToItem);
  }

  markDeduped(itemId: string, dedupedIntoId: string): void {
    this.markDedupedStmt.run(dedupedIntoId, itemId);
  }
}
