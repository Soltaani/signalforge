export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';
let jsonMode = false;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setJsonLogging(enabled: boolean): void {
  jsonMode = enabled;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatPlain(entry: LogEntry): string {
  const { level, msg, ts, ...extra } = entry;
  const tag = level.toUpperCase().padEnd(5);
  const extraStr = Object.keys(extra).length > 0
    ? ' ' + JSON.stringify(extra)
    : '';
  return `[${ts}] ${tag} ${msg}${extraStr}`;
}

function emit(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...extra,
  };

  const output = jsonMode ? JSON.stringify(entry) : formatPlain(entry);

  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stderr.write(output + '\n');
  }
}

export const logger = {
  debug(msg: string, extra?: Record<string, unknown>): void {
    emit('debug', msg, extra);
  },
  info(msg: string, extra?: Record<string, unknown>): void {
    emit('info', msg, extra);
  },
  warn(msg: string, extra?: Record<string, unknown>): void {
    emit('warn', msg, extra);
  },
  error(msg: string, extra?: Record<string, unknown>): void {
    emit('error', msg, extra);
  },
  /** Log a timed operation. Returns elapsed ms. */
  time(label: string): () => number {
    const start = performance.now();
    emit('debug', `${label} started`);
    return () => {
      const elapsed = Math.round(performance.now() - start);
      emit('info', `${label} completed`, { elapsedMs: elapsed });
      return elapsed;
    };
  },
};
