import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { validateReport } from '../validation/schema-validator.js';
import { logger } from '../utils/logger.js';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate <file>')
    .description('Validate a report JSON file against schemas/report.v1.json')
    .action(async (file: string) => {
      try {
        const raw = readFileSync(file, 'utf-8');
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          logger.error('Invalid JSON', { file });
          process.exitCode = 1;
          return;
        }

        const result = validateReport(data);

        if (result.ok) {
          process.stdout.write('Validation passed.\n');
          process.exitCode = 0;
        } else {
          process.stdout.write('Validation failed:\n\n');
          for (const err of result.errors) {
            process.stdout.write(`  - ${err}\n`);
          }
          process.stdout.write(`\n${result.errors.length} error(s) found.\n`);
          process.exitCode = 1;
        }
      } catch (err) {
        logger.error('Failed to read file', { file, error: (err as Error).message });
        process.exitCode = 1;
      }
    });
}
