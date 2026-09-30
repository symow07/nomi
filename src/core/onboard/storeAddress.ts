/**
 * K8 — A STORE'S ADDRESS, AND WHERE NOMI MAY GO TO READ IT.
 *
 * The owner types her shop's address and Nomi's server fetches its public
 * product list. A server that fetches any address a stranger types is a way
 * into the server's own network (server-side request forgery): "http://
 * 169.254.169.254/" reads a cloud provider's secrets, "https://localhost/"
 * the app itself. So an address is read only when it is https, on the
 * standard port, a name (never a bare IP), and every address the name
 * resolves to is public — checked again at connect time by the fetcher
 * (src/net/publicFetch.ts), so a name that re-resolves between the check and
 * the connection cannot slip past it. Pure: no I/O.
 */

export type StoreAddress = { readonly ok: true; readonly origin: string; readonly host: string } | { readonly ok: false; readonly reason: 'not_an_address' | 'not_https' | 'not_public' };

/** The owner's typed address, as the store's origin: "myshop.com" becomes "https://myshop.com". */
export function readStoreAddress(raw: string): StoreAddress {
  const s = raw.trim();
  if (!s) return { ok: false, reason: 'not_an_address' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return { ok: false, reason: 'not_an_address' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (url.username || url.password) return { ok: false, reason: 'not_an_address' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'not_public' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // A bare IP, a single label ("intranet"), or a name that is private by its nature.
  if (isIpLiteral(host) || !host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(host)) {
    return { ok: false, reason: 'not_public' };
  }
  return { ok: true, origin: `https://${host}`, host };
}

const isIpLiteral = (h: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith('[') || h.includes(':');

/** An IPv4 address as its four numbers; null when it is not one. */
function v4(ip: string): readonly number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

/**
 * Is this resolved address on the public internet? Refused: loopback,
 * private (10/8, 172.16/12, 192.168/16), shared (100.64/10), link-local
 * (169.254/16 — the cloud metadata address among them), "this network",
 * multicast and reserved; for IPv6 the same kinds, and an IPv4 address
 * written inside one.
 */
export function isPublicAddress(ip: string): boolean {
  const a = v4(ip);
  if (a) {
    const [x, y] = [a[0]!, a[1]!];
    if (x === 0 || x === 10 || x === 127) return false;
    if (x === 100 && y >= 64 && y <= 127) return false;
    if (x === 169 && y === 254) return false;
    if (x === 172 && y >= 16 && y <= 31) return false;
    if (x === 192 && y === 168) return false;
    if (x === 192 && y === 0 && a[2] === 0) return false;
    if (x === 198 && (y === 18 || y === 19)) return false;
    if (x >= 224) return false;
    return true;
  }
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!s.includes(':')) return false;
  if (s === '::' || s === '::1') return false;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return isPublicAddress(mapped[1]!);
  if (/^f[cd]/.test(s)) return false;          // unique local, fc00::/7
  if (/^fe[89ab]/.test(s)) return false;       // link-local, fe80::/10
  if (/^ff/.test(s)) return false;             // multicast
  if (/^(2001:db8|2001:0db8)/.test(s)) return false; // documentation
  if (/^64:ff9b:/.test(s)) return false;       // an IPv4 address in translation
  return true;
}
