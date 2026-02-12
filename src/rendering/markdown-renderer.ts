/**
 * Markdown Renderer — converts a Report into a formatted Markdown string.
 * Pure function, no side effects.
 */

// ---------------------------------------------------------------------------
// Local Report type definitions (based on architecture.md)
// ---------------------------------------------------------------------------

interface ScoreFactor {
  score: number;
  max: number;
}

interface ScoreBreakdown {
  frequency: ScoreFactor;
  painIntensity: ScoreFactor;
  buyerClarity: ScoreFactor;
  monetizationSignal: ScoreFactor;
  buildSimplicity: ScoreFactor;
  novelty: ScoreFactor;
}

interface GroundedClaim {
  claim: string;
  evidence: string[];
  snippets?: string[];
}

interface PainSignal {
  id: string;
  type: string;
  statement: string;
  evidence: string[];
  snippets?: string[];
}

interface Opportunity {
  id: string;
  clusterId: string;
  title: string;
  description: string;
  targetAudience: string;
  painPoint: string;
  monetizationModel: string;
  mvpScope: string;
  validationSteps: string[];
  evidence: string[];
}

interface Cluster {
  id: string;
  label: string;
  summary: GroundedClaim;
  keyphrases: string[];
  itemIds: string[];
  painSignals: PainSignal[];
  score?: number;
  rank?: number;
  scoreBreakdown?: ScoreBreakdown;
  whyNow?: GroundedClaim;
  opportunities?: Opportunity[];
}

interface BestBet {
  clusterId: string;
  opportunityId: string;
  why: GroundedClaim[];
}

interface FeedStatus {
  id: string;
  url: string;
  ok: boolean;
  itemCount?: number;
  error?: string;
}

interface ReportMetadata {
  runId: string;
  createdAt: string;
  window: string;
  topic: string;
  promptVersion?: string;
  provider?: string;
  model?: string;
}

interface EvidenceItem {
  id: string;
  title: string;
  url: string;
  sourceId: string;
}

export interface Report {
  metadata: ReportMetadata;
  feeds: FeedStatus[];
  clusters: Cluster[];
  opportunities?: Opportunity[];
  bestBet?: BestBet;
  warnings: string[];
  errors: string[];
  items?: EvidenceItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeMarkdown(text: string): string {
  return text.replace(/([|])/g, '\\$1');
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function buildItemLookup(report: Report): Map<string, EvidenceItem> {
  const map = new Map<string, EvidenceItem>();
  if (report.items) {
    for (const item of report.items) {
      map.set(item.id, item);
    }
  }
  return map;
}

function getClusterOpportunities(
  cluster: Cluster,
  report: Report,
): Opportunity[] {
  if (cluster.opportunities && cluster.opportunities.length > 0) {
    return cluster.opportunities;
  }
  if (report.opportunities) {
    return report.opportunities.filter((o) => o.clusterId === cluster.id);
  }
  return [];
}

function findBestBetOpportunity(report: Report): {
  cluster: Cluster | undefined;
  opportunity: Opportunity | undefined;
} {
  if (!report.bestBet) {
    return { cluster: undefined, opportunity: undefined };
  }
  const cluster = report.clusters.find(
    (c) => c.id === report.bestBet!.clusterId,
  );
  const allOpportunities = report.opportunities ?? [];
  const clusterOpps = cluster?.opportunities ?? [];
  const opportunity =
    [...clusterOpps, ...allOpportunities].find(
      (o) => o.id === report.bestBet!.opportunityId,
    );
  return { cluster, opportunity };
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHeader(report: Report): string {
  const { metadata } = report;
  const lines: string[] = [];

  const topicSuffix = metadata.topic ? ` — ${metadata.topic}` : '';
  lines.push(`# Trend Report${topicSuffix}`);
  lines.push('');
  lines.push(`**Date:** ${formatDate(metadata.createdAt)}`);
  lines.push(`**Window:** ${metadata.window}`);
  if (metadata.topic) {
    lines.push(`**Topic:** ${metadata.topic}`);
  }
  if (metadata.provider && metadata.model) {
    lines.push(`**Model:** ${metadata.provider} / ${metadata.model}`);
  }
  lines.push('');

  return lines.join('\n');
}

function renderExecutiveSummary(report: Report): string {
  const lines: string[] = [];
  lines.push('## Executive Summary');
  lines.push('');

  const rankedClusters = [...report.clusters].sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity),
  );

  // Best bet bullet
  if (report.bestBet) {
    const { cluster, opportunity } = findBestBetOpportunity(report);
    if (cluster && opportunity) {
      lines.push(
        `- **Best Bet:** ${opportunity.title} (in "${cluster.label}" cluster, score ${cluster.score ?? 'N/A'})`,
      );
    }
  }

  // Top cluster bullets (up to 5 to stay within 3-6 total)
  const maxBullets = report.bestBet ? 5 : 6;
  for (const cluster of rankedClusters.slice(0, maxBullets)) {
    const scoreStr =
      cluster.score !== undefined ? ` (score: ${cluster.score})` : '';
    lines.push(
      `- **${cluster.label}**${scoreStr}: ${cluster.summary.claim}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function renderScoreBreakdownTable(breakdown: ScoreBreakdown): string {
  const factors: Array<{ name: string; key: keyof ScoreBreakdown }> = [
    { name: 'Frequency', key: 'frequency' },
    { name: 'Pain Intensity', key: 'painIntensity' },
    { name: 'Buyer Clarity', key: 'buyerClarity' },
    { name: 'Monetization Signal', key: 'monetizationSignal' },
    { name: 'Build Simplicity', key: 'buildSimplicity' },
    { name: 'Novelty', key: 'novelty' },
  ];

  const lines: string[] = [];
  lines.push('| Factor | Score | Max |');
  lines.push('|--------|------:|----:|');
  let total = 0;
  let totalMax = 0;
  for (const f of factors) {
    const factor = breakdown[f.key];
    lines.push(
      `| ${f.name} | ${factor.score} | ${factor.max} |`,
    );
    total += factor.score;
    totalMax += factor.max;
  }
  lines.push(`| **Total** | **${total}** | **${totalMax}** |`);
  return lines.join('\n');
}

function renderClusters(report: Report): string {
  const lines: string[] = [];
  lines.push('## Clusters');
  lines.push('');

  const rankedClusters = [...report.clusters].sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity),
  );

  const itemLookup = buildItemLookup(report);

  for (const cluster of rankedClusters) {
    const rankStr = cluster.rank !== undefined ? `#${cluster.rank} ` : '';
    const scoreStr =
      cluster.score !== undefined ? ` (Score: ${cluster.score})` : '';
    lines.push(`### ${rankStr}${escapeMarkdown(cluster.label)}${scoreStr}`);
    lines.push('');

    // Summary
    lines.push(`> ${cluster.summary.claim}`);
    lines.push('');

    // Why now
    if (cluster.whyNow) {
      lines.push(`**Why now:** ${cluster.whyNow.claim}`);
      lines.push('');
    }

    // Score breakdown table
    if (cluster.scoreBreakdown) {
      lines.push('#### Score Breakdown');
      lines.push('');
      lines.push(renderScoreBreakdownTable(cluster.scoreBreakdown));
      lines.push('');
    }

    // Headlines with links
    if (cluster.itemIds.length > 0) {
      lines.push('#### Headlines');
      lines.push('');
      for (const itemId of cluster.itemIds) {
        const item = itemLookup.get(itemId);
        if (item) {
          lines.push(`- [${escapeMarkdown(item.title)}](${item.url})`);
        } else {
          lines.push(`- Item: ${itemId}`);
        }
      }
      lines.push('');
    }

    // Pain signals
    if (cluster.painSignals.length > 0) {
      lines.push('#### Pain Signals');
      lines.push('');
      for (const signal of cluster.painSignals) {
        lines.push(
          `- **[${signal.type}]** ${signal.statement}`,
        );
      }
      lines.push('');
    }

    // Opportunities
    const opportunities = getClusterOpportunities(cluster, report);
    if (opportunities.length > 0) {
      lines.push('#### Opportunities');
      lines.push('');
      for (const opp of opportunities) {
        lines.push(`**${escapeMarkdown(opp.title)}**`);
        lines.push('');
        lines.push(opp.description);
        lines.push('');
        lines.push(`- **Target Audience:** ${opp.targetAudience}`);
        lines.push(`- **Pain Point:** ${opp.painPoint}`);
        lines.push(`- **Monetization:** ${opp.monetizationModel}`);
        lines.push(`- **MVP Scope:** ${opp.mvpScope}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

function renderBestBet(report: Report): string {
  if (!report.bestBet) {
    return '';
  }

  const lines: string[] = [];
  const { cluster, opportunity } = findBestBetOpportunity(report);

  lines.push('## Best Bet Recommendation');
  lines.push('');

  if (cluster) {
    lines.push(`**Cluster:** ${cluster.label}`);
  }
  if (opportunity) {
    lines.push(`**Opportunity:** ${opportunity.title}`);
    lines.push('');
    lines.push(opportunity.description);
    lines.push('');
    lines.push(`- **Target Audience:** ${opportunity.targetAudience}`);
    lines.push(`- **Pain Point:** ${opportunity.painPoint}`);
    lines.push(`- **Monetization:** ${opportunity.monetizationModel}`);
    lines.push(`- **MVP Scope:** ${opportunity.mvpScope}`);
  }
  lines.push('');

  // Reasoning
  lines.push('### Why This Is the Best Bet');
  lines.push('');
  for (const claim of report.bestBet.why) {
    lines.push(`- ${claim.claim}`);
  }
  lines.push('');

  return lines.join('\n');
}

function renderValidationPlan(report: Report): string {
  if (!report.bestBet) {
    return '';
  }

  const { opportunity } = findBestBetOpportunity(report);
  if (!opportunity || opportunity.validationSteps.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Validation Plan (Next 7 Days)');
  lines.push('');

  for (let i = 0; i < opportunity.validationSteps.length; i++) {
    lines.push(`${i + 1}. ${opportunity.validationSteps[i]}`);
  }
  lines.push('');

  return lines.join('\n');
}

function renderFeedHealth(report: Report): string {
  if (report.feeds.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Feed Health');
  lines.push('');

  const failures = report.feeds.filter((f) => !f.ok);
  const successes = report.feeds.filter((f) => f.ok);

  lines.push(
    `**${successes.length}/${report.feeds.length}** feeds fetched successfully.`,
  );
  lines.push('');

  if (failures.length > 0) {
    lines.push('### Failures');
    lines.push('');
    for (const feed of failures) {
      lines.push(
        `- **${feed.id}** (${feed.url}): ${feed.error ?? 'Unknown error'}`,
      );
    }
    lines.push('');
  }

  // Warnings and errors from the report
  if (report.warnings.length > 0) {
    lines.push('### Warnings');
    lines.push('');
    for (const w of report.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  if (report.errors.length > 0) {
    lines.push('### Errors');
    lines.push('');
    for (const e of report.errors) {
      lines.push(`- ${e}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderMarkdown(report: Report): string {
  const sections = [
    renderHeader(report),
    renderExecutiveSummary(report),
    renderClusters(report),
    renderBestBet(report),
    renderValidationPlan(report),
    renderFeedHealth(report),
  ];

  return sections.filter((s) => s.length > 0).join('---\n\n');
}
