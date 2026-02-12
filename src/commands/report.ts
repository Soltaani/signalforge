import { Command } from 'commander';
import { createDatabase, closeDatabase } from '../storage/database.js';
import { RunStore } from '../storage/run-store.js';
import { CacheStore } from '../storage/cache-store.js';
import { renderMarkdown } from '../rendering/markdown-renderer.js';
import { renderJSON } from '../rendering/json-renderer.js';
import { TrendError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { join } from 'node:path';

interface ReportOptions {
  runId?: string;
  format: string;
  last: string;
}

export function registerReportCommand(program: Command): void {
  program
    .command('report')
    .description('Show past run results from the database')
    .option('--run-id <id>', 'Show a specific run by ID')
    .option('--format <fmt>', 'Output format (md | json)', 'md')
    .option('--last <n>', 'Show last N runs', '10')
    .action(async (opts: ReportOptions) => {
      const dbPath = join(process.cwd(), '.signalforge', 'data.db');
      const db = createDatabase(dbPath);

      try {
        const runStore = new RunStore(db);
        const cacheStore = new CacheStore(db);

        if (opts.runId) {
          const run = runStore.getById(opts.runId);
          if (!run) {
            logger.error('Run not found', { runId: opts.runId });
            process.exitCode = 1;
            return;
          }

          // Try to retrieve cached report from the generate stage
          const cached = cacheStore.get(run.evidencePackHash);
          if (cached && typeof cached === 'object') {
            const report = cached as Record<string, unknown>;
            const output = opts.format === 'json'
              ? renderJSON(report as never)
              : renderMarkdown(report as never);
            process.stdout.write(output + '\n');
          } else {
            // Show run metadata if no cached report
            process.stdout.write(JSON.stringify(run, null, 2) + '\n');
          }
        } else {
          const runs = runStore.getRecent(parseInt(opts.last, 10));
          if (runs.length === 0) {
            process.stdout.write('No runs found.\n');
            return;
          }

          process.stdout.write('Recent runs:\n\n');
          for (const run of runs) {
            const status = run.status === 'completed' ? 'done' : run.status;
            process.stdout.write(
              `  ${run.runId}  ${run.window}  ${status}  ${run.createdAt}\n`
            );
          }
          process.stdout.write(`\n${runs.length} run(s) found.\n`);
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
