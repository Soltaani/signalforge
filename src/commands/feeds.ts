import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { createDatabase, closeDatabase } from '../storage/database.js';
import { FeedStore } from '../storage/feed-store.js';
import { TrendError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { join } from 'node:path';

export function registerFeedsCommand(program: Command): void {
  const feeds = program
    .command('feeds')
    .description('Manage RSS feeds');

  feeds
    .command('list')
    .description('List all configured feeds')
    .action(async () => {
      const dbPath = join(process.cwd(), '.signalforge', 'data.db');
      const db = createDatabase(dbPath);

      try {
        const config = loadConfig();
        const feedStore = new FeedStore(db);

        // Sync config feeds into DB
        for (const feed of config.feeds) {
          feedStore.upsert({
            id: feed.id,
            url: feed.url,
            tier: feed.tier,
            weight: feed.weight,
            enabled: feed.enabled,
            tags: feed.tags,
            lastFetchedAt: null,
            lastStatus: {},
          });
        }

        const allFeeds = feedStore.getAll();

        if (allFeeds.length === 0) {
          process.stdout.write('No feeds configured.\n');
          return;
        }

        process.stdout.write('Feeds:\n\n');
        for (const feed of allFeeds) {
          const status = feed.enabled ? 'enabled' : 'disabled';
          const lastFetch = feed.lastFetchedAt ?? 'never';
          process.stdout.write(
            `  ${feed.id.padEnd(15)} T${feed.tier} w=${feed.weight}  ${status.padEnd(9)} last: ${lastFetch}\n`
          );
          process.stdout.write(`${''.padEnd(17)}${feed.url}\n`);
        }
        process.stdout.write(`\n${allFeeds.length} feed(s) total.\n`);
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

  feeds
    .command('add <id> <url>')
    .description('Add a new feed')
    .option('-t, --tier <n>', 'Feed tier (1, 2, or 3)', '2')
    .option('-w, --weight <n>', 'Feed weight (0-5)', '1.0')
    .option('--tags <tags>', 'Comma-separated tags', '')
    .action(async (id: string, url: string, opts: { tier: string; weight: string; tags: string }) => {
      const dbPath = join(process.cwd(), '.signalforge', 'data.db');
      const db = createDatabase(dbPath);

      try {
        const feedStore = new FeedStore(db);
        const tier = parseInt(opts.tier, 10) as 1 | 2 | 3;
        if (![1, 2, 3].includes(tier)) {
          logger.error('Invalid tier. Must be 1, 2, or 3.');
          process.exitCode = 1;
          return;
        }

        const weight = parseFloat(opts.weight);
        const tags = opts.tags ? opts.tags.split(',').map(t => t.trim()) : [];

        feedStore.upsert({
          id,
          url,
          tier,
          weight,
          enabled: true,
          tags,
          lastFetchedAt: null,
          lastStatus: {},
        });

        process.stdout.write(`Feed "${id}" added.\n`);
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

  feeds
    .command('remove <id>')
    .description('Remove a feed by ID')
    .action(async (id: string) => {
      const dbPath = join(process.cwd(), '.signalforge', 'data.db');
      const db = createDatabase(dbPath);

      try {
        const deleteStmt = db.prepare('DELETE FROM feeds WHERE id = ?');
        const result = deleteStmt.run(id);
        if (result.changes > 0) {
          process.stdout.write(`Feed "${id}" removed.\n`);
        } else {
          logger.error('Feed not found', { id });
          process.exitCode = 1;
        }
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

  feeds
    .command('toggle <id>')
    .description('Toggle a feed enabled/disabled')
    .action(async (id: string) => {
      const dbPath = join(process.cwd(), '.signalforge', 'data.db');
      const db = createDatabase(dbPath);

      try {
        const feedStore = new FeedStore(db);
        const feed = feedStore.getById(id);
        if (!feed) {
          logger.error('Feed not found', { id });
          process.exitCode = 1;
          return;
        }

        feedStore.upsert({ ...feed, enabled: !feed.enabled });
        const newState = !feed.enabled ? 'enabled' : 'disabled';
        process.stdout.write(`Feed "${id}" is now ${newState}.\n`);
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

  feeds
    .command('test <id>')
    .description('Test fetching a single feed')
    .action(async (id: string) => {
      const dbPath = join(process.cwd(), '.signalforge', 'data.db');
      const db = createDatabase(dbPath);

      try {
        const config = loadConfig();
        const feedConfig = config.feeds.find(f => f.id === id);
        const feedStore = new FeedStore(db);
        const feedRow = feedStore.getById(id);

        const feedUrl = feedConfig?.url ?? feedRow?.url;
        if (!feedUrl) {
          logger.error('Feed not found in config or database', { id });
          process.exitCode = 1;
          return;
        }

        process.stdout.write(`Testing feed "${id}" at ${feedUrl}...\n`);

        const { default: Parser } = await import('rss-parser');
        const parser = new Parser({ timeout: 10_000 });
        const feed = await parser.parseURL(feedUrl);

        process.stdout.write(`  Title: ${feed.title ?? '(none)'}\n`);
        process.stdout.write(`  Items: ${feed.items.length}\n`);

        if (feed.items.length > 0) {
          process.stdout.write(`  Latest: ${feed.items[0].title ?? '(untitled)'}\n`);
        }

        process.stdout.write('Feed test successful.\n');
      } catch (err) {
        if (err instanceof TrendError) {
          logger.error(err.message, { code: err.code });
          process.exitCode = err.exitCode;
        } else {
          logger.error('Feed test failed', { error: (err as Error).message });
          process.exitCode = 1;
        }
      } finally {
        closeDatabase(db);
      }
    });
}
