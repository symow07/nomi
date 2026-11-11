import type pg from 'pg';

/**
 * The authorization walk's check (b): which of a workspace's rows hold one of the other workspace's ids — anywhere in
 * the row, key or text or JSON — judged on WHOLE values (the re-verification's R4, 2026-11-11: the walk used to keep
 * twelve shapes per column, each cut at 160 characters, and judged only those, so a reference after a long typed
 * label was forgiven).
 *
 * ONE EXEMPTION, judged value by value: the owner's typed words stored as typed. `label` is an id field (labels) and a
 * free-text one (a phone's label on the pilot list, the audit line that records it). A value is forgiven only when every
 * one of the other workspace's ids in it is, ALONE, the whole value of a column named `label` or of a JSON key named
 * `label`. Any other occurrence — in another key, in a key's name, beside other words, in a value that does not parse —
 * counts.
 */

const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ONLY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const holds = (s: string, theirs: ReadonlySet<string>): boolean => (s.match(UUID_IN) ?? []).some((u) => theirs.has(u.toLowerCase()));

/** True when every one of `theirs` in `value` is the whole value of a `label` (the column, or a JSON key). */
export function onlyTypedLabels(column: string, value: string, theirs: ReadonlySet<string>): boolean {
  if (!holds(value, theirs)) return true;
  if (column === 'label') return ONLY_UUID.test(value) && theirs.has(value.toLowerCase());
  const t = value.trimStart();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return false; }
  const ok = (node: unknown, key: string | null): boolean => {
    if (typeof node === 'string') return !holds(node, theirs) || (key === 'label' && ONLY_UUID.test(node));
    if (Array.isArray(node)) return node.every((x) => ok(x, null));
    if (node && typeof node === 'object') {
      return Object.entries(node as Record<string, unknown>).every(([k, v]) => !holds(k, theirs) && ok(v, k));
    }
    return true;
  };
  return ok(parsed, null);
}

export type Held = { readonly n: number; readonly shapes: readonly string[] };

/**
 * Per `table.column`: how many of W's rows hold one of `theirs` outside a typed label, with up to three of those values
 * in full (every id shown as `U`), for the failure's message. Every matching value is read and judged whole.
 */
export async function heldBy(
  admin: pg.Client, scopes: readonly { table: string; where: string }[], w: string, theirs: ReadonlySet<string>,
): Promise<Map<string, Held>> {
  const out = new Map<string, Held>();
  if (theirs.size === 0) return out;
  const any = `(${[...theirs].join('|')})`;
  for (const s of scopes) {
    const rows = (await admin.query(`select k.key as col, k.value as v
        from ${s.table} x cross join lateral jsonb_each_text(to_jsonb(x)) k
        where (${s.where}) and k.value ~* $2`, [w, any])).rows as { col: string; v: string }[];
    for (const r of rows) {
      if (onlyTypedLabels(r.col, r.v, theirs)) continue;
      const key = `${s.table}.${r.col}`;
      const was = out.get(key) ?? { n: 0, shapes: [] };
      const shape = r.v.replace(UUID_IN, 'U');
      out.set(key, { n: was.n + 1, shapes: was.shapes.length < 3 && !was.shapes.includes(shape) ? [...was.shapes, shape] : was.shapes });
    }
  }
  return out;
}
