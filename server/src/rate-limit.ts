type Bucket = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const timestamp = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= timestamp) {
      this.buckets.set(key, { count: 1, resetAt: timestamp + this.windowMs });
      return true;
    }
    if (bucket.count >= this.maxRequests) return false;
    bucket.count += 1;
    return true;
  }
}
