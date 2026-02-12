import type { ValidationResult } from './schema-validator.js';

export interface ScoreFactor {
  score: number;
  max: number;
}

export interface ScoreBreakdown {
  frequency: ScoreFactor;
  painIntensity: ScoreFactor;
  buyerClarity: ScoreFactor;
  monetizationSignal: ScoreFactor;
  buildSimplicity: ScoreFactor;
  novelty: ScoreFactor;
}

export interface ScoredCluster {
  id: string;
  score: number;
  rank: number;
  scoreBreakdown: ScoreBreakdown;
}

const FACTOR_NAMES: readonly (keyof ScoreBreakdown)[] = [
  'frequency',
  'painIntensity',
  'buyerClarity',
  'monetizationSignal',
  'buildSimplicity',
  'novelty',
];

export function checkScoreConsistency(
  clusters: ScoredCluster[],
): ValidationResult {
  const errors: string[] = [];

  for (const c of clusters) {
    const bd = c.scoreBreakdown;

    for (const factor of FACTOR_NAMES) {
      const f = bd[factor];
      if (f.score > f.max) {
        errors.push(
          `Cluster "${c.id}": ${factor} score ${f.score} exceeds max ${f.max}`,
        );
      }
      if (f.score < 0) {
        errors.push(
          `Cluster "${c.id}": ${factor} score ${f.score} is negative`,
        );
      }
    }

    const sum =
      bd.frequency.score +
      bd.painIntensity.score +
      bd.buyerClarity.score +
      bd.monetizationSignal.score +
      bd.buildSimplicity.score +
      bd.novelty.score;

    if (c.score !== sum) {
      errors.push(
        `Cluster "${c.id}": score ${c.score} != sum of factors ${sum}`,
      );
    }
  }

  // Check rank inversions: higher score should have lower rank number
  const sorted = [...clusters].sort((a, b) => b.score - a.score);
  for (let i = 0; i < sorted.length; i++) {
    const expectedRank = i + 1;
    // For ties in score, allow equal ranks
    if (
      i > 0 &&
      sorted[i].score === sorted[i - 1].score
    ) {
      if (sorted[i].rank < sorted[i - 1].rank) {
        errors.push(
          `Rank inversion: cluster "${sorted[i].id}" (score ${sorted[i].score}, rank ${sorted[i].rank}) ` +
            `ranked higher than "${sorted[i - 1].id}" (score ${sorted[i - 1].score}, rank ${sorted[i - 1].rank}) with equal score`,
        );
      }
      continue;
    }
    if (sorted[i].rank !== expectedRank) {
      // Check if this is a genuine inversion rather than tie-adjusted ranking
      const higherScoreClusters = sorted.filter(
        (other) => other.score > sorted[i].score && other.rank > sorted[i].rank,
      );
      for (const other of higherScoreClusters) {
        errors.push(
          `Rank inversion: cluster "${other.id}" (score ${other.score}) ` +
            `has rank ${other.rank} but "${sorted[i].id}" (score ${sorted[i].score}) has rank ${sorted[i].rank}`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
