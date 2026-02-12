import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const reportSchemaPath = join(__dirname, '..', '..', 'schemas', 'report.v1.json');
const reportSchemaJSON = JSON.parse(readFileSync(reportSchemaPath, 'utf-8'));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ajv = new (Ajv2020 as any)({ allErrors: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(addFormats as any)(ajv);

const validateReportFn = ajv.compile(reportSchemaJSON);

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(
    (err: ErrorObject) => `${err.instancePath}: ${err.message}`,
  );
}

export function validateReport(data: unknown): ValidationResult {
  const valid = validateReportFn(data);
  if (!valid) {
    return {
      ok: false,
      errors: formatErrors(validateReportFn.errors),
    };
  }
  return { ok: true, errors: [] };
}

export function validateStageOutput(
  stage: string,
  data: unknown,
): ValidationResult {
  const stageSchemas: Record<string, object> = {
    extract: buildExtractSchema(),
    score: buildScoreSchema(),
    generate: buildGenerateSchema(),
  };

  const schema = stageSchemas[stage];
  if (!schema) {
    return { ok: false, errors: [`Unknown stage: "${stage}"`] };
  }

  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    return {
      ok: false,
      errors: formatErrors(validate.errors),
    };
  }
  return { ok: true, errors: [] };
}

function buildExtractSchema(): object {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['clusters'],
    additionalProperties: false,
    properties: {
      clusters: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: [
            'id',
            'label',
            'summary',
            'keyphrases',
            'itemIds',
            'painSignals',
          ],
          additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1 },
            label: { type: 'string', minLength: 1 },
            summary: {
              type: 'object',
              required: ['claim', 'evidence'],
              additionalProperties: false,
              properties: {
                claim: { type: 'string', minLength: 1 },
                evidence: {
                  type: 'array',
                  items: { type: 'string', minLength: 1 },
                  minItems: 1,
                },
                snippets: { type: 'array', items: { type: 'string' } },
              },
            },
            keyphrases: { type: 'array', items: { type: 'string' } },
            itemIds: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              minItems: 1,
            },
            painSignals: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'type', 'statement', 'evidence'],
                additionalProperties: false,
                properties: {
                  id: { type: 'string', minLength: 1 },
                  type: {
                    type: 'string',
                    enum: [
                      'complaint',
                      'urgency',
                      'workaround',
                      'monetization',
                      'buyer',
                      'risk',
                    ],
                  },
                  statement: { type: 'string', minLength: 1 },
                  evidence: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    minItems: 1,
                  },
                  snippets: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  };
}

function buildScoreSchema(): object {
  const scoreFactorSchema = {
    type: 'object',
    required: ['score', 'max'],
    additionalProperties: false,
    properties: {
      score: { type: 'number' },
      max: { type: 'number' },
    },
  };

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['scoredClusters'],
    additionalProperties: false,
    properties: {
      scoredClusters: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'clusterId',
            'score',
            'rank',
            'scoreBreakdown',
            'whyNow',
          ],
          additionalProperties: false,
          properties: {
            clusterId: { type: 'string', minLength: 1 },
            score: { type: 'number', minimum: 0, maximum: 100 },
            rank: { type: 'integer', minimum: 1 },
            scoreBreakdown: {
              type: 'object',
              required: [
                'frequency',
                'painIntensity',
                'buyerClarity',
                'monetizationSignal',
                'buildSimplicity',
                'novelty',
              ],
              additionalProperties: false,
              properties: {
                frequency: scoreFactorSchema,
                painIntensity: scoreFactorSchema,
                buyerClarity: scoreFactorSchema,
                monetizationSignal: scoreFactorSchema,
                buildSimplicity: scoreFactorSchema,
                novelty: scoreFactorSchema,
              },
            },
            whyNow: {
              type: 'object',
              required: ['claim', 'evidence'],
              additionalProperties: false,
              properties: {
                claim: { type: 'string', minLength: 1 },
                evidence: {
                  type: 'array',
                  items: { type: 'string', minLength: 1 },
                  minItems: 1,
                },
                snippets: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  };
}

function buildGenerateSchema(): object {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['opportunities', 'bestBet'],
    additionalProperties: false,
    properties: {
      opportunities: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'id',
            'clusterId',
            'title',
            'description',
            'targetAudience',
            'painPoint',
            'monetizationModel',
            'mvpScope',
            'validationSteps',
            'evidence',
          ],
          additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1 },
            clusterId: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            description: { type: 'string', minLength: 1 },
            targetAudience: { type: 'string', minLength: 1 },
            painPoint: { type: 'string', minLength: 1 },
            monetizationModel: { type: 'string', minLength: 1 },
            mvpScope: { type: 'string', minLength: 1 },
            validationSteps: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              minItems: 1,
            },
            evidence: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              minItems: 1,
            },
          },
        },
      },
      bestBet: {
        type: 'object',
        required: ['clusterId', 'opportunityId', 'why'],
        additionalProperties: false,
        properties: {
          clusterId: { type: 'string', minLength: 1 },
          opportunityId: { type: 'string', minLength: 1 },
          why: {
            type: 'array',
            items: {
              type: 'object',
              required: ['claim', 'evidence'],
              additionalProperties: false,
              properties: {
                claim: { type: 'string', minLength: 1 },
                evidence: {
                  type: 'array',
                  items: { type: 'string', minLength: 1 },
                  minItems: 1,
                },
                snippets: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  };
}
