import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { createProvider } from '../agent/provider.js';
import { runPipeline } from '../pipeline/orchestrator.js';
import type { PipelineResult, Report as PipelineReport, Message } from '../pipeline/orchestrator.js';
import { renderMarkdown } from '../rendering/markdown-renderer.js';
import type { Report as RenderReport } from '../rendering/markdown-renderer.js';
import { renderJSON } from '../rendering/json-renderer.js';
import { TrendError } from '../utils/errors.js';
import { logger, setLogLevel } from '../utils/logger.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface ScanOptions {
  window: string;
  filter?: string;
  maxItems: string;
  maxClusters: string;
  maxIdeas: string;
  provider?: string;
  model?: string;
  agent: boolean;
  output: string;
  outFile?: string;
  progress: boolean;
  semanticDedup: boolean;
}

function toRenderReport(
  pipelineReport: PipelineReport,
  warnings: Message[],
  errors: Message[],
): RenderReport {
  const scoreMap = new Map(
    pipelineReport.scoredClusters.map((sc) => [sc.clusterId, sc]),
  );
  const oppMap = new Map<string, typeof pipelineReport.opportunities>();
  for (const opp of pipelineReport.opportunities) {
    const existing = oppMap.get(opp.clusterId) ?? [];
    existing.push(opp);
    oppMap.set(opp.clusterId, existing);
  }

  return {
    metadata: {
      runId: pipelineReport.metadata.runId,
      createdAt: pipelineReport.metadata.generatedAt,
      window: pipelineReport.metadata.window,
      topic: pipelineReport.metadata.topic,
      promptVersion: pipelineReport.metadata.promptVersion,
      provider: pipelineReport.metadata.provider,
      model: pipelineReport.metadata.model,
    },
    feeds: pipelineReport.feeds.map((f) => ({
      id: f.feedId,
      url: '',
      ok: f.ok,
      itemCount: f.itemCount,
      error: f.error,
    })),
    clusters: pipelineReport.clusters.map((c) => {
      const scored = scoreMap.get(c.id);
      return {
        id: c.id,
        label: c.label,
        summary: c.summary,
        keyphrases: c.keyphrases,
        itemIds: c.itemIds,
        painSignals: c.painSignals,
        score: scored?.score,
        rank: scored?.rank,
        scoreBreakdown: scored?.scoreBreakdown as never,
        whyNow: scored?.whyNow,
        opportunities: oppMap.get(c.id)?.map((o) => ({
          id: o.id,
          clusterId: o.clusterId,
          title: o.title,
          description: o.description,
          targetAudience: o.targetAudience,
          painPoint: o.painPoint,
          monetizationModel: o.monetizationModel,
          mvpScope: o.mvpScope,
          validationSteps: o.validationSteps,
          evidence: o.evidence,
        })),
      };
    }),
    opportunities: pipelineReport.opportunities.map((o) => ({
      id: o.id,
      clusterId: o.clusterId,
      title: o.title,
      description: o.description,
      targetAudience: o.targetAudience,
      painPoint: o.painPoint,
      monetizationModel: o.monetizationModel,
      mvpScope: o.mvpScope,
      validationSteps: o.validationSteps,
      evidence: o.evidence,
    })),
    bestBet: pipelineReport.bestBet
      ? {
          clusterId: pipelineReport.bestBet.clusterId,
          opportunityId: pipelineReport.bestBet.opportunityId,
          why: pipelineReport.bestBet.why,
        }
      : undefined,
    warnings: warnings.map((w) => w.message),
    errors: errors.map((e) => e.message),
    items: pipelineReport.evidencePack.items.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      sourceId: item.sourceId,
    })),
  };
}

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Scan RSS feeds for trend-driven opportunities')
    .option('-w, --window <duration>', 'Time window for RSS items', '24h')
    .option('-f, --filter <keyword>', 'Keyword filter for items')
    .option('--max-items <n>', 'Maximum items to process', '500')
    .option('--max-clusters <n>', 'Maximum clusters to extract', '12')
    .option('--max-ideas <n>', 'Maximum ideas per cluster', '3')
    .option('-p, --provider <name>', 'LLM provider (openai | anthropic)')
    .option('-m, --model <name>', 'LLM model name')
    .option('--no-agent', 'Skip LLM analysis stages')
    .option('-o, --output <format>', 'Output format (md | json)', 'md')
    .option('--out-file <path>', 'Write output to file instead of stdout')
    .option('--progress', 'Show progress timings', false)
    .option('--semantic-dedup', 'Enable semantic deduplication', false)
    .action(async (opts: ScanOptions) => {
      if (opts.progress) {
        setLogLevel('debug');
      }

      const cliOverrides: Record<string, unknown> = {};
      if (opts.provider || opts.model) {
        const agentOverrides: Record<string, unknown> = {};
        if (opts.provider) agentOverrides.provider = opts.provider;
        if (opts.model) agentOverrides.model = opts.model;
        cliOverrides.agent = agentOverrides;
      }

      const config = loadConfig({ cliOverrides });

      try {
        const provider = opts.agent
          ? await createProvider(config.agent)
          : null;

        const dbPath = join(process.cwd(), '.signalforge', 'data.db');

        const result: PipelineResult = await runPipeline({
          window: opts.window,
          filter: opts.filter,
          maxItems: parseInt(opts.maxItems, 10),
          maxClusters: parseInt(opts.maxClusters, 10),
          maxIdeasPerCluster: parseInt(opts.maxIdeas, 10),
          agentEnabled: opts.agent,
          provider: provider!,
          config,
          dbPath,
        });

        const renderReport = toRenderReport(result.report, result.warnings, result.errors);

        const output = opts.output === 'json'
          ? renderJSON(renderReport)
          : renderMarkdown(renderReport);

        if (opts.outFile) {
          writeFileSync(opts.outFile, output, 'utf-8');
          logger.info('Output written', { path: opts.outFile });
        } else {
          process.stdout.write(output + '\n');
        }

        for (const w of result.warnings) {
          logger.warn(w.message, { stage: w.stage });
        }
        for (const e of result.errors) {
          logger.error(e.message, { stage: e.stage });
        }

        process.exitCode = result.exitCode;
      } catch (err) {
        if (err instanceof TrendError) {
          logger.error(err.message, { code: err.code });
          process.exitCode = err.exitCode;
        } else {
          logger.error('Unexpected error', { error: (err as Error).message });
          process.exitCode = 1;
        }
      }
    });
}
