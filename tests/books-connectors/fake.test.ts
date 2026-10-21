import { canonical, recordsOf, type BooksData } from '../../src/core/books/interchange.js';
import { refused, type BooksConnector, type Grant } from '../../src/core/books/connector.js';
import { conformance } from './conformance.js';
import { SAMPLE_BOOKS, SAMPLE_WITH_FIELDS } from './sample.js';

/**
 * B1 — a test fake: a system with a key and its OWN history (each record carries the version it last changed at, as
 * Odoo's write date does), so "changed since" is the system's narrowing, not only the read-in's. It passes the same
 * suite as the workbook.
 */
const remote = { clock: 0, versions: new Map<string, { content: string; version: number }>(), data: SAMPLE_BOOKS as BooksData };
const publish = (data: BooksData): void => {
  for (const r of recordsOf(data)) {
    const k = `${r.kind}:${r.key}`;
    if (remote.versions.get(k)?.content !== r.content) remote.versions.set(k, { content: r.content, version: ++remote.clock });
  }
  remote.data = data;
};
const fake: BooksConnector<{ readonly data: BooksData }, string> = {
  config: { system: 'odoo', fields: [{ name: 'url', kind: 'url', required: true }, { name: 'key', kind: 'secret', required: true }], signIn: 'key' },
  async connect(values) {
    if (values['key'] !== 'right-key') return refused('wrong_credentials');
    return { kind: 'connected', source: { data: remote.data }, grant: { secret: 'right-key', expiresAt: '2027-01-01' } };
  },
  async refresh(grant: Grant) { return grant; },
  async revoke() {},
  toBooks: (raw) => ({ data: JSON.parse(raw) as BooksData, problems: [], where: () => ({ sheet: '', row: 0 }) }),
  fromBooks: (d) => canonical(d),
  async changedSince(source, cursor) {
    const after = cursor === null ? 0 : Number(cursor);
    const keep = new Set([...remote.versions].filter(([, v]) => v.version > after).map(([k]) => k));
    const pick = <T>(kind: string, rows: readonly T[], key: (r: T) => string) => rows.filter((r) => keep.has(`${kind}:${key(r)}`));
    const d = source.data;
    return { kind: 'read', problems: [], cursor: String(remote.clock), where: () => ({ sheet: '', row: 0 }), data: {
      accounts: pick('account', d.accounts, (r) => r.code), journals: pick('journal', d.journals, (r) => r.code),
      parties: pick('party', d.parties, (r) => r.code), taxCodes: pick('tax_code', d.taxCodes, (r) => `${r.code}@${r.validFrom}`),
      entries: pick('entry', d.entries, (r) => r.key),
      ...(d.fields ? { fields: pick('field', d.fields, (r) => `${r.appliesTo}.${r.key}`) } : {}),
    } };
  },
};

conformance({
  name: 'a test fake with its own history',
  connector: fake,
  sample: SAMPLE_WITH_FIELDS,
  connectTo: (data) => { publish(data); return { url: 'https://books.example', key: 'right-key' }; },
  refusedWith: { values: { url: 'https://books.example', key: 'wrong-key' }, reason: 'wrong_credentials' },
});
