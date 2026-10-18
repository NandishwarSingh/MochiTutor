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

/** A cap on calls per UTC day across every caller, so a public demo can't use up the API quota. 0 means no cap. */
export class DailyCap {
  private day = "";
  private count = 0;

  constructor(private readonly limit: number) {}

  /** Returns 0 when allowed, otherwise the milliseconds until the cap resets at UTC midnight. */
  take(now = Date.now()): number {
    if (this.limit <= 0) return 0;
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.count = 0;
    }
    if (this.count < this.limit) {
      this.count++;
      return 0;
    }
    return Date.parse(`${day}T00:00:00Z`) + 86_400_000 - now;
  }
}
