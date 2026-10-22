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
// 126 = a customer's data deleted when they ask, a workspace erased when it closes
//       (0126): `erase_customer`, `close_workspace`, `erasure_ledger`; RET retired.
//       The owner's two deletion buttons call them; against a 125 database both fail.
// 128 = the model provider's account (0128): `provider_health`, `provider_refusing()`,
//       the balance checks, and the hand-over reason 'provider_billing'. /health,
//       Today and every model call read or write them; against a 125 database each fails.
// 129 = a reset link only to an address that answered (0129): `logins.email_verified_at`,
//       `login_email_proven()`. A code typed back on /verify writes it; against a 128
//       database that write fails and no reset link is ever mailed.
// 130 = the advisor's memory, storage and deletion (0130): its four tables, the consent gate, `advisor_forget`,
//       the ledger's `advisor` kind, and a customer's erasure reaching the turns that name them.
// 131 = the age at sign-up (0131): `businesses.owner_adult_at`. Every sign-up writes it; against a 130 database
//       that write fails and no workspace can be made.
// 132 = an e-mail whose sender could not be confirmed (0132): the hand-off reason `email_unconfirmed`. Such a mail
//       hands its conversation to a person under it; against a 131 database that write fails.
// 133 = the business's postal address (0133): `businesses.postal_address`. Every first e-mail and follow-up reads it,
//       and the profile writes it; against a 132 database both fail.
// 134 = the refund terms (0134): `self_serve_trial_days()`, which the public /refunds page reads, and plans that
//       can only be monthly. Against a 133 database the page cannot draw its trial.
// 135 = a buyer who says stop (0135): `opt_outs`, `outbound_messages.notice`, `drafts.notice`, the hand-off reason
//       'opted_out'. Every turn and every send reads or writes them; against a 134 database each fails.
// 136 = sends a person approved (0136): `outbound_messages.approved`. Every queued row writes it and the send path reads
//       it; against a 135 database both fail.
// 137 = a sign-up is not kept (0137): `login_codes_forget`, which the daily ops.signup_expiry job calls, and
//       `otp_redeem` handing the form back once; against a 136 database the job fails.
// 138 = a sign-up's caller is forgotten (0138): `signup_throttles_forget`, which the same job calls; against a 137
//       database it fails.
// 139 = the same person on every channel (0139): `customer_same_person`, which the buyer page reads, and
//       `carry_out_customer_request` erasing every row of one person; against a 138 database the page fails.
// 140 = kept records stop describing an erased customer (0140): the erasure clears tracking numbers, update notes,
//       the request's note and a do-not-contact detail, and deletes a stop taken back; `customer_erasure_contract`
//       says so, and tools/erase-buyer.mjs refuses a database whose contract differs from its RULES.
// 141 = every ledger line reaches the operator's mailbox (0141): `erasure_ledger_unmailed`,
//       `erasure_ledger_mark_mailed`, which the fifteen-minute job and the erasure routes call; against a 140
//       database both fail.
// 142 = a customer's erasure reaches their words in Practice (0142): `practice_erase_conversations`, which
//       `practice_erase` and the erasure call; against a 141 database Start over and the thirty days fail.
// 143 = a customer's erasure takes every queued job that names them (0143): `erase_customer_rows_practice`
//       inside; tools/erase-buyer.mjs plans the same jobs, and against a 142 database its counts disagree.
// 144 = every business table is in the erasure's contract (0144): `customer_erasure_problems` refuses one that is
//       not; tools/erase-buyer.mjs's RULES name the same 55, and against a 143 database the contracts differ.
// 145 = an advisor conversation that outlives a customer's erasure loses its title (0145); the app reads '' as none.
// 146 = what is archived stops holding who someone was, or a way in (0146): triggers on people, logins,
//       push_subscriptions and mail_accounts.
// 147 = a deletion request nobody answers is chased (0147): `deletion_chases`, `claim_deletion_chases`, which the
//       daily ops.deletion_chase job calls; against a 146 database it fails.
// 148 = trial-abuse scoring (0148): `signup_marks`, `signup_risk`, the functions every sign-up calls and the
//       daily ops.signup_expiry job's `signup_marks_forget`; billing's trial and card read the risk. Against a 147
//       database every sign-up fails.
// 149 = the operator sees what the sign-up check did (0149): `signup_refusals`, `signup_mark_refused`, which a
//       refused sign-up calls, and `signup_check_since`, which the daily digest reads; against a 148 database the
//       digest fails.
// 150 = the morning summary (0150): `people.morning_summary`, `quiet_from`, `quiet_until`, `morning_summaries`,
//       `claim_morning_summaries` and `morning_summary_done`, which the fifteen-minute job and the notify worker
//       call; against a 149 database the job fails and Notifications cannot read the owner's switch.
// 151 = the proforma's link (0151): `orders.proforma_token` and `resolve_proforma`, which the order and conversation
//       pages and the public `/pi/:token` read; the customer's erasure clears it. Against a 150 database every order
//       page and every conversation with an order fails.
// 152 = a product's photo, kept and served (0152): `product_images.token`, `media_type`, `bytes`, `product_photo`
//       and `product_photo_remove`, which the product page, `/media/:token` and the conversation's photo list read.
//       Against a 151 database every product page fails.
// 153 = a buyer whose language has no signed disclosure goes to a person (0153): the `language_not_reviewed`
//       reason on both reason lists. Against a 152 database such a buyer's hand-over cannot be written, and the turn
//       fails instead of handing over.
// 154 = the pilot's own decisions, each with the day it ends (0154): `pilot_log.ends_on`, which
//       `tools/pilot-log.mjs` writes and reads. Against a 153 database the tool's `decision` and `triage` fail.
// 155 = a buyer's address is each workspace's own (0155): `client_channels` unique on (business_id, channel,
//       channel_user_id), which every new conversation's insert names. Against a 154 database that insert has no
//       matching key and every first message from a new buyer fails.
// 156 = a Chinese product name is found from the part of it a buyer says (0156): `alias_match`, which
//       `retrieve_products` and `tools/capability-sweep.mjs` call. Against a 155 database Chinese names are matched
//       by trigrams as before (a substring of a name scored 0.077) and the sweep's catalogue layer fails.
// 157 = a yes the list did not know goes to the owner (0157): the `maybe_confirmation` reason on both reason lists.
//       Against a 156 database such a buyer's hand-over cannot be written, and the turn fails instead.
// 158 = a reply that could not be written without a gender is a person's (0158): the `address_unwritten` reason on
//       both reason lists. Against a 157 database that hand-over cannot be written, and the turn fails instead.
// 159 = a language held out of one workspace (0159): `businesses.languages_held`, which every turn reads, and the
//       `language_held` reason on both reason lists. Against a 158 database every turn fails on the missing column.
// 160 = the languages an owner chose, told apart from the default (0160): `businesses.languages_chosen_at`, which
//       setting up and the products pages read, and the profile writes. Against a 159 database every page that
//       draws the setup count fails on the missing column.
// 161 = an order needs no e-mail (0161): `order_proposals.client_email` may be null, which a proposal for a buyer
//       who gave none writes. Against a 160 database such a proposal fails on the not-null column.
// 162 = each workspace numbers its own orders (0162): `order_numbers`, which every confirmed order raises, and the
//       reference unique per workspace (`orders_business_reference`) rather than across the installation.
// 163 = a withdrawal narrowed to its language (0163): `language_withdrawals`, which every turn that would send alone
//       reads, `capability_events.language`, and `claim_self_demotions()` returning `narrowed` / `everywhere`.
// 164 = a mailbox live in one workspace at a time (0164): `mail_accounts_one_live_address`, which a connect of an
//       address another workspace holds now meets as `address_taken`.
// 165 = the model's health from real calls (0165): `model_checks`, which every model call and the five-minute check
//       write and /health reads. Against a 164 database every model call's record fails (logged; the call is unharmed).
// 166 = every five-minute model check kept a month (0166): `model_check_log`, which the check appends to and
//       tools/model-uptime.mjs reads. Against a 165 database the check's history is not kept (logged).
// 167 = the deploy alarm (0167): `deploy_lag`, which the ten-minute look writes once per head of main an hour late.
// 168 = MAD, EUR and GBP (0168): the nine currency checks admit them. Against a 167 database a workspace in one of
//       them fails on its first write.
// 169 = the ledger (0169): accounts, journals, fiscal years, entries and lines, with the database's rules. Against a
//       168 database every books page fails on the missing tables.
// 170 = tax codes, parties and custom fields (0170), and the line's party, tax code and custom values.
// 171 = chart templates (0171): shared charts and journals, and `apply_chart_template`, which a workspace starts
//       its books from.
// 172 = a closing workspace keeps its books and its owner leaves with them (0172): `books_exports`,
//       `books_retention`, `businesses.books_held_until`, and the erasure that holds them.
// 173 = the books in one currency at the owner's rates (0173): the line's rate, its day and its book amounts.
// 174 = documents (0174): sealed, kept to their date, stored where the workspace's residency says.
// 175 = the accountant (0175): `people.kind`, an accountant's posting refused, closure waiting for the owner's copy.
// 176 = the books switched on per workspace (0176): `businesses.books_area`, which every page's facts read.
// 177 = an accountant sees the books and no row of the sales side, said by the database (0177): `viewer_is_accountant()`.
// 178 = what each connected system last said of each books record (0178): `connector_records`, the read-in's memory.
// 179 = the shop's own systems the books are connected to (0179): `books_connections`, Sheets and Odoo.
// 180 = the morning's read of every connected system (0180): `books_connections_due()`, the worker's list.
// 181 = a tax's start date is the owner's to confirm (0181): `tax_start_dates`, for taxes a system gave none.
// 182 = where the exchange difference goes (0182): the two exchange accounts, and the marked line only on them.
// 183 = an entry from a Nomi order, once (0183): the sales accounts in books_settings, `journal_entries.source_order_id`.
// 184 = invoices and payments (0184): numbered at issue with no gap, posted, paid in part or whole.
// 185 = reconciliation from statement files (0185): statement lines kept once, matches made and set aside by a person.
// 186 = what an accountant may not do to the books, said by the database (0186): invoices, payments, statements, matches.
// 187 = an issued invoice carries its customer as they were at issue; an order into the books goes through an invoice (0187).
// 188 = credit notes against issued invoices, numbered without a gap; refunds; payments checked with the invoice locked (0188).
// 189 = closing the books: a checklist, a lock only forward, a reopening recorded, a closing entry in its own journal (0189).
// 190 = the CGNC chart (modèle normal), read from the CNC's own text, as a chart template (0190).
// 191 = what a reader read from the books' papers, kept as read; one draft made from it, once (0191).
// 192 = custom fields travel with the books: a connector's record kind 'field'; only a party's field is required (0192).
// 193 = the shop's own Xero: its grant, its connection, its records, its taxes' start days (0193).
// 194 = the shop's own QuickBooks Online: its grant, its connection, its records (0194).
// 195 = saved replies: the words a workspace's people reuse when they answer a buyer (0195).
// 196 = labels on buyers: the workspace's own words to sort its buyers by, erased with the buyer (0196).
// 197 = a label on a buyer goes with the buyer: the customer erasure follows the new link (0197).
// 198 = hand-offs in turn: the switch, who is in turn and away, and when each was last given one (0198).
// 199 = the owner's decisions on answers people gave: taught or dismissed, by a digest of the question (0199).
// 200 = an accountant's write refused by the database on the rest of the books: parties, accounts, journals, tax codes, entries and lines (0200).
// 201 = staff get nothing of the books, said by the database: a team member's request sees and writes no row of them (0201).
// 202 = how did we do? one question after an order, asked only where free; the answer kept and erasable (0202).
// 203 = two more channels, the business's chat page and Telegram: the channel lists widened (0203).
// 204 = one Telegram bot for every business: which business a chat writes to, by the start link it opened last (0204).
// 205 = the owner's copy of their papers: an archive's receipt, and closure waiting for it (0205).
// 206 = the business's own ICE, IF and RC with its court, on its profile and in its FEC (0206).
// 207 = imported history kept as a document, marked "history, not in the books" (0207).
export const REQUIRED_SCHEMA_VERSION = 207;

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
