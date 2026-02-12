import { Command } from 'commander';
import { createDatabase, closeDatabase } from '../storage/database.js';
import { RunStore } from '../storage/run-store.js';
import { renderMarkdown } from '../rendering/markdown-renderer.js';
import { renderJSON } from '../rendering/json-renderer.js';
import { TrendError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { join } from 'node:path';

interface DrillOptions {
  runId?: string;
  format: string;
}

export function registerDrillCommand(program: Command): void {
  program
    .command('drill <cluster-id>')
    .description('Deep dive into a specific cluster from a past run')
    .option('--run-id <id>', 'Run ID to look up (defaults to most recent)')
    .option('--format <fmt>', 'Output format (md | json)', 'md')
    .action(async (clusterId: string, opts: DrillOptions) => {
      const dbPath = join(process.cwd(), '.signalforge', 'data.db');
      const db = createDatabase(dbPath);

      try {
        const runStore = new RunStore(db);

        const run = opts.runId
          ? runStore.getById(opts.runId)
          : runStore.getRecent(1)[0];

        if (!run) {
          logger.error('No runs found');
          process.exitCode = 1;
          return;
        }

        // Look for cached report in runs table or cache
        const reportStmt = db.prepare(
          'SELECT reportJson FROM cache WHERE cacheKey LIKE ? ORDER BY createdAt DESC LIMIT 1'
        );
        const row = reportStmt.get(`%`) as { reportJson: string } | undefined;

        if (!row) {
          logger.error('No cached report found for this run');
          process.exitCode = 1;
          return;
        }

        const fullReport = JSON.parse(row.reportJson) as {
          clusters?: Array<{
            id: string;
            [key: string]: unknown;
          }>;
          [key: string]: unknown;
        };

        const clusters = fullReport.clusters ?? [];
        const cluster = clusters.find(
          (c) => c.id === clusterId || c.id.startsWith(clusterId)
        );

        if (!cluster) {
          logger.error('Cluster not found', { clusterId });
          process.stdout.write(
            `Available clusters:\n${clusters.map((c) => `  ${c.id}`).join('\n')}\n`
          );
          process.exitCode = 1;
          return;
        }

        // Build a single-cluster report for rendering
        const drillReport = {
          metadata: {
            runId: run.runId,
            createdAt: run.createdAt,
            window: run.window,
            topic: run.topic,
          },
          feeds: [],
          clusters: [cluster],
          warnings: [],
          errors: [],
        };

        const output = opts.format === 'json'
          ? renderJSON(drillReport as never)
          : renderMarkdown(drillReport as never);

        process.stdout.write(output + '\n');
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
