export class TrendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: 0 | 1 | 2
  ) {
    super(message);
    this.name = 'TrendError';
  }
}

export class FeedFetchError extends TrendError {
  constructor(feedId: string, cause: Error) {
    super(`Feed ${feedId} failed: ${cause.message}`, 'FEED_FETCH_ERROR', 2);
    this.name = 'FeedFetchError';
    this.cause = cause;
  }
}

export class ProviderError extends TrendError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR', 1);
    this.name = 'ProviderError';
  }
}

export class ValidationError extends TrendError {
  public readonly validationErrors: string[];

  constructor(stage: string, errors: string[]) {
    super(
      `Validation failed for ${stage}: ${errors.join('; ')}`,
      'VALIDATION_ERROR',
      2
    );
    this.name = 'ValidationError';
    this.validationErrors = errors;
  }
}

export class ConfigError extends TrendError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 1);
    this.name = 'ConfigError';
  }
}

export class DatabaseError extends TrendError {
  constructor(message: string, cause?: Error) {
    super(message, 'DATABASE_ERROR', 1);
    this.name = 'DatabaseError';
    if (cause) {
      this.cause = cause;
    }
  }
}
