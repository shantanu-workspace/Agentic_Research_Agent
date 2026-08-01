import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Retry an async function with exponential backoff + jitter.
 * Used for both OpenAlex (which can rate-limit under load without a mailto param)
 * and Groq (which can transiently 429/500 under load).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { retries = 3, baseDelayMs = 500, label = "operation" } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const jitter = Math.random() * 200;
      const delay = baseDelayMs * 2 ** attempt + jitter;
      console.warn(
        `[withRetry] ${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${Math.round(delay)}ms:`,
        err instanceof Error ? err.message : err
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastErr;
}

/** Run async tasks with a concurrency cap — avoids hammering Groq with 25 parallel requests at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
