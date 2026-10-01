/**
 * KS6 — WHERE THE BUSINESS CAN BE SEEN, before its first channel connects: its
 * Facebook Page, its Instagram account or its website, as the owner types it.
 * The operator opens it to look at the business and what it sells.
 *
 * Pure. One address comes out, always https, host lower-cased; an Instagram
 * handle ("@rose.and.oak") becomes its profile's address. Null when what was
 * typed is not an address: the page says so beside the box.
 */
export function whereSeenFrom(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > 300) return null;
  const handle = /^@([A-Za-z0-9._]{1,30})$/.exec(v);
  if (handle) return `https://www.instagram.com/${handle[1]}`;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
  const path = url.pathname === '/' ? '' : url.pathname;
  return `https://${url.hostname.toLowerCase()}${path}${url.search}`;
}
