#!/usr/bin/env node

import { Command } from 'commander';
import { registerScanCommand } from './commands/scan.js';
import { registerReportCommand } from './commands/report.js';
import { registerDrillCommand } from './commands/drill.js';
import { registerFeedsCommand } from './commands/feeds.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerPurgeCommand } from './commands/purge.js';

const program = new Command();

program
  .name('signalforge')
  .description('Trend-driven opportunity detection engine')
  .version('1.0.0');

registerScanCommand(program);
registerReportCommand(program);
registerDrillCommand(program);
registerFeedsCommand(program);
registerValidateCommand(program);
registerPurgeCommand(program);

await program.parseAsync(process.argv);
