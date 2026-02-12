import type { ValidationResult } from './schema-validator.js';

export interface EvidenceItem {
  id: string;
}

export interface EvidencePack {
  items: EvidenceItem[];
}

export interface PainSignal {
  id: string;
  evidence: string[];
}

export interface Cluster {
  id: string;
  itemIds: string[];
  painSignals: PainSignal[];
}

export interface Opportunity {
  id: string;
  clusterId: string;
  evidence: string[];
}

export interface BestBet {
  clusterId: string;
  opportunityId: string;
}

export interface Report {
  clusters: Cluster[];
  opportunities: Opportunity[];
  bestBet: BestBet;
}

export function checkEvidenceCoverage(
  report: Report,
  evidencePack: EvidencePack,
): ValidationResult {
  const validItemIds = new Set(evidencePack.items.map((i) => i.id));
  const errors: string[] = [];

  const clusterIds = new Set<string>();
  const opportunityIds = new Set<string>();

  for (const cluster of report.clusters) {
    clusterIds.add(cluster.id);

    for (const itemId of cluster.itemIds) {
      if (!validItemIds.has(itemId)) {
        errors.push(
          `Orphaned itemId "${itemId}" in cluster "${cluster.id}"`,
        );
      }
    }

    for (const signal of cluster.painSignals) {
      for (const eid of signal.evidence) {
        if (!validItemIds.has(eid)) {
          errors.push(
            `Orphaned evidence "${eid}" in pain signal "${signal.id}"`,
          );
        }
      }
    }
  }

  for (const opportunity of report.opportunities) {
    opportunityIds.add(opportunity.id);

    if (!clusterIds.has(opportunity.clusterId)) {
      errors.push(
        `Opportunity "${opportunity.id}" references non-existent cluster "${opportunity.clusterId}"`,
      );
    }

    for (const eid of opportunity.evidence) {
      if (!validItemIds.has(eid)) {
        errors.push(
          `Orphaned evidence "${eid}" in opportunity "${opportunity.id}"`,
        );
      }
    }
  }

  if (!clusterIds.has(report.bestBet.clusterId)) {
    errors.push(
      `bestBet references non-existent cluster "${report.bestBet.clusterId}"`,
    );
  }

  if (!opportunityIds.has(report.bestBet.opportunityId)) {
    errors.push(
      `bestBet references non-existent opportunity "${report.bestBet.opportunityId}"`,
    );
  }

  return { ok: errors.length === 0, errors };
}
