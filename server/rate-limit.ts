/** Fixed-window counter per key. Small and good enough for one laptop. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns 0 when allowed, otherwise the milliseconds until the next allowed call. */
  take(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      this.sweep(now);
      return 0;
    }
    if (entry.count < this.limit) {
      entry.count++;
      return 0;
    }
    return entry.start + this.windowMs - now;
  }

  private sweep(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) {
      if (now - entry.start >= this.windowMs) this.hits.delete(key);
    }
  }
}
