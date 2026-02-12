import type Database from 'better-sqlite3';

export interface RunRow {
  runId: string;
  window: string;
  topic: string;
  evidencePackHash: string;
  status: string;
  createdAt: string;
}

export class RunStore {
  private readonly insertStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly updateStatusStmt: Database.Statement;
  private readonly getRecentStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO runs (runId, window, topic, evidencePackHash, status, createdAt)
      VALUES (@runId, @window, @topic, @evidencePackHash, @status, @createdAt)
    `);

    this.getByIdStmt = db.prepare('SELECT * FROM runs WHERE runId = ?');

    this.updateStatusStmt = db.prepare(
      'UPDATE runs SET status = ? WHERE runId = ?'
    );

    this.getRecentStmt = db.prepare(
      'SELECT * FROM runs ORDER BY createdAt DESC LIMIT ?'
    );
  }

  create(run: Omit<RunRow, 'status' | 'createdAt'> & { topic?: string }): RunRow {
    const row: RunRow = {
      runId: run.runId,
      window: run.window,
      topic: run.topic ?? '',
      evidencePackHash: run.evidencePackHash,
      status: 'running',
      createdAt: new Date().toISOString(),
    };
    this.insertStmt.run(row);
    return row;
  }

  getById(runId: string): RunRow | undefined {
    return this.getByIdStmt.get(runId) as RunRow | undefined;
  }

  updateStatus(runId: string, status: string): void {
    this.updateStatusStmt.run(status, runId);
  }

  getRecent(limit = 10): RunRow[] {
    return this.getRecentStmt.all(limit) as RunRow[];
  }
}
