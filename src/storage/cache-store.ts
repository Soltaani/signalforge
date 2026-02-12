import type Database from 'better-sqlite3';
import { sha256 } from '../utils/hash.js';

export function buildCacheKey(
  evidencePackHash: string,
  promptVersion: string,
  model: string,
  provider: string,
  stageId: string,
): string {
  return sha256(`${evidencePackHash}|${promptVersion}|${model}|${provider}|${stageId}`);
}

export interface CacheRow {
  cacheKey: string;
  stageId: string;
  reportJson: string;
  createdAt: string;
}

export class CacheStore {
  private readonly getStmt: Database.Statement;
  private readonly setStmt: Database.Statement;
  private readonly deleteByKeyStmt: Database.Statement;
  private readonly deleteByStageStmt: Database.Statement;
  private readonly clearAllStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.getStmt = db.prepare('SELECT * FROM cache WHERE cacheKey = ?');

    this.setStmt = db.prepare(`
      INSERT OR REPLACE INTO cache (cacheKey, stageId, reportJson, createdAt)
      VALUES (@cacheKey, @stageId, @reportJson, @createdAt)
    `);

    this.deleteByKeyStmt = db.prepare('DELETE FROM cache WHERE cacheKey = ?');
    this.deleteByStageStmt = db.prepare('DELETE FROM cache WHERE stageId = ?');
    this.clearAllStmt = db.prepare('DELETE FROM cache');
  }

  get(cacheKey: string): unknown | null {
    const row = this.getStmt.get(cacheKey) as CacheRow | undefined;
    if (!row) return null;
    return JSON.parse(row.reportJson);
  }

  set(cacheKey: string, stageId: string, reportJson: unknown): void {
    this.setStmt.run({
      cacheKey,
      stageId,
      reportJson: JSON.stringify(reportJson),
      createdAt: new Date().toISOString(),
    });
  }

  delete(cacheKey: string): void {
    this.deleteByKeyStmt.run(cacheKey);
  }

  deleteByStage(stageId: string): void {
    this.deleteByStageStmt.run(stageId);
  }

  clearAll(): void {
    this.clearAllStmt.run();
  }
}
