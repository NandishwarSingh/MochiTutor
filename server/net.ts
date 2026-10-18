/** Address helpers for working out who is calling when the server sits behind a proxy. */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function stripMapped(ip: string): string {
  return ip.startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip;
}

/** Whether `ip` matches one of the entries: exact addresses or IPv4 CIDR ranges like 10.89.0.0/24. */
export function matchesAny(ip: string, entries: readonly string[]): boolean {
  const addr = stripMapped(ip);
  const n = ipv4ToInt(addr);
  for (const entry of entries) {
    const [base, bits] = entry.split("/");
    if (bits === undefined) {
      if (stripMapped(base) === addr) return true;
      continue;
    }
    const b = ipv4ToInt(base);
    const len = Number(bits);
    if (n === null || b === null || !Number.isInteger(len) || len < 0 || len > 32) continue;
    const size = 2 ** (32 - len);
    if (Math.floor(n / size) === Math.floor(b / size)) return true;
  }
  return false;
}

/**
 * The caller's address. X-Forwarded-For is only believed when the direct peer
 * is a trusted proxy, and then only its last entry, which that proxy wrote.
 */
export function clientAddress(direct: string, forwardedFor: string | null, trusted: readonly string[]): string {
  if (!forwardedFor || !matchesAny(direct, trusted)) return direct;
  const last = forwardedFor.split(",").at(-1)?.trim();
  return last || direct;
}
