import { createHash } from 'node:crypto';
import { sql, type RawBuilder } from 'kysely';
import type { Tx } from './client.js';

export type CustomerPageOptions = { readonly after?: string; readonly before?: string; readonly size?: number };
export type CustomerPage<T> = { readonly rows: readonly T[]; readonly total: number; readonly from: number; readonly to: number; readonly next: string | null; readonly prev: string | null };
export const customerIdShape = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const literalLike = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export const customerPageSize = (size?: number): number => Number.isSafeInteger(size) ? Math.max(1, Math.min(100, size!)) : 50;
type Cursor = { readonly s: string; readonly at: string | null; readonly id: string };
type Position = { readonly position: number; readonly page_total: number; readonly stamp: string | null };

function cursorOf(raw: string | undefined, signature: string): Cursor | null {
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const c: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof c !== 'object' || c === null || !('s' in c) || c.s !== signature || !('id' in c) || typeof c.id !== 'string' || !customerIdShape(c.id) || !('at' in c)) return null;
    if (c.at !== null && (typeof c.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(c.at)
      || !Number.isFinite(Date.parse(c.at)) || new Date(c.at).toISOString().slice(0,19) !== c.at.slice(0,19))) return null;
    return {s:signature,id:c.id,at:c.at};
  } catch { return null; }
}

/** Source provides a unique uuid `id` and nullable timestamptz `order_at`.
 * Every count and position belongs to the same SQL snapshot as the page. A cursor carries microseconds,
 * never a JS-rounded date, and survives the boundary row moving or disappearing. No OFFSET or N+1 reads.
 */
export async function readCustomerKeyset<R extends { readonly id: string }>(
  tx: Tx, source: RawBuilder<unknown>, scope: readonly unknown[], o: CustomerPageOptions,
): Promise<CustomerPage<R>> {
  const size = customerPageSize(o.size);
  const signature = createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0,24);
  const cursor = o.after && o.before ? null : cursorOf(o.after ?? o.before, signature);
  const reverse = cursor !== null && !!o.before;
  const cut = cursor ? sql`(coalesce(order_at,'-infinity'::timestamptz),id) ${reverse ? sql`>` : sql`<`}
    (coalesce(${cursor.at}::timestamptz,'-infinity'::timestamptz),${cursor.id}::uuid)` : sql`true`;
  const rows = (await sql<R & Position>`
    with filtered as (${source}), ranked as (
      select *, (row_number() over (order by order_at desc nulls last,id desc))::int as position,
        to_char(order_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp from filtered
    ), page as (
      select * from ranked where ${cut}
      order by ${reverse ? sql`order_at asc nulls first,id asc` : sql`order_at desc nulls last,id desc`} limit ${size}
    )
    select page.*, totals.page_total from (select count(*)::int as page_total from filtered) totals
      left join page on true order by page.order_at desc nulls last,page.id desc`.execute(tx)).rows;
  const found = rows.filter((r) => r.id !== null);
  if (!found.length && cursor && (rows[0]?.page_total ?? 0) > 0) return readCustomerKeyset(tx,source,scope,{size});
  const first = found[0], last = found.at(-1), total = rows[0]?.page_total ?? 0;
  const encode = (r: R & Position): string => Buffer.from(JSON.stringify({s:signature,at:r.stamp,id:r.id})).toString('base64url');
  return {rows:found,total,from:first?.position ?? 0,to:last?.position ?? 0,
    prev:first && first.position > 1 ? encode(first) : null, next:last && last.position < total ? encode(last) : null};
}
