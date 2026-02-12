import { Command } from 'commander';
import { createDatabase, closeDatabase } from '../storage/database.js';
import { CacheStore } from '../storage/cache-store.js';
import { parseDuration } from '../utils/duration.js';
import { TrendError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { join } from 'node:path';

interface PurgeOptions {
  cache: boolean;
  items: boolean;
  olderThan?: string;
}

export function registerPurgeCommand(program: Command): void {
  program
    .command('purge')
    .description('Clear cache and/or old data')
    .option('--cache', 'Clear the agent output cache', false)
    .option('--items', 'Clear stored items', false)
    .option('--older-than <duration>', 'Only purge data older than duration (e.g. "30d", "7d")')
    .action(async (opts: PurgeOptions) => {
      if (!opts.cache && !opts.items) {
        process.stdout.write('Specify --cache and/or --items to purge.\n');
        process.exitCode = 1;
        return;
      }

      const dbPath = join(process.cwd(), '.signalforge', 'data.db');
      const db = createDatabase(dbPath);

      try {
        let cutoffDate: string | null = null;
        if (opts.olderThan) {
          const ms = parseDuration(opts.olderThan);
          cutoffDate = new Date(Date.now() - ms).toISOString();
        }

        if (opts.cache) {
          if (cutoffDate) {
            const stmt = db.prepare('DELETE FROM cache WHERE createdAt < ?');
            const result = stmt.run(cutoffDate);
            process.stdout.write(`Purged ${result.changes} cached entry(ies) older than ${opts.olderThan}.\n`);
          } else {
            const cacheStore = new CacheStore(db);
            cacheStore.clearAll();
            process.stdout.write('Cache cleared.\n');
          }
        }

        if (opts.items) {
          if (cutoffDate) {
            const stmt = db.prepare('DELETE FROM items WHERE fetchedAt < ?');
            const result = stmt.run(cutoffDate);
            process.stdout.write(`Purged ${result.changes} item(s) older than ${opts.olderThan}.\n`);
          } else {
            const stmt = db.prepare('DELETE FROM items');
            const result = stmt.run();
            process.stdout.write(`Purged ${result.changes} item(s).\n`);
          }
        }

        process.exitCode = 0;
      } catch (err) {
        if (err instanceof TrendError) {
          logger.error(err.message, { code: err.code });
          process.exitCode = err.exitCode;
        } else {
          logger.error('Unexpected error', { error: (err as Error).message });
          process.exitCode = 1;
        }
      } finally {
        closeDatabase(db);
      }
    });
}
