import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SignalForgeConfigSchema, type SignalForgeConfig } from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { ConfigError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const CONFIG_FILENAME = 'signalforge.config.json';
const GLOBAL_CONFIG_DIR = join(homedir(), '.config', 'signalforge');

function readJsonFile(filePath: string): unknown {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `Failed to read config file "${filePath}": ${(err as Error).message}`
    );
  }
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overrideVal = override[key];
    if (
      baseVal !== null &&
      overrideVal !== null &&
      typeof baseVal === 'object' &&
      typeof overrideVal === 'object' &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      );
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

export interface LoadConfigOptions {
  configPath?: string;
  cliOverrides?: Partial<Record<string, unknown>>;
}

export function loadConfig(options: LoadConfigOptions = {}): SignalForgeConfig {
  let merged: Record<string, unknown> = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;

  // Layer 2: global config
  const globalPath = join(GLOBAL_CONFIG_DIR, 'config.json');
  if (existsSync(globalPath)) {
    logger.debug('Loading global config', { path: globalPath });
    const globalConfig = readJsonFile(globalPath) as Record<string, unknown>;
    merged = deepMerge(merged, globalConfig);
  }

  // Layer 3: local config (or explicit path)
  const localPath = options.configPath ?? join(process.cwd(), CONFIG_FILENAME);
  if (existsSync(localPath)) {
    logger.debug('Loading local config', { path: localPath });
    const localConfig = readJsonFile(localPath) as Record<string, unknown>;
    merged = deepMerge(merged, localConfig);
  } else if (options.configPath) {
    throw new ConfigError(`Config file not found: ${options.configPath}`);
  }

  // Layer 4: CLI overrides
  if (options.cliOverrides) {
    merged = deepMerge(merged, options.cliOverrides as Record<string, unknown>);
  }

  // Validate
  const result = SignalForgeConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }

  return result.data;
}
