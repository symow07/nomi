import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * G7b — a price above what he was given waits for her, and her approval is
 * what makes it the price he has.
 *
 * Before G7b the contradiction was a refusal: no quote, the turn fell to the
 * `recommend` capability, and she was never asked. Approving the reply
 * recorded nothing, so he was refused again next time — and every DRAFTED
 * quote counted as history, including the ones she skipped, so a price he
 * never saw could become the baseline.
 *
 * Real turns on real repos against Postgres, with only the model faked:
 * approve → baseline; raise the price → held; skip → NOT the baseline; approve
 * → the new baseline; ask again → nothing to hold.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7b0000-0000-4000-8000-${RUN}0001`;
const PID = `dd7b0000-0000-4000-8000-${RUN}0002`;

d('G7b · a contradicting price waits for her, then becomes the baseline (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let bid: import('../../src/core/types/ids.js').BusinessId;
  let conv = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, bid, fn);
  };

  /** One real turn, computed AND committed, exactly as the worker does it. */
  const turn = async (text: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { hybridRetriever } = await import('../../src/retrieval/hybrid.js');
    const { computeTurn, commitTurn } = await import('../../src/pipeline/turn.js');
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: {
        primary: 'inquiry',
        productCandidate: { productId: PID as never, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
        quantityMentioned: { value: 5000, unit: 'pcs' }, nextLogicalQuestion: null, missingFields: [],
      },
      recommendedPhase: 'commercial_discussion',
    };
    const writer = new FakeReplyWriter();
    writer.replies = ['Here are the details for that volume.'];
    const req = { conversationId: conv as never, messageId: `g7b-${randomUUID()}`, text };
    return tx(async (t) => {
      const ports = {
        tenant: tenantRepos(t, bid), retriever: hybridRetriever(t, bid),
        analyzer, replyWriter: writer, now: () => new Date(),
      };
      const r = await computeTurn(ports, req);
      const fx = await commitTurn(ports, req, r, Date.now());
      return { r, fx };
    });
  };

  /** Her 发送 / 不回, through the one approval path. */
  const decide = async (draftId: string, rawReply: string) => {
    const { applyOwnerCommand } = await import('../../src/pipeline/approve.js');
    return applyOwnerCommand(
      { db, now: () => new Date(), kickOutbound: async () => {} },
      { businessId: bid, draftId, rawReply, decidedBy: 'owner' },
    );
  };

  const baseline = async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    return tx(async (t) => {
      const client = (await sql<{ client_id: string }>`
        select client_id::text from conversations where id = ${conv}::uuid`.execute(t)).rows[0]!.client_id;
      return (await tenantRepos(t, bid).audit.priorQuotesForClient(client as never, PID as never))
        .map((q) => q.unitPrice.amount);
    });
  };

  const pendingEvent = (draftId: string) => tx((t) => sql<{ payload: Record<string, unknown> }>`
    select payload from conversation_events
     where conversation_id = ${conv}::uuid and type = 'draft_pending' and payload->>'draftId' = ${draftId}
  `.execute(t).then((r) => r.rows[0]?.payload ?? null));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    db = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    bid = b.value;
    await tx(async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Contradiction Factory', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, ${'CT-' + RUN}, 'Canvas tote bag', 'pcs', 500, true)`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd, currency)
                values (${PID}, 1000, null, 0.40, 'USD')`.execute(t);
      await sql`insert into pricing_policy
                  (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
                values (${BIZ}, ${PID}, 0.30, 'USD', 10, 7)`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+97152${RUN}`}, 'Khalid') returning id::text as id`.execute(t)).rows[0]!.id;
      const repos = tenantRepos(t, bid);
      const state = await repos.conversations.create(client as never, 'whatsapp');
      conv = state.conversationId;
      await repos.conversations.saveState({
        ...state, phase: 'commercial_discussion',
        product: { productId: PID as never, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
        quantity: { value: 5000, unit: 'pcs' },
      });
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('a first price is only history once she has sent it', async () => {
    const { r, fx } = await turn('price for 5000?');
    expect(r.quote?.unitPrice.amount).toBe(0.40);
    expect(r.hold).toBeNull();
    expect(fx.draftCreated).not.toBeNull();       // draft-first: no grant
    expect(await baseline()).toEqual([]);          // pending — he has not seen it

    expect((await decide(fx.draftCreated!.draftId, '发送')).outcome).toBe('sent');
    expect(await baseline()).toEqual([0.40]);
  });

  it('SHE RAISES HER PRICE — the next quote is held, naming both prices', async () => {
    // Insert-only: a more specific tier for 4,000+ at $0.45.
    await tx((t) => sql`insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd, currency)
                        values (${PID}, 4000, null, 0.45, 'USD')`.execute(t));
    const { r, fx } = await turn('same again for 5000?');
    expect(r.quote?.unitPrice.amount).toBe(0.45);
    expect(r.hold).toBe('contradicts_history');
    expect(fx.outbound).toBeNull();

    const drafts = await tx((t) => sql<{ capability: string }>`
      select capability from drafts where id = ${fx.draftCreated!.draftId}::uuid`.execute(t).then((x) => x.rows));
    expect(drafts).toEqual([{ capability: 'quote' }]);   // priced, so the quote capability waits

    const payload = await pendingEvent(fx.draftCreated!.draftId);
    expect(payload).toMatchObject({
      heldBecause: 'contradicts_history',
      contradicts: { prior: { unitPrice: { amount: 0.40 } }, proposedUnitPrice: { amount: 0.45 } },
    });

    // She skips it. A price he never saw never becomes his baseline.
    expect((await decide(fx.draftCreated!.draftId, '不回')).outcome).toBe('skipped');
    expect(await baseline()).toEqual([0.40]);
  });

  it('asked again it is held again — and once she SENDS it, it is the price he has', async () => {
    const { r, fx } = await turn('any movement on price for 5000?');
    expect(r.hold).toBe('contradicts_history');
    expect((await decide(fx.draftCreated!.draftId, '发送')).outcome).toBe('sent');
    expect(await baseline()).toEqual([0.45, 0.40]);

    const next = await turn('ok, 5000 again please');
    expect(next.r.quote?.unitPrice.amount).toBe(0.45);
    expect(next.r.quote?.contradicts).toBeNull();
    expect(next.r.hold).toBeNull();
  });

  it('a rewritten draft never sets the baseline either — the price in her words is not ours to read', async () => {
    const { fx } = await turn('5000 pcs?');
    expect((await decide(fx.draftCreated!.draftId, '改 I can do a little better, let me check.')).outcome).toBe('edited_sent');
    expect(await baseline()).toEqual([0.45, 0.40]);
  });
});
