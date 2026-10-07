import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db, Tx } from '../db/client.js';
import { parseBusinessId, type BusinessId } from '../core/types/ids.js';
import type { Locale } from '../core/owner/i18n/locale.js';
import { t } from '../api/web/say.js';
import { sealAdvisor, openAdvisor, type AdvisorKeys } from './seal.js';

/**
 * THE ADVISOR'S MEMORY (0130; docs/ADVISOR-MEMORY.md, the owner's decisions D1–D9 of 2026-10-07). Each
 * person's own advisor conversations, kept only with the workspace's switch (D1) and their own yes, sealed
 * with ADVISOR_KEY (D8), deleted every way through the erasure system that exists.
 *
 *   · The ONLY place the advisor's tables are written or its words opened. The advisor's routes are handed
 *     this port, never a writable pool (src/api/web/advisor.ts; tests/parity/advisor-build.test.ts).
 *   · Every call runs in a transaction that names the workspace AND the person (`app.person_id`), so row
 *     security answers whose history it is: nobody — the owner included — reads anyone else's (D2).
 *   · History only helps the advisor understand a follow-up; it is NEVER a source of facts. What a
 *     follow-up is given is `context`: at most the last three turns of this one conversation, as the
 *     question, the entry it resolved to and what it named — never an answer, a fact line or a figure.
 *   · Nothing of a question reaches a log: no call here logs, and a failure is a quiet "not kept".
 */

/** D3 — a conversation ends after this much quiet; the next question begins a new one. */
export const QUIET_HOURS = 4;
/** What a follow-up is given: at most this many turns, of this conversation only (§4). */
export const CONTEXT_TURNS = 3;
/** D6 — "Not now" is asked again once, this many days later; a second "Not now" ends the asking. */
export const ASK_AGAIN_DAYS = 90;
/** The longest title: the conversation's first question, cut. */
const TITLE_MAX = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The words asked, by version: the first 12 hex of the sha256 of the English sentence (as TERMS_VERSION). */
export const ASK_WORDING_VERSION = createHash('sha256').update(t('en', 'advisor.memory.ask')).digest('hex').slice(0, 12);

export type Params = {
  readonly period: string | null;
  readonly customer: string | null;
  readonly product: string | null;
  readonly reference: string | null;
};

/** One earlier turn, as a follow-up may see it: never its answer. */
export type Earlier = { readonly question: string; readonly entry: string; readonly params: Params };

export type MemoryState = {
  /** The owner switched it on for the workspace (D1). */
  readonly workspaceOn: boolean;
  /** This person's newest answer, if any. */
  readonly consent: 'granted' | 'refused' | 'withdrawn' | null;
  /** Since when it has been on for this person. */
  readonly since: Date | null;
  /** Kept now: the switch, their yes, a key to seal with, a real person. */
  readonly keep: boolean;
  /** The card is shown after their next answer (D6). */
  readonly ask: boolean;
  /** Why nothing can be kept or opened, when the key is the reason (D8). */
  readonly keyProblem: 'missing' | 'shape' | null;
  /** History needs a person on record: the installation's access-code session has none. */
  readonly person: boolean;
};

/** A turn as it is kept, and as it comes back. */
export type KeptTurn = {
  readonly question: string;
  readonly entry: string;
  readonly params: Params;
  readonly kind: 'fact' | 'none' | 'notStored' | 'opinion' | 'unknown' | 'failed';
  readonly text: string;
  readonly lines: readonly string[];
  readonly based: readonly string[];
  readonly phrased: boolean;
  readonly door: { readonly href: string; readonly label: string } | null;
};

export type ThreadRow = { readonly id: string; readonly startedAt: Date; readonly lastTurnAt: Date; readonly title: string | null };

export type Opened = { readonly id: string; readonly startedAt: Date; readonly lastTurnAt: Date; readonly turns: readonly (KeptTurn & { readonly askedAt: Date })[] };

/** Everything the advisor's routes and Settings may do with history. Nothing else touches its tables. */
export interface AdvisorMemory {
  state(businessId: string, personId: string, now: Date): Promise<MemoryState>;
  consent(businessId: string, personId: string, event: 'granted' | 'refused' | 'withdrawn', locale: Locale): Promise<'ok' | 'refused'>;
  workspace(businessId: string, personId: string, on: boolean): Promise<'ok' | 'refused'>;
  /** The conversation a question now continues: the latest, if its last turn is within the quiet hours. */
  current(businessId: string, personId: string, now: Date): Promise<string | null>;
  threads(businessId: string, personId: string): Promise<readonly ThreadRow[]>;
  /** One of their conversations, opened; `unreadable` when the key cannot open it; null when it is not theirs. */
  open(businessId: string, personId: string, threadId: string): Promise<Opened | 'unreadable' | null>;
  /** A follow-up's context: at most the last three turns of this conversation — never an answer. */
  context(businessId: string, personId: string, threadId: string): Promise<readonly Earlier[]>;
  /** Kept, in the conversation named or a new one; the conversation's id, or null when nothing was kept. */
  keep(businessId: string, personId: string, threadId: string | null, turn: KeptTurn & { readonly subjects: readonly string[]; readonly provider: string | null; readonly model: string | null }, now: Date): Promise<string | null>;
  /** One conversation of theirs, or all of a person's (the owner, unread: D2). */
  forget(businessId: string, callerId: string, personId: string, threadId: string | null): Promise<'ok' | 'refused' | 'none'>;
  /** The team the owner may delete history for, unread: names only, never whether they kept anything. */
  team(businessId: string, ownerId: string): Promise<readonly { readonly id: string; readonly name: string }[]>;
  /** Their own history, for their own download (D4): every turn they kept, and no one else's. */
  exportOwn(businessId: string, personId: string, locale: Locale): Promise<readonly (readonly string[])[]>;
}

const asParams = (v: unknown): Params => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
  return { period: s(o['period']), customer: s(o['customer']), product: s(o['product']), reference: s(o['reference']) };
};

export function advisorMemory(db: Db, keys: AdvisorKeys): AdvisorMemory {
  /** A transaction in this workspace, as this person: row security answers whose history it is. */
  async function asPerson<T>(businessId: string, personId: string, fn: (tx: Tx, bid: BusinessId) => Promise<T>): Promise<T | null> {
    const bid = parseBusinessId(businessId);
    if (!bid.ok || !UUID.test(personId)) return null;
    return db.transaction().execute(async (tx) => {
      await sql`select set_config('app.business_id', ${bid.value}, true), set_config('app.person_id', ${personId}, true)`.execute(tx);
      return fn(tx, bid.value);
    });
  }
  const seal = (plain: string) => sealAdvisor(keys, plain);
  const open = (c: string, w: string) => openAdvisor(keys, c, w);
  const code = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? '');

  /** A stale seal (the previous key) sealed again with the current one, on the way past (D8's rotation). */
  async function reseal(tx: Tx, table: 'advisor_turns' | 'advisor_threads', id: string, cols: Record<string, string>): Promise<void> {
    if (!keys.current) return;
    const sealed: Record<string, string> = {};
    for (const [c, plain] of Object.entries(cols)) {
      const s = seal(plain);
      if (!s) return;
      sealed[c] = s.ciphertext;
    }
    sealed['sealed_with'] = keys.current.id;
    if (table === 'advisor_turns') {
      await sql`update advisor_turns set question_ciphertext = ${sealed['question_ciphertext']}, params_ciphertext = ${sealed['params_ciphertext']},
                answer_ciphertext = ${sealed['answer_ciphertext']}, facts_ciphertext = ${sealed['facts_ciphertext']}, sealed_with = ${sealed['sealed_with']}
                where id = ${id}::uuid`.execute(tx);
    } else {
      await sql`update advisor_threads set title_ciphertext = ${sealed['title_ciphertext']}, sealed_with = ${sealed['sealed_with']} where id = ${id}::uuid`.execute(tx);
    }
  }

  type TurnRow = { id: string; asked_at: Date; entry_id: string; answer_kind: KeptTurn['kind']; door: string | null; phrased: boolean;
    question_ciphertext: string; params_ciphertext: string; answer_ciphertext: string; facts_ciphertext: string; sealed_with: string };

  /** A kept turn opened, or null if any of its words will not open. */
  function openTurn(r: TurnRow): (KeptTurn & { askedAt: Date; stale: boolean; raw: Record<string, string> }) | null {
    const q = open(r.question_ciphertext, r.sealed_with);
    const p = open(r.params_ciphertext, r.sealed_with);
    const a = open(r.answer_ciphertext, r.sealed_with);
    const f = open(r.facts_ciphertext, r.sealed_with);
    if (!q || !p || !a || !f) return null;
    let facts: { lines?: unknown; based?: unknown; label?: unknown } = {};
    let params: unknown = {};
    try { facts = JSON.parse(f.plain) as typeof facts; params = JSON.parse(p.plain); } catch { return null; }
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return {
      question: q.plain, entry: r.entry_id, params: asParams(params), kind: r.answer_kind, text: a.plain,
      lines: strings(facts.lines), based: strings(facts.based), phrased: r.phrased,
      door: r.door && typeof facts.label === 'string' ? { href: r.door, label: facts.label } : null,
      askedAt: r.asked_at, stale: q.stale || p.stale || a.stale || f.stale,
      raw: { question_ciphertext: q.plain, params_ciphertext: p.plain, answer_ciphertext: a.plain, facts_ciphertext: f.plain },
    };
  }

  const memory: AdvisorMemory = {
    async state(businessId, personId, now) {
      const person = UUID.test(personId);
      const keyProblem = keys.current ? null : keys.problem ?? 'missing';
      const r = await asPerson(businessId, personId, async (tx, bid) => {
        const b = (await sql<{ on_at: Date | null; practice: boolean }>`
          select advisor_history_at as on_at, practice_of is not null as practice from businesses where id = ${bid}`.execute(tx)).rows[0];
        const events = (await sql<{ event: MemoryState['consent']; at: Date }>`
          select event, at from advisor_consents where person_id = ${personId}::uuid order by seq desc`.execute(tx)).rows;
        return { b, events };
      }).catch(() => null);
      const workspaceOn = !!r?.b?.on_at && !r.b.practice;
      const newest = r?.events[0] ?? null;
      const consent = newest?.event ?? null;
      const refusals = r?.events.filter((e) => e.event === 'refused').length ?? 0;
      const granted = consent === 'granted';
      const ripe = newest !== null && now.getTime() - newest.at.getTime() >= ASK_AGAIN_DAYS * 86_400_000;
      return {
        workspaceOn, consent, since: granted ? newest!.at : null, keyProblem, person,
        keep: person && workspaceOn && granted && keyProblem === null,
        // D6: asked until answered; "Not now" asks once more 90 days later; a second "Not now", or a yes
        // taken back in Settings, ends the asking — Settings is then the only way.
        ask: person && workspaceOn && keyProblem === null && (consent === null || (consent === 'refused' && refusals === 1 && ripe)),
      };
    },

    async consent(businessId, personId, event, locale) {
      try {
        const r = await asPerson(businessId, personId, async (tx, bid) => {
          await sql`insert into advisor_consents (business_id, person_id, event, wording_version, locale)
                    values (${bid}, ${personId}::uuid, ${event}, ${ASK_WORDING_VERSION}, ${locale})`.execute(tx);
          // Taking it back deletes at once, in the same breath, with its ledger line.
          if (event === 'withdrawn') await sql`select advisor_forget(${personId}::uuid, null)`.execute(tx);
          return 'ok' as const;
        });
        return r ?? 'refused';
      } catch { return 'refused'; }
    },

    async workspace(businessId, personId, on) {
      try {
        const r = await asPerson(businessId, personId, async (tx) => {
          await sql`select advisor_history_set(${on})`.execute(tx);
          return 'ok' as const;
        });
        return r ?? 'refused';
      } catch { return 'refused'; }
    },

    async current(businessId, personId, now) {
      const r = await asPerson(businessId, personId, async (tx) => (await sql<{ id: string; last_turn_at: Date }>`
        select id::text as id, last_turn_at from advisor_threads where person_id = ${personId}::uuid order by last_turn_at desc limit 1`.execute(tx)).rows[0])
        .catch(() => null);
      return r && now.getTime() - r.last_turn_at.getTime() < QUIET_HOURS * 3_600_000 ? r.id : null;
    },

    async threads(businessId, personId) {
      const rows = await asPerson(businessId, personId, async (tx) => (await sql<{ id: string; started_at: Date; last_turn_at: Date; title_ciphertext: string; sealed_with: string }>`
        select id::text as id, started_at, last_turn_at, title_ciphertext, sealed_with from advisor_threads
         where person_id = ${personId}::uuid order by last_turn_at desc limit 50`.execute(tx)).rows).catch(() => null);
      return (rows ?? []).map((r) => ({ id: r.id, startedAt: r.started_at, lastTurnAt: r.last_turn_at, title: open(r.title_ciphertext, r.sealed_with)?.plain ?? null }));
    },

    async open(businessId, personId, threadId) {
      if (!UUID.test(threadId)) return null;
      const r = await asPerson(businessId, personId, async (tx): Promise<Opened | 'unreadable' | null> => {
        const th = (await sql<{ id: string; started_at: Date; last_turn_at: Date; title_ciphertext: string; sealed_with: string }>`
          select id::text as id, started_at, last_turn_at, title_ciphertext, sealed_with from advisor_threads
           where id = ${threadId}::uuid and person_id = ${personId}::uuid`.execute(tx)).rows[0];
        if (!th) return null;
        const rows = (await sql<TurnRow>`
          select id::text as id, asked_at, entry_id, answer_kind, door, phrased, question_ciphertext, params_ciphertext,
                 answer_ciphertext, facts_ciphertext, sealed_with
            from advisor_turns where thread_id = ${threadId}::uuid order by asked_at`.execute(tx)).rows;
        const turns = rows.map(openTurn);
        const title = open(th.title_ciphertext, th.sealed_with);
        if (!title || turns.some((x) => x === null)) return 'unreadable';
        // D5 counts from here: opened is kept another year.
        await sql`update advisor_threads set opened_at = now() where id = ${threadId}::uuid`.execute(tx);
        if (title.stale) await reseal(tx, 'advisor_threads', th.id, { title_ciphertext: title.plain });
        for (const [i, x] of turns.entries()) if (x!.stale) await reseal(tx, 'advisor_turns', rows[i]!.id, x!.raw);
        return {
          id: th.id, startedAt: th.started_at, lastTurnAt: th.last_turn_at,
          turns: turns.map((x) => { const { stale: _s, raw: _r, ...turn } = x!; return turn; }),
        };
      }).catch(() => null);
      return r;
    },

    async context(businessId, personId, threadId) {
      if (!UUID.test(threadId)) return [];
      const rows = await asPerson(businessId, personId, async (tx) => (await sql<{ entry_id: string; question_ciphertext: string; params_ciphertext: string; sealed_with: string }>`
        select entry_id, question_ciphertext, params_ciphertext, sealed_with from advisor_turns
         where thread_id = ${threadId}::uuid and person_id = ${personId}::uuid
         order by asked_at desc limit ${CONTEXT_TURNS}`.execute(tx)).rows).catch(() => null);
      const out: Earlier[] = [];
      // Only the question, the entry and what it named are opened: the answer is never read for a follow-up.
      for (const r of (rows ?? []).reverse()) {
        const q = open(r.question_ciphertext, r.sealed_with);
        const p = open(r.params_ciphertext, r.sealed_with);
        if (!q || !p) continue;
        let params: unknown = {};
        try { params = JSON.parse(p.plain); } catch { continue; }
        out.push({ question: q.plain, entry: r.entry_id, params: asParams(params) });
      }
      return out;
    },

    async keep(businessId, personId, threadId, turn, now) {
      const q = seal(turn.question);
      const p = seal(JSON.stringify(turn.params));
      const a = seal(turn.text);
      const f = seal(JSON.stringify({ lines: turn.lines, based: turn.based, ...(turn.door ? { label: turn.door.label } : {}) }));
      const title = seal(turn.question.slice(0, TITLE_MAX));
      if (!q || !p || !a || !f || !title) return null;
      try {
        return await asPerson(businessId, personId, async (tx, bid) => {
          let thread = threadId && UUID.test(threadId)
            ? (await sql<{ id: string }>`select id::text as id from advisor_threads where id = ${threadId}::uuid and person_id = ${personId}::uuid`.execute(tx)).rows[0]?.id ?? null
            : null;
          if (!thread) {
            thread = (await sql<{ id: string }>`
              insert into advisor_threads (business_id, person_id, started_at, last_turn_at, opened_at, title_ciphertext, sealed_with)
              values (${bid}, ${personId}::uuid, ${now}, ${now}, ${now}, ${title.ciphertext}, ${title.sealedWith})
              returning id::text as id`.execute(tx)).rows[0]!.id;
          }
          const entry = /^([A-I][0-9]{1,2}n?|unknown)$/.test(turn.entry) ? turn.entry : 'unknown';
          const door = turn.door && turn.door.href.startsWith('/app/') ? turn.door.href : null;
          const id = (await sql<{ id: string }>`
            insert into advisor_turns (thread_id, business_id, person_id, asked_at, question_ciphertext, entry_id, params_ciphertext,
                                       answer_kind, answer_ciphertext, facts_ciphertext, door, provider, model, phrased, sealed_with)
            values (${thread}::uuid, ${bid}, ${personId}::uuid, ${now}, ${q.ciphertext}, ${entry}, ${p.ciphertext}, ${turn.kind},
                    ${a.ciphertext}, ${f.ciphertext}, ${door}, ${turn.provider}, ${turn.model}, ${turn.phrased}, ${q.sealedWith})
            returning id::text as id`.execute(tx)).rows[0]!.id;
          // Every customer it named, so a customer's erasure finds this turn (§5c). Only real customers of this workspace.
          const subjects = [...new Set(turn.subjects.filter((s) => UUID.test(s)))];
          if (subjects.length) {
            await sql`insert into advisor_turn_subjects (turn_id, client_id, business_id)
                      select ${id}::uuid, c.id, ${bid} from clients c where c.id = any(${subjects}::uuid[]) and c.business_id = ${bid}
                      on conflict do nothing`.execute(tx);
          }
          await sql`update advisor_threads set last_turn_at = ${now}, opened_at = ${now} where id = ${thread}::uuid`.execute(tx);
          return thread;
        });
      } catch (e) {
        // NE020: the gate refused (no switch, no yes) — nothing kept, by design. Anything else: not kept either; never logged.
        void code(e);
        return null;
      }
    },

    async forget(businessId, callerId, personId, threadId) {
      if (!UUID.test(personId) || (threadId !== null && !UUID.test(threadId))) return 'none';
      try {
        const r = await asPerson(businessId, callerId, async (tx) => {
          await sql`select advisor_forget(${personId}::uuid, ${threadId}::uuid)`.execute(tx);
          return 'ok' as const;
        });
        return r ?? 'refused';
      } catch (e) {
        return code(e) === 'NE022' ? 'refused' : 'none';
      }
    },

    async team(businessId, ownerId) {
      const rows = await asPerson(businessId, ownerId, async (tx, bid) => (await sql<{ id: string; name: string }>`
        select id::text as id, name from people where business_id = ${bid} and not is_owner and archived_at is null order by name, id`.execute(tx)).rows)
        .catch(() => null);
      return rows ?? [];
    },

    async exportOwn(businessId, personId, locale) {
      const rows = await asPerson(businessId, personId, async (tx) => (await sql<TurnRow & { started_at: Date; title_ciphertext: string; thread_sealed: string }>`
        select t.id::text as id, t.asked_at, t.entry_id, t.answer_kind, t.door, t.phrased, t.question_ciphertext, t.params_ciphertext,
               t.answer_ciphertext, t.facts_ciphertext, t.sealed_with, th.started_at, th.title_ciphertext, th.sealed_with as thread_sealed
          from advisor_turns t join advisor_threads th on th.id = t.thread_id
         where t.person_id = ${personId}::uuid
         order by th.started_at, t.asked_at`.execute(tx)).rows).catch(() => null);
      const unreadable = t(locale, 'advisor.thread.unreadable');
      return (rows ?? []).map((r) => {
        const x = openTurn(r);
        const title = open(r.title_ciphertext, r.thread_sealed)?.plain ?? unreadable;
        const said = x ? (x.phrased || x.lines.length === 0 ? x.text : [x.text, ...x.lines].filter(Boolean).join('\n')) : unreadable;
        return [title, r.started_at.toISOString(), r.asked_at.toISOString(), x?.question ?? unreadable, said];
      });
    },
  };
  return memory;
}
