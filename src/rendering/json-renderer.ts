/**
 * JSON Renderer — converts a Report into a formatted JSON string.
 * Pure function, no side effects.
 *
 * Outputs the full report matching schemas/report.v1.json with 2-space indent.
 */

// ---------------------------------------------------------------------------
// Local Report type definition (based on architecture.md)
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
// Public API
// ---------------------------------------------------------------------------

export function renderJSON(report: Report): string {
  return JSON.stringify(report, null, 2);
}
