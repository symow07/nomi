/** Product returns can name only the catalogue, never another origin or a command. */
export function productReturnHref(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/app/products';
  try {
    const url = new URL(raw, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || url.pathname !== '/app/products') return '/app/products';
    const query = new URLSearchParams();
    const q = url.searchParams.get('q')?.trim().slice(0, 200); if (q) query.set('q', q);
    const page = Number(url.searchParams.get('page'));
    if (Number.isSafeInteger(page) && page > 1) query.set('page', String(page));
    const hash = /^#p-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.hash) ? url.hash : '';
    return url.pathname + (query.size ? `?${query}` : '') + hash;
  } catch { return '/app/products'; }
}
