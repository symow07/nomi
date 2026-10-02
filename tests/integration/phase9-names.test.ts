import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * Phase 9 (V1-005) — the conversation page says the assistant's name only
 * once the owner chose it (rule 7). It read the row's default name straight,
 * so "Lily drafted", "How Lily read this" and "Lily is handling this" stood on
 * the page while Getting ready still asked the owner to choose a name.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd900000-0000-4000-8000-${RUN}0001`;
const CLIENT = `dd900000-0000-4000-8000-${RUN}0002`;
const CONV = `dd900000-0000-4000-8000-${RUN}0003`;

d('Phase 9 · the name on a conversation, only once chosen (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Name Test Shop') on conflict (id) do nothing`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Maya') on conflict (id) do nothing`.execute(t);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(t);
    });
  });
  afterAll(async () => { await db?.destroy(); });

  it('a default name nobody chose is not said; once confirmed, it is', async () => {
    const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
    const before = await loadConversationDetail(db, BIZ, CONV);
    expect(before?.assistantName ?? null).toBeNull();
    await tx((t) => sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
      on conflict (business_id) do update set assistant_named_at = now()`.execute(t));
    const after = await loadConversationDetail(db, BIZ, CONV);
    expect(after?.assistantName).toBe('Lily');
  });
});
