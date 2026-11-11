/** IP address and CIDR handling for the network inventory. */

export function parseIPv4(text: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return null;
  let value = 0;
  for (let i = 1; i <= 4; i++) {
    const part = match[i] as string;
    if (part.length > 1 && part.startsWith("0")) return null; // 010 is ambiguous (octal)
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

export function parseIPv6(text: string): bigint | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || text.includes(":::")) return null;
  let address = text;
  let tail: bigint[] = [];
  // An embedded IPv4 address (::ffff:1.2.3.4) takes the place of the last two groups.
  const lastColon = address.lastIndexOf(":");
  if (address.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(address.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [BigInt(Math.floor(v4 / 65536)), BigInt(v4 % 65536)];
    address = address.slice(0, lastColon + 1) + "0:0";
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): bigint[] | null => {
    if (part === "") return [];
    const groups: bigint[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(BigInt(`0x${group}`));
    }
    return groups;
  };
  const head = parse(halves[0] as string);
  const rest = halves.length === 2 ? parse(halves[1] as string) : [];
  if (head === null || rest === null) return null;
  let groups: bigint[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<bigint>(missing).fill(0n), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length) groups = [...groups.slice(0, 6), ...tail];
  return groups.reduce((acc, g) => (acc << 16n) | g, 0n);
}

export function isIPv4(text: string): boolean {
  return parseIPv4(text) !== null;
}

export function isIPv6(text: string): boolean {
  return parseIPv6(text) !== null;
}

export function isIpAddress(text: string): boolean {
  return isIPv4(text) || isIPv6(text);
}

export interface Cidr {
  version: 4 | 6;
  base: bigint;
  prefix: number;
}

export function parseCidr(text: string): Cidr | null {
  const [address, prefixText, ...extra] = text.split("/");
  if (
    extra.length ||
    address === undefined ||
    prefixText === undefined ||
    !/^\d{1,3}$/.test(prefixText)
  ) {
    return null;
  }
  const prefix = Number(prefixText);
  const v4 = parseIPv4(address);
  if (v4 !== null) {
    if (prefix > 32) return null;
    return { version: 4, base: networkBase(BigInt(v4), prefix, 32), prefix };
  }
  const v6 = parseIPv6(address);
  if (v6 !== null && prefix <= 128)
    return { version: 6, base: networkBase(v6, prefix, 128), prefix };
  return null;
}

function networkBase(address: bigint, prefix: number, bits: number): bigint {
  const hostBits = BigInt(bits - prefix);
  return (address >> hostBits) << hostBits;
}

export function isCidr(text: string): boolean {
  return parseCidr(text) !== null;
}

/** Is `address` inside `cidr`? False when either is malformed or the versions differ. */
export function cidrContains(cidr: string, address: string): boolean {
  const range = parseCidr(cidr);
  if (!range) return false;
  const value = range.version === 4 ? parseIPv4(address) : parseIPv6(address);
  if (value === null) return false;
  const bits = range.version === 4 ? 32 : 128;
  return networkBase(BigInt(value), range.prefix, bits) === range.base;
}

/** Usable host addresses of an IPv4 network (2 fewer than the size, except /31 and /32). */
export function ipv4HostCapacity(cidr: string): number | null {
  const range = parseCidr(cidr);
  if (!range || range.version !== 4) return null;
  const size = 2 ** (32 - range.prefix);
  return range.prefix >= 31 ? size : size - 2;
}

/** Whether two networks share any address (one contains the other's base address). */
export function cidrOverlaps(a: string, b: string): boolean {
  const left = parseCidr(a);
  const right = parseCidr(b);
  if (!left || !right || left.version !== right.version) return false;
  const shorter = Math.min(left.prefix, right.prefix);
  const bits = left.version === 4 ? 32 : 128;
  return networkBase(left.base, shorter, bits) === networkBase(right.base, shorter, bits);
}
