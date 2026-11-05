/** The only destination a conversation may use as its Inbox return address. */
export function safeInboxReturn(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//')) return null;
  try {
    const url = new URL(raw, 'https://nomi.invalid');
    if (url.origin !== 'https://nomi.invalid' || url.pathname !== '/app/inbox') return null;
    const query = new URLSearchParams();
    for (const key of ['filter', 'lens', 'q', 'label', 'stage', 'after', 'before']) {
      const value = url.searchParams.get(key);
      if (value !== null) query.set(key, value);
    }
    const anchor = /^#inbox-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(url.hash) ? url.hash : '';
    return '/app/inbox' + (query.size ? `?${query}` : '') + anchor;
  } catch { return null; }
}
