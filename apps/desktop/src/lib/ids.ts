/**
 * UUID version 7 (RFC 9562): a millisecond timestamp followed by random bits. Keys sort
 * roughly by creation time, which keeps indexes compact, and every device can generate
 * them without asking a server, which is what makes offline work possible.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 48-bit big-endian timestamp. Date.now() is below 2^53 so plain arithmetic is exact.
  let remaining = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * An identifier derived from a name, the same on every device. Reference data that each
 * installation creates on its own (the chart of accounts, pipeline stages) must get the
 * same id everywhere; otherwise synchronising would see two different records with the
 * same account code.
 */
export async function namedId(name: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vyrion:${name}`));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5 (name based)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
