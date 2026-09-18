import { sql } from 'kysely';
import type { Db } from './client.js';

/**
 * M19.1 — does the database actually have the schema this build needs?
 *
 * The failure this prevents is specific and nasty: deploy code that expects
 * migration N while the database is still at N-1. `/health` probes with
 * `select 1`, which succeeds on the OLD schema, so the deployment looks green
 * while the send path is broken. In `disabled` mode nothing drives outbound, so
 * the breakage stays invisible until the exact moment WhatsApp is switched
 * on — the one step that cannot be undone.
 *
 * Enforced at BOOT (see `assertSchemaCurrent`, wired into buildProduction), and
 * again at activation. The boot gate is the one that matters: a release audit
 * found that a stale database booted clean and reported `{"ok":true,"db":true}`,
 * because the only caller was `activationPreconditions` — a function with no
 * production call site. A guard nothing calls is not a guard.
 *
 * It is deliberately NOT on /health — a public probe should not advertise the
 * schema version, for the same reason it does not advertise the commit (M17.1).
 */

/**
 * The migration this build requires. BUMP THIS when adding a migration whose
 * columns or tables the code reads — that is what makes the guard meaningful.
 * 26 = the runtime role is `nomi_app` (0026). This build accepts that name
 *      ALONE, so a database whose role is still `yiwuflow_app` cannot serve it
 *      — the guard would refuse at boot anyway, and refusing on the schema
 *      version says why. The release before this one accepted both.
 *
 * 25 = the product_edited / price_rules_set audit verbs (0025). No new column
 *      is READ, so the usual "does the code read something new?" test says no —
 *      but `channel_audit.action` is CHECK-constrained, and this build WRITES
 *      both verbs. Against a database at 24 the constraint rejects them, and
 *      the failure lands the moment an owner saves a price. A build that cannot
 *      record an owner's edit has no business accepting one, so it refuses at
 *      boot instead. The rule is "bump when the build REQUIRES the migration",
 *      of which reading a new column is only the commonest case.
 *
 * 27 = the audio_unheard signal kind and transcript_corrected audit verb
 *      (0027, M34). Same reasoning as 25: both columns are CHECK-constrained
 *      and this build WRITES both values — the first voice note that cannot be
 *      heard records the signal, the first transcript correction records the
 *      verb. Against a 26 database either write is rejected exactly when a
 *      buyer or an owner is waiting on it.
 *
 * 30 = money carries its currency (0030, M43a). This build READS `currency`
 *      from price_tiers, pricing_policy, quotes, orders and products on every
 *      quote it computes, and WRITES it on every price rule, import and
 *      recorded quote. Against a 29 database the read is a missing column, so
 *      the tier query throws — which is the entire pricing path. It refuses at
 *      boot rather than at the first buyer.
 *
 * 31 = the rate she stated (0031, M43b). The build READS `owner_rates` on the
 *      conversation surface and WRITES it from her settings page. Against a 30
 *      database the read is a missing TABLE, so every conversation detail
 *      throws — and the write, which is the only way a rate can exist at all,
 *      has nowhere to go.
 *
 * 32 = the factory closure calendar (0032, M44). Every quote READS
 *      `factory_closures` to decide whether it may promise a delivery date.
 *      Against a 31 database that read is a missing table, so the quote path
 *      throws — and the alternative, treating the failure as "no closures",
 *      would quote a date through her shutdown, which is the exact lie this
 *      milestone exists to stop.
 *
 * 33 = samples (0033, M45). The turn READS `sample_policy` to decide whether a
 *      sample price may enter the numeral allow-set, and WRITES
 *      `sample_requests` the moment a buyer asks. Against a 32 database the
 *      write is a missing table on the exact turn a buyer is waiting, and the
 *      read failing would look like "she has stated no policy" — a refusal
 *      caused by a stale schema rather than by her.
 *
 * 34 = after the order (0034, M46). The turn READS `order_updates` to answer
 *      "where is my order?" from a row rather than from a model, and the owner
 *      surface WRITES it. Against a 33 database the read throws on the exact
 *      turn a buyer is asking, and the write — the only way a state can change
 *      at all — has nowhere to go.
 *
 * 35 = more than one human (0035, M47). Login READS `people` to resolve a
 *      staff code, and the Buyers list reads it to name who holds what.
 *      Against a 34 database no staff member can log in at all — and the
 *      OWNER still can, deliberately: her code is the environment's and her
 *      row is only her name.
 *
 * 36 = who may be written to (0036, M38). `/app/contacts` reads all three
 *      tables and writes two of them, and every send in Block C will be gated
 *      on `suppressions`. Against a 35 database the page throws — which is the
 *      right failure, because the alternative shape of this bug is a gate that
 *      cannot find the suppression list and treats an empty answer as consent.
 *
 * 37 = writing first (0037, M42). `/app/channels` reads `outreach_settings` to
 *      show whether she has turned writing-first on, and writes it when she
 *      does. Against a 36 database the read throws, which is the honest
 *      failure. The other shape of this bug is a gate that cannot find her
 *      decision, reads the empty answer as "not enabled", and quietly refuses
 *      every message she believes she switched on.
 *
 * 38 = the sending domain (0038, M40.1). `/app/channels` reads
 *      `sending_domains` on every render — the e-mail card is built from it —
 *      and writes it when she names a domain or asks for another look. Against
 *      a 37 database the connections page throws. The alternative shape is
 *      worse than a throw: a check that cannot be stored is a check that
 *      never goes stale, and stale is the one state this table exists to catch.
 *
 * 39 = the 'media_unreadable' signal (0039, G2c). The worker records it the
 *      moment a buyer sends a document, a video or a location, and hands the
 *      conversation to a person. Against a 38 database that INSERT fails the
 *      CHECK, the job retries until it dead-letters, and the conversation is
 *      neither answered nor handed over — the file the buyer sent is exactly
 *      the thing that disappears.
 *
 * 40 = what a quote said about delivery (0040, G5). `recordQuote` writes
 *      `quotes.lead_time_days` and `lead_time_withheld` on every quote, and
 *      the buyer's proof page and the owner's closed-card read them. Against
 *      a 39 database the first quote fails its INSERT and the turn rolls back
 *      — she answers nobody who asks a price.
 *
 * 41 = her proforma terms (0041, G6). Confirming an order reads `trade_terms`
 *      and writes `orders.incoterm`, and the order page reads both. Against a
 *      40 database the confirmation throws and the buyer who said "yes" gets
 *      no order at all.
 *
 * 42 = the buyer's own reply window, and the 'unlisted_number' signal (0042,
 *      G10). Every inbound message writes `client_channels.last_inbound_at`
 *      and the send path reads it; a number not on her pilot list records
 *      the signal. Against a 41 database the webhook's write throws and no
 *      buyer's message is processed at all.
 *
 * 43 = the media id a voice note can be played from (0043, G13). Every voice
 *      message records it as it arrives. Against a 42 database that INSERT
 *      fails and no voice note is recorded at all — the message the owner
 *      most needs to see is the one that disappears.
 *
 * 44 = the checksum of each applied migration (0044, G20). Bookkeeping for
 *      `tools/migrate.mjs`, which the app itself never reads: a file that was
 *      applied and has since been edited on disk now stops the runner instead
 *      of being skipped by version number. A 43 database simply has no column
 *      to record it in, so the runner backfills on its next run.
 *
 * 45 = the SPF state the code has returned since G14 (0045). `no_sender` was
 *      in the type and not in the CHECK, so on a production without
 *      `SENDING_SPF_INCLUDE` — which is every production today — pressing
 *      "check my domain" raised a constraint violation. Against a 44 database
 *      that write still fails, which is why this bumps rather than being
 *      treated as cosmetic.
 *
 * 46 = an e-mail can exist (0046, C4.a). `conversations.channel` and
 *      `client_channels.channel` admit 'email'; the outbound row carries the
 *      channel that will fetch it and the subject an e-mail needs; `origin`
 *      admits 'outreach', the third kind of authorship. Against a 45 database
 *      every outreach insert fails on a column that is not there.
 *
 * 47 = a first e-mail and its follow-ups (0047, C4.b). `sequences`, their
 *      steps — frozen by trigger once she approves — enrolments with the stop
 *      vocabulary in a CHECK, and `sequence_sends`, the key that keeps a step
 *      from being queued twice. The sweep reads them every minute, so against a
 *      46 database the worker fails on its first tick.
 *
 * 48 = the reply is the opt-in (0048, C4.c). 'replied_to_email' consent, the
 *      'email_reply' signal, and `resolve_email_reply`, the security-definer
 *      lookup from the Message-ID he quoted to the mail she sent. Against a 47
 *      database his answer is refused by a CHECK and the webhook 500s.
 *
 * 49 = a source of prospects (0049, C5). `connector_credentials` (encrypted,
 *      one live per connector), `organization_enrichments` (per domain, for
 *      people to read), and 'apollo' as a contact source with a title. Against
 *      a 48 database the prospects page fails on its first read.
 *
 * 50 = the mailbox her e-mail leaves from (0050, C6). `mail_accounts`, one live
 *      per business, holding an encrypted refresh token and nothing that could
 *      send by itself. The mail transport reads it on every send, so against a
 *      49 database no e-mail can leave at all.
 *
 * 51 = a follow-up waits for a person when a reply could not be seen (0051).
 *      Confirmation columns on `sequence_enrollments` and the 'unconfirmed'
 *      stop. The sweep reads them every minute, so against a 50 database the
 *      first due follow-up fails.
 * 52 = a send whose outcome is unknown waits for a person (0052). The
 *      'uncertain' status. Against a 51 database the worker's first
 *      interrupted send fails on the CHECK — which is safe, but it fails
 *      every minute until someone migrates.
 * 53 = Instagram and Messenger (0053). The channel lists widen and
 *      `channel_credentials` learns 'messenger'; against a 52 database a
 *      buyer's Instagram message is acknowledged to Meta and dropped.
 */
export const REQUIRED_SCHEMA_VERSION = 59;

export type SchemaState = {
  readonly required: number;
  readonly actual: number | null;   // null = _migrations unreadable
  readonly ok: boolean;             // actual >= required
  readonly stale: boolean;          // actual < required — the dangerous case
};

/** Read the applied migration version. Never throws; an unreadable table is
 *  reported as null and treated as NOT ok. */
export async function readSchemaState(db: Db): Promise<SchemaState> {
  let actual: number | null = null;
  try {
    const r = await sql<{ v: number | null }>`select max(version)::int as v from _migrations`.execute(db);
    actual = r.rows[0]?.v ?? null;
  } catch {
    actual = null;                  // no _migrations table, or no permission
  }
  const ok = actual !== null && actual >= REQUIRED_SCHEMA_VERSION;
  return { required: REQUIRED_SCHEMA_VERSION, actual, ok, stale: actual !== null && actual < REQUIRED_SCHEMA_VERSION };
}

/**
 * Boot gate. In production a database behind this build REFUSES to serve: the
 * alternative is a green deployment whose send path throws on the first real
 * buyer. Outside production it warns, so a developer mid-migration is not
 * locked out of their own machine.
 *
 * A schema AHEAD of the build is fine — migrations are additive and forward-only
 * (ADR-0007), so an older build runs correctly against a newer schema. That is
 * what makes a rollback safe, and this gate must not take that away.
 */
export async function assertSchemaCurrent(
  db: Db,
  opts: { readonly production: boolean; readonly warn?: (msg: string) => void },
): Promise<SchemaState> {
  return enforceSchemaState(await readSchemaState(db), opts);
}

/** The decision, separated from the read so it can be tested for every state. */
export function enforceSchemaState(
  state: SchemaState,
  opts: { readonly production: boolean; readonly warn?: (msg: string) => void },
): SchemaState {
  if (state.ok) return state;

  const detail = state.actual === null
    ? 'the applied-migration table could not be read'
    : `the database is at migration ${state.actual}, this build needs ${state.required}`;
  const message =
    `Database schema is not current: ${detail}.\n` +
    'Apply the pending migrations before starting this build:\n' +
    '  MIGRATE_DATABASE_URL=<admin url> node tools/migrate.mjs';

  if (opts.production) throw new Error(message);
  (opts.warn ?? ((m: string) => console.warn(m)))(
    `WARNING (not enforced outside production):\n${message}`,
  );
  return state;
}
