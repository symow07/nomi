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
 * 64 = a request to be deleted is written down (0064). `deletion_requests`,
 *      and three new verbs on `channel_audit`'s CHECK. Against a 63 database
 *      /app/settings/data throws on the missing table, and — the sharper
 *      edge — every EXPORT fails on the audit insert, because the constraint
 *      does not yet admit 'export_data'.
 * 68 = the outreach area is per workspace (0068). `businesses.outreach_area`,
 *      false by default, read on EVERY request (`workspaceFacts`) and at the
 *      send decision (`outreachFacts`). Against a 67 database every owner
 *      page throws on the missing column.
 * 69 = backup runs (0069). `backup_runs` is written by the scheduled backup
 *      job and READ once a day by this build to decide whether the owner must
 *      be told the backup is overdue, and by Getting ready to show "Backup
 *      tested" as checked for the owner. Against a 68 database the daily
 *      check throws and no alert can ever be sent — the silent failure the
 *      table exists to prevent.
 * 70 = the owner's Stop, on every channel (0070). `businesses.assistant_stopped_at`
 *      is read at the SEND gate and before every inbound turn, and the handoff
 *      a stopped assistant makes needs 'assistant_stopped' in two CHECKs.
 *      Against a 69 database every outbound drive and every inbound message
 *      throws on the missing column — nothing is sent and nothing is answered,
 *      which fails closed, but every buyer message would dead-letter.
 * 71 = the emergency silence hides nobody (0071). While `global_silence` is on,
 *      each buyer message is handed to a person with the 'ops_silenced' signal.
 *      Against a 70 database that insert fails the CHECK, so during an
 *      emergency every buyer message would dead-letter instead of waiting on
 *      "Needs you" — the moment it matters most.
 * 72 = the owner's words survive a refusal (0072, CC-24). `drafts.owner_edit`
 *      and `conversations.owner_unsent_reply` are read on every conversation
 *      page and written when a send is refused. Against a 71 database the
 *      conversation page throws on the missing columns.
 * 73 = a buyer's deletion request, and its deadline (0073, CC-02a). The daily
 *      check calls `deletion_requests_due()`, and the one-open-per-buyer index
 *      is what makes a second press "already asked". Against a 72 database the
 *      check throws every morning — the operator is never told a deletion is
 *      due, the silent failure the alert exists to prevent.
 * 74 = errors are written down (0074, CC-10). Every failure path — a page
 *      that crashed, a failed queue job, the process — upserts `app_errors`,
 *      and the operator alert is decided from its row. Against a database
 *      without it every recording fails; the recorder only logs that, so the
 *      app runs on — deaf, which is the state this migration ends.
 * 75 = a deletion request in chat goes to a person (0075). A buyer asking for
 *      their data to be deleted is handed over with the 'deletion_requested'
 *      signal. Against a 74 database that insert fails the CHECK, so the turn
 *      throws and the message dead-letters: nothing is sent — closed, as the
 *      owner wants — but the buyer never reaches "Needs you".
 * 76 = a deletion request in chat is written down when it arrives (0076).
 *      Every turn whose message asks writes `deletion_asks`, and the buyer's
 *      page, Your data, Today and the Buyers list read it. Against a 75
 *      database the turn throws on the missing table and the message
 *      dead-letters; every owner page that reads it throws.
 * 77 = a message nobody could read goes to a person (0077). When the
 *      analyser's answer to "does this buyer want a person?" cannot be read,
 *      or a turn fails until the queue gives up on it, the conversation is
 *      handed over with the 'not_answered' signal. Against a 76 database that
 *      insert fails the CHECK: the turn throws and dead-letters, and the dead
 *      letter's own hand-off fails the same way — the buyer never reaches
 *      "Needs you", the one thing this exists to do.
 * 78 = a login for a workspace that exists, and a link to choose its password
 *      (0078, tools/add-login.mjs). The door's `/login/set-password` asks
 *      `login_setup_open` / `login_setup_spend`; against a 77 database both
 *      are missing and the page answers 500 instead of "choose your password".
 * 79 = when the disclosure REACHED the buyer (0079). Every turn loads
 *      `conversations.ai_disclosure_delivered_at`; against a 78 database the
 *      select fails and no turn runs at all.
 * 80 = an order waits for the owner's tap (0080). A customer's "yes" writes an
 *      `order_proposals` row, and every draft and outbound message records the
 *      question it asks (`asks`); against a 79 database the turn's insert
 *      fails and no reply is written at all.
 * 81 = a product may have no minimum order (0081): `products.moq` takes NULL.
 *      Against an 80 database a product saved with no minimum fails the NOT
 *      NULL constraint, and so does every import line that states none.
 * 82 = the owner's own dates on the calendar (0082, `calendar_entries`). The
 *      calendar reads them for every view; against an 81 database the select
 *      fails and the calendar page answers 500 instead of the week.
 * 83 = what a reply promised, and for when (0083, `promised_dates`). Every
 *      sent message writes its promises; against an 82 database the insert
 *      fails inside the 'sent' transition and the message is never recorded
 *      as sent.
 * 84 = "e-mail me a link" (0084, `login_setup_request`). The door's "Forgot
 *      your password?" calls it; against an 83 database the call fails, and
 *      the owner is told a link is on its way that never is.
 * 85 = a send ceiling per workspace, and Meta's error rate (0085). The send
 *      gate reads `businesses.daily_send_ceiling`; against an 84 database the
 *      read fails and nothing the assistant writes is sent.
 * 86 = Practice, per workspace (0086): `businesses.practice_of`, the copy's
 *      source ids, `practice_refresh`. Practice opens the owner's copy with
 *      it; against an 85 database the call fails and Practice cannot start.
 * 87 = which copy is mine (0087): `practice_copy`, read-only. The Practice
 *      page and its live line find the copy with it; against an 86 database
 *      every Practice page view fails.
 * 88 = the platform's switch for Practice (0088): `practice_off` in
 *      `ops_flags`. No column is read, but the operator's row is refused by an
 *      87 database's check, so the switch this build reads could not be set.
 * 89 = Practice is not kept (0089): `practice_start_over`, `practice_expire`.
 *      Start over and the daily erasure call them; against an 88 database
 *      Start over fails.
 * 90 = Practice "as if sending alone" (0090): `businesses.practice_alone`,
 *      and the refresh that reads it. Practice's page reads the column.
 * 91 = what the owner has seen in Practice (0091): `practice_checks`,
 *      `practice_totals`. The Practice page writes both on every view.
 * 92 = one currency per workspace (0092): `businesses.currency`, the widened
 *      currency checks and price precision. Sign-up writes the column and
 *      every owner form reads it; against a 91 database sign-up fails.
 * 93 = two kinds of business (0093): 'online_shop' and 'startup'. Sign-up and
 *      the business page offer them; a 92 database refuses the row.
 * 94 = the import review, kept (0094): `catalog_imports`,
 *      `catalog_import_photos`, the product's source columns and
 *      `businesses.prices_to_owner`. Every import writes the first two; against
 *      a 93 database no list can be added.
 * 95 = how a business sells (0095): `businesses.quantity_first`. Every turn
 *      reads it; against a 94 database no turn can run.
 * 96 = "How you sell" (0096): `selling_answers`, and the audit verb
 *      `how_you_sell_saved`. Its pages read and write both; against a 95
 *      database none of its questions can be answered.
 * 97 = a reply the owner typed in Meta's own app (0097): `drafts.status`
 *      'superseded'. The echo it comes from supersedes the waiting reply;
 *      against a 96 database that write is refused.
 * 98 = the owner's phone and a reply that waited too long (0098):
 *      `push_subscriptions`, `expire_waiting_drafts()`. The alerts page and
 *      the ten-minute sweep read them; against a 97 database both fail.
 * 99 = what a self-serve sign-up leaves on the record (0099):
 *      `businesses.signed_up_at`, `auto_earned_at`, `terms_version`,
 *      `terms_accepted_at`, `self_serve_count()`, `signups_since()`. Every
 *      sign-up writes them; against a 98 database no workspace can be made.
 */
// 122 = a customer's name taken off a product (0122): `remove_product_alias`.
//       The product page's Remove calls it; against a 121 database it fails.
// 123 = customers' faces (0123): `client_faces`, `faces_due()`. Every page that
//       draws a face reads it; against a 122 database those pages fail.
// 124 = how a notification reaches each person (0124): `people.alert_channel`.
//       The two interruptions and the Notifications page read it; against a
//       123 database every hand-over alert fails.
// 125 = payment terms without a delivery term (0125): `trade_terms.incoterm` may be
//       null. The terms page saves "No delivery term"; against a 124 database that save fails.
// 129 = a reset link only to an address that answered (0129): `logins.email_verified_at`,
//       `login_email_proven()`. A code typed back on /verify writes it; against a 128
//       database that write fails and no reset link is ever mailed.
export const REQUIRED_SCHEMA_VERSION = 129;

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
