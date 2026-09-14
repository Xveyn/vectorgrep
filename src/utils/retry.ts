import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

/**
 * Retry an async function with exponential backoff.
 * Only retries on transient errors (network failures, 429, 5xx).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === opts.maxRetries || !isRetryable(lastError)) {
        throw lastError;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs
      );

      logger.warn(`${label} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), retrying in ${delay}ms`, {
        error: lastError.message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Check if an error is transient and worth retrying.
 */
function isRetryable(error: Error): boolean {
  const msg = error.message.toLowerCase();

  // Network errors
  if (msg.includes("fetch failed") || msg.includes("econnrefused") ||
      msg.includes("econnreset") || msg.includes("etimedout") ||
      msg.includes("socket hang up") || msg.includes("network")) {
    return true;
  }

  // Request aborted by its timeout (AbortSignal.timeout rejects with a TimeoutError)
  if (error.name === "TimeoutError" || msg.includes("timed out") || msg.includes("timeout")) {
    return true;
  }

  // HTTP 429 (rate limit) or 5xx (server errors)
  if (/\b(429|500|502|503|504)\b/.test(msg)) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
