import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const suite = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
type Row = Record<string, unknown>;
const references = [
  ['follow_up_observations', 'client_id'], ['follow_up_observations', 'conversation_id'],
  ['follow_up_observations', 'quote_id'], ['follow_up_observations', 'outbound_id'], ['follow_up_observations', 'episode_message_id'],
  ['follow_up_runs', 'client_id'], ['follow_up_runs', 'conversation_id'], ['follow_up_runs', 'source_quote_id'],
  ['follow_up_runs', 'source_outbound_id'], ['follow_up_runs', 'episode_message_id'], ['follow_up_runs', 'draft_id'],
  ['follow_up_approvals', 'draft_id'], ['follow_up_approvals', 'run_id'], ['follow_up_approvals', 'conversation_id'], ['follow_up_approvals', 'outbound_id'],
  ...['follow_up_rules', 'follow_up_observations', 'follow_up_runs', 'follow_up_approvals'].map(table => [table, 'business_id'] as const),
] as const;

suite('Follow-up references stay in their workspace (requires DATABASE_URL)', () => {
  let admin: pg.Client, app: pg.Client;
  const insert = async (connection: pg.Client, table: string, row: Row) => connection.query(
    `insert into ${table} (${Object.keys(row).join(', ')}) values (${Object.keys(row).map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(row));
  async function fixture() {
    const business = randomUUID(), client = randomUUID(), conversation = randomUUID(), quote = randomUUID();
    const outbound = randomUUID(), message = randomUUID(), draft = randomUUID(), run = randomUUID();
    await insert(admin, 'businesses', { id: business, name: 'Reference test shop' });
    await insert(admin, 'clients', { id: client, business_id: business, display_name: 'Customer' });
    await insert(admin, 'conversations', { id: conversation, business_id: business, client_id: client, channel: 'telegram' });
    const product = randomUUID();
    await insert(admin, 'products', { id: product, business_id: business, sku: 'TEST', name: 'Test item', unit: 'item' });
    await insert(admin, 'quotes', { id: quote, business_id: business, conversation_id: conversation, product_id: product,
      quantity: 1, inputs: '{}', unit_price_usd: 12, total_usd: 12, engine_version: 'fixture' });
    await insert(admin, 'outbound_messages', { id: outbound, business_id: business, conversation_id: conversation, seq: 1, body: 'Quote', quote_id: quote });
    await insert(admin, 'messages', { id: message, conversation_id: conversation, direction: 'inbound', input_type: 'text', text_content: 'Question' });
    await insert(admin, 'drafts', { id: draft, business_id: business, conversation_id: conversation, capability: 'follow_up', draft_text: 'Owner words' });
    const runRow = { id: run, business_id: business, client_id: client, conversation_id: conversation, source_quote_id: quote,
      source_outbound_id: outbound, episode_message_id: message, episode_key: message, channel: 'telegram', quoted_at: new Date(),
      due_at: new Date(), delay_days: 2, wording: 'Owner words', draft_id: draft };
    await insert(admin, 'follow_up_runs', runRow);
    return { business, rows: {
      follow_up_rules: { business_id: business },
      follow_up_observations: { id: randomUUID(), business_id: business, kind: 'quote', client_id: client,
        conversation_id: conversation, quote_id: quote, outbound_id: outbound, episode_message_id: message,
        quoted_at: new Date(), delay_days: 2, wording: 'Owner words' },
      follow_up_runs: { ...runRow, id: randomUUID(), episode_key: randomUUID(), draft_id: null },
      follow_up_approvals: { business_id: business, draft_id: draft, run_id: run, conversation_id: conversation,
        outbound_id: outbound, approval_xid: 'fixture', approved_at: new Date() },
    } as Record<string, Row>, draft };
  }
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect();
    app = new pg.Client({ connectionString: process.env['DATABASE_URL'] }); await app.connect();
  });
  afterAll(async () => { await app?.end(); await admin?.end(); });

  it.each(references)('%s.%s rejects foreign INSERT and UPDATE, accepting the same workspace', async (table, column) => {
    const own = await fixture(), foreign = await fixture();
    const row = own.rows[table]!, bad = foreign.rows[table]!;
    // This reference is unique; give the tested run its own unlinked draft.
    if (table === 'follow_up_runs' && column === 'draft_id') {
      const id = randomUUID();
      await insert(admin, 'drafts', { id, business_id: own.business, conversation_id: row['conversation_id'], capability: 'follow_up', draft_text: 'Owner words' });
      row[column] = id; bad[column] = foreign.draft;
    }
    await app.query('begin');
    try {
      await app.query("select set_config('app.business_id', $1, true)", [own.business]);
      await app.query('savepoint candidate');
      // A changed business is refused by RLS or, first, its now-mismatched parent.
      const code = column === 'business_id' ? expect.stringMatching(/^(42501|23503)$/) : '23503';
      await expect(insert(app, table, { ...row, [column]: bad[column] })).rejects.toMatchObject({ code });
      await app.query('rollback to candidate');
      expect((await insert(app, table, row)).rowCount).toBe(1);
      const key = table === 'follow_up_rules' ? 'business_id' : table === 'follow_up_approvals' ? 'draft_id' : 'id';
      await app.query('savepoint changed');
      await expect(app.query(`update ${table} set ${column} = $1 where ${key} = $2`, [bad[column], row[key]]))
        .rejects.toMatchObject({ code });
      await app.query('rollback to changed');
      expect((await app.query(`update ${table} set ${column} = $1 where ${key} = $2`, [row[column], row[key]])).rowCount).toBe(1);
    } finally { await app.query('rollback'); }
  });
});
