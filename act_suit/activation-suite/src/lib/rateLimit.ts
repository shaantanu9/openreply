// Lightweight in-memory sliding-window rate limiter for public API routes.
// Per serverless instance (Fluid Compute reuses instances, so this catches the
// common bursts); the hard per-recipient caps in the DB are the real backstop.
//
// Usage:
//   const rl = checkRateLimit(`invite:${ip}`, 8, 600_000); // 8 / 10 min
//   if (!rl.ok) return NextResponse.json({ ok:false, error:"rate_limited" }, { status:429 });

type Hit = number[];
const buckets = new Map<string, Hit>();

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = xff.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return ip;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) || []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
    buckets.set(key, hits);
    return { ok: false, retryAfter: Math.max(1, retryAfter) };
  }
  hits.push(now);
  buckets.set(key, hits);
  // opportunistic cleanup so the map doesn't grow unbounded
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      const live = v.filter((t) => t > cutoff);
      if (live.length === 0) buckets.delete(k);
      else buckets.set(k, live);
    }
  }
  return { ok: true, retryAfter: 0 };
}
