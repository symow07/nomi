import { settingsHref } from './settingsNavigation.js';
import { markSmall } from '../../core/owner/brand.js';
import { dailyAssistantScreen } from './assistantArea.js';
import { rampState, type RampState } from '../../db/ramp.js';
import { loadReadiness } from '../../db/readiness.js';
import { rungOfLevel } from '../../core/trust/ramp.js';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { loadPendingSpotChecks, type PendingSpotCheck } from '../../pipeline/spotChecks.js';
import { promotionDecision } from '../../core/trust/evidence.js';
import { loadCapabilityEvidence, NON_PROMOTABLE } from '../../pipeline/capability.js';
import { AUTONOMY_LEVELS, levelOf, isAutonomyLevel, type AutonomyLevel } from '../../core/conversation/autonomyLevel.js';
import { SELF_DEMOTION_REASONS } from '../../pipeline/notify.js';
import { autonomyReleased, disclosureAwaitingReview, disclosureReviewed } from '../../core/conversation/disclosure.js';
import { STRICT_LOCALES, STRICT_SIGNED } from '../../core/conversation/strict.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { capabilityName, claimName, languageDisplay, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, tn, assistantName } from './say.js';
import { languageName } from './inbox.js';
import { labelled, formatList } from '../../core/owner/i18n/format.js';
import { esc, deeper, back, signalMark, conversationUrl, ASSISTANT_HOME, type Signal } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { assistantStopped } from '../../db/assistantStop.js';
import { loadKillSwitches } from '../../db/opsFlags.js';
import { anyConnected, connectedChannels } from '../../db/connectedChannels.js';
import { aloneNow, type AloneHold } from '../../core/conversation/aloneNow.js';
import { type IconId, GO } from './icons.js';
import { menuRow as settingsRow } from './settings.js';
import { DEFAULT_FOLLOW_UP_RULE, type FollowUpRule, type FollowUpRuleError } from '../../core/conversation/followUps.js';
import { pageHead, setSection, setNotice, saveForm, saveActs, rowAction } from './settingsPage.js';
import { wordsHtml } from './layout.js';
import * as show from './values.js';

/**
 * M9.6 + ADR-0008 — Employee Profile. A VIEW over the existing trust data
 * (autonomy_policy, capability_events, spot_checks, drafts-as-training) + the M5
 * promotion logic. The read model is language-NEUTRAL — capability codes, event
 * kinds, condition codes, a raw hire date; renderEmployee localizes. The employee
 * name is a per-locale product constant. No invented metrics.
 */

type Stage = 'probation' | 'partial';
type GrowthKind = 'promote' | 'revoke' | 'self_demote' | 'spotcheck_pass' | 'spotcheck_improve' | 'spotcheck_issue' | 'learned_edit';
type ConditionCode = 'passed_spotcheck' | 'learned_correction';

const NEVER_ALLOWED: readonly MessageKey[] = ['neverAllowed.promise_stock', 'neverAllowed.change_payment', 'neverAllowed.promise_leadtime'];

export type CapabilityRow = { readonly capability: string; readonly mode: 'auto' | 'draft'; readonly promotable: boolean };
export type GrowthEvent = {
  readonly kind: GrowthKind;
  readonly capability: string | null;
  readonly at: Date;
  /** M34.9 — the DemotionReason code, for a self-demotion only. */
  readonly why?: string | null;
  /** 0163 — the language a self-demotion was narrowed to; none = every language. */
  readonly language?: string | null;
};

export type EmployeeProfile = {
  readonly hireDate: Date | null;
  /**
   * Nomi Phase C — how many things she has been taught that are still current:
   * active knowledge the OWNER confirmed or corrected (seeded samples excluded,
   * because nobody taught those). Part of who she is, so it lives on her
   * profile. A real COUNT — never a mastery or coverage figure.
   */
  readonly knows: number;
  readonly stage: Stage;
  readonly canDo: readonly string[];       // auto capability codes
  readonly needConfirm: readonly string[]; // draft capability codes (excl. confirm_order)
  readonly capabilities: readonly CapabilityRow[];
  readonly growth: readonly GrowthEvent[];
  readonly promoted: boolean;
  readonly conditions: readonly { readonly cond: ConditionCode; readonly met: boolean }[];
  /**
   * Whether the owner has confirmed what buyers will call her assistant.
   *
   * On this page because this is the page where she decides what goes out
   * without her, and a message that goes out without her announces itself by
   * that name. Until it is confirmed, every capability she sets to auto still
   * drafts — so the page has to say so, or she sets a switch that does nothing.
   */
  readonly assistantNamed: boolean;
  /**
   * G4 (0102) — has this workspace earned sending alone? A workspace that
   * signed itself up has not until the ramp (or the operator) says so; until
   * then the page says replies wait, and offers only stepping down. Absent
   * reads as earned (every workspace the operator made).
   */
  readonly earned?: boolean;
  /**
   * R2 (0106) — the ramp, for a workspace that signed itself up: how far the
   * switch may go, and how close the next rung is ("14 of 20"). Absent for a
   * workspace the operator made.
   */
  readonly ramp?: RampState;
  /**
   * M34.7 — 抽查 waiting for the owner. This page is a READ MODEL and creates
   * none of them: they are written when work completes (pipeline/approve.ts),
   * so viewing this page stays free of side effects.
   */
  readonly spotChecks: readonly PendingSpotCheck[];
  /**
   * R5 (0109) — the level the owner last chose on this page, and when. Null
   * where none was chosen here (the capabilities were set one by one). Shown
   * beside what is in force when the system's own demotions moved it since.
   */
  readonly chosen?: { readonly level: AutonomyLevel; readonly at: Date } | null;
  /** R5 — each capability the system stepped back since that choice (or in the last 30 days): when and why. Newest per capability. */
  readonly stepped?: readonly {
    readonly capability: string; readonly at: Date; readonly reasons: readonly string[];
    /** 0163 — narrowed to this language, and whether that withdrawal still stands (the owner has not chosen again). */
    readonly language?: string | null; readonly open?: boolean;
  }[];
  /**
   * THE WARMTH RUN, phase 7 — what the menu's rows say before they are
   * opened: the products on sale (My business's own count) and the words the
   * owner forbade. Absent: the row says nothing rather than a guess.
   */
  readonly products?: number;
  readonly words?: number;
  /**
   * 0070 / 0071 (rule 13) — the owner's Stop, and the operator's pause. Either
   * one means nothing the assistant writes is sent, whatever level is chosen,
   * so the page says so beside the choice. Absent reads as answering.
   */
  readonly stopped?: boolean;
  readonly silenced?: boolean;
  /**
   * Phase 9 (rule 13) — some place a customer writes is connected (the one
   * definition, `connectedChannels`), so something the assistant writes could
   * reach a customer: the landing then offers the owner's Stop. Absent reads
   * as nothing connected.
   */
  readonly answering?: boolean;
  /**
   * Phase 9 (V1-420) — the name waiting to be confirmed: the main assistant's
   * row name as it stands. Shown on the Name screen, with Confirm, until the
   * owner confirms it; never shown as the name anywhere else (rule 7).
   */
  readonly pendingName?: string | null;
};

export async function loadEmployee(db: Db, businessIdRaw: string): Promise<EmployeeProfile> {
  const bid = parseBusinessId(businessIdRaw);
  const empty: EmployeeProfile = {
    hireDate: null, knows: 0, stage: 'probation', canDo: [], needConfirm: [], capabilities: [],
    growth: [], promoted: false, conditions: [], spotChecks: [], assistantNamed: false,
  };
  if (!bid.ok) return empty;
  // B16 — the ramp's "Practice checklist complete" reads what is written down; bring it in line with what the
  // practice copy shows first, as every other readiness count does (`loadReadiness`).
  await loadReadiness(db, bid.value);

  return withTenantTx(db, bid.value, async (tx) => {
    const onboard = (await sql<{ signup_at: Date | null; assistant_named_at: Date | null }>`
      select signup_at, assistant_named_at from onboarding_state
       where business_id = ${bid.value}`.execute(tx)).rows[0];

    const knows = (await sql<{ n: number }>`
      select count(*)::int as n from product_knowledge
       where business_id = ${bid.value} and status = 'active'
         and source in ('owner_confirmed', 'owner_corrected')`.execute(tx)).rows[0]!.n;

    const caps = (await sql<{ capability: string; mode: string }>`
      select capability, mode from autonomy_policy where business_id = ${bid.value} order by capability`.execute(tx)).rows;

    const capabilities: CapabilityRow[] = [];
    for (const c of caps) {
      const mode = c.mode === 'auto' ? 'auto' : 'draft';
      let promotable = false;
      if (mode === 'draft' && !NON_PROMOTABLE.includes(c.capability)) {
        promotable = promotionDecision(await loadCapabilityEvidence(tx, c.capability)).eligible;
      }
      capabilities.push({ capability: c.capability, mode, promotable });
    }

    const canDo = capabilities.filter((c) => c.mode === 'auto').map((c) => c.capability);
    const needConfirm = capabilities.filter((c) => c.mode === 'draft' && c.capability !== 'confirm_order').map((c) => c.capability);

    // Growth timeline — neutral event kinds; the renderer localizes. Most recent 8.
    const growth = (await sql<{ kind: string; capability: string | null; at: Date; why: string | null; language: string | null }>`
      -- M34.9 — a demotion SHE made reads differently from one the owner made.
      -- Collapsing both into 'revoke' would let the owner think he had pulled
      -- a capability back when in fact she stepped back on her own.
      (select case when action = 'promote' then 'promote'
                   when actor = 'system_self_demoted' then 'self_demote'
                   else 'revoke' end as kind,
              capability, at, reasons[1] as why, language
         from capability_events where business_id = ${bid.value})
      union all
      (select case when verdict = 'correct' then 'spotcheck_pass'
                   when verdict = 'needs_improvement' then 'spotcheck_improve'
                   else 'spotcheck_issue' end, null::text, answered_at, null::text, null::text
         from spot_checks where business_id = ${bid.value} and answered_at is not null)
      union all
      (select 'learned_edit', capability, decided_at, null::text, null::text
         from drafts where business_id = ${bid.value} and status = 'edited' and decided_at is not null)
      order by at desc limit 8
    `.execute(tx)).rows.map((r): GrowthEvent => ({
      kind: r.kind as GrowthKind, capability: r.capability, at: r.at, why: r.why, language: r.language,
    }));

    const passed = (await sql<{ n: number }>`select count(*)::int as n from spot_checks where verdict='correct'`.execute(tx)).rows[0]!.n;
    const learned = (await sql<{ n: number }>`select count(*)::int as n from drafts where status='edited'`.execute(tx)).rows[0]!.n;
    const promoted = canDo.length > 0;

    // R5 — the level the owner chose, and the system's own steps back since.
    const chose = (await sql<{ level: string | null; at: Date | null }>`
      select autonomy_level_chosen as level, autonomy_level_chosen_at as at from businesses where id = ${bid.value}`.execute(tx)).rows[0];
    const chosen = chose?.level && chose.at && isAutonomyLevel(chose.level) ? { level: chose.level, at: chose.at } : null;
    // 0163 — a step back narrowed to one language is listed while it stands, however long ago; one in every language
    // as before, since the level was chosen (or in the last 30 days).
    const stepped = (await sql<{ capability: string; at: Date; reasons: string[]; language: string | null; open: boolean }>`
      select distinct on (e.capability, coalesce(e.language, '')) e.capability, e.at, e.reasons, e.language,
             (e.language is not null and exists (select 1 from language_withdrawals w
               where w.business_id = e.business_id and w.capability = e.capability
                 and w.language = e.language and w.lifted_at is null)) as open
        from capability_events e
       where e.business_id = ${bid.value} and e.actor = 'system_self_demoted'
         and (e.language is not null
              or e.at >= coalesce(${chosen?.at ?? null}::timestamptz, now() - interval '30 days'))
       order by e.capability, coalesce(e.language, ''), e.at desc`.execute(tx)).rows
      .filter((r) => r.language === null || r.open);

    // Phase 7 — the rows' values: counted where My business and the forbidden
    // words page count them, so the two doors never disagree.
    const tallies = (await sql<{ products: number; words: number }>`
      select (select count(*)::int from products where business_id = ${bid.value} and is_active) as products,
             (select count(*)::int from forbidden_terms where business_id = ${bid.value} and archived_at is null) as words
    `.execute(tx)).rows[0];

    const pending = (await sql<{ name: string | null }>`
      select name from assistants where business_id = ${bid.value} and is_default and archived_at is null limit 1`.execute(tx)).rows[0]?.name ?? null;

    return {
      products: tallies?.products ?? 0,
      words: tallies?.words ?? 0,
      stopped: await assistantStopped(tx, bid.value),
      silenced: (await loadKillSwitches(tx, bid.value)).globalSilence,
      answering: anyConnected(await connectedChannels(tx, bid.value)),
      pendingName: pending,
      hireDate: onboard?.signup_at ?? null,
      knows,
      chosen,
      stepped: stepped.map((r) => ({ capability: r.capability, at: r.at, reasons: r.reasons ?? [], language: r.language, open: r.open })),
      spotChecks: await loadPendingSpotChecks(tx, bid.value),
      stage: promoted ? 'partial' : 'probation',
      canDo, needConfirm, capabilities, growth, promoted,
      assistantNamed: onboard?.assistant_named_at != null,
      ...(await rampState(tx, bid.value).then((ramp) => ({ earned: ramp.rung >= 1, ...(ramp.gated ? { ramp } : {}) }))),
      conditions: promoted ? [] : [
        { cond: 'passed_spotcheck', met: passed > 0 },
        { cond: 'learned_correction', met: learned > 0 },
      ],
    };
  });
}

/** ── Renderer (pure, mobile-first, localized) ─────────────────────────────── */

/*
 * THE WARMTH RUN (2026-10-03), phase 7 — THE SETTINGS MODEL. The owner: "it
 * reads like a Word document". The page was one long scroll of ten sections
 * of prose; it is now a calm menu that opens one level deeper, the iPhone way.
 *
 *   the landing   the name; the control for how much the assistant does
 *                 alone, whole and usable, with everything that holds it
 *                 (rule 1's native read, rule 2's name, rule 13's Stop and the
 *                 operator's pause) said beside it; then the menu — rows in
 *                 three groups, each with its shape, its name, where it stands
 *                 now, and the door.
 *   a screen      one former section, its words and its controls unchanged,
 *                 under a way back to the menu (`<ASSISTANT_HOME>/<screen>`).
 *
 * THE ADVISOR RUN (2026-10-06) — all of it one level into Settings: Settings' first row opens the landing
 * (`ASSISTANT_HOME`, `/app/settings/assistant`), the control still first and whole; `/app/employee` redirects.
 *
 * Nothing here moved where it is edited: the business's facts and products
 * stay My business's ("two doors, one data" — the "can talk about" screen
 * reads them and opens them there), taught knowledge stays /app/knowledge,
 * the forbidden words their own page, Practice its own room.
 */

/** Phase 7 — the screens one row each opens, in the menu's order. */
/*
 * The settings overhaul (rule 104) — "How sending without you works" (`alone`) is cut as a page: its state is on Reply
 * permissions and its explanation in that page's help. The name is Settings › Assistant › Name and identity, drawn by
 * assistantSettings.ts. Each kind of reply, one kind at a time and what comes next are sections of Reply permissions.
 */
export const EMPLOYEE_SCREENS = ['talk', 'learning', 'checks', 'month', 'history'] as const;
/** Settings › Assistant › Name and identity. */
export const NAME_HOME = `${ASSISTANT_HOME}/name`;
/** The one route that collects Reply permissions' fields: the level and the follow-up rule (app.ts). */
export const PERMISSIONS_SAVE = `${ASSISTANT_HOME}/save`;
export type EmployeeScreen = typeof EMPLOYEE_SCREENS[number];
export const screenHref = (s: EmployeeScreen): string => dailyAssistantScreen(s) ?? settingsHref(`${ASSISTANT_HOME}/${s}`);

/** Each screen's heading — the row's own words, so the row, the tab and the heading say one thing. */
const SCREEN_TITLE: Readonly<Record<EmployeeScreen, MessageKey>> = {
  talk: 'her.talk.title', learning: 'her.teach.title',
  checks: 'spotcheck.title', month: 'her.recent.title', history: 'employee.growth.title',
};
export const screenTitle = (locale: Locale, s: EmployeeScreen): string => t(locale, SCREEN_TITLE[s]);

/*
 * Phase 9 — the history ("What changed") carries no state marks: an event
 * that happened is not a state, and ✕ is "it went wrong", not "it waits for
 * you again". The words say what happened; the date says when.
 *
 * A task list is a list, not a stack of cards: nothing in it can be pressed.
 * A state's shape is drawn in its own colour (`signalMark`); a group that is
 * a standing rule ("always waits for you") carries no shape at all, so it is
 * told apart from "waits for you" by more than its colour.
 */
/**
 * Nomi Phase C — the rest of "who is she today?", composed by the route from
 * read models that already exist (M13/M14 knowledge, the operations snapshot,
 * the pilot feedback loop). Structurally typed so this module imports nothing
 * new and cannot create a cycle. Counts only; no rate, no score.
 */
export type HerContext = {
  readonly taughtRecently: number;      // facts added in range (M14)
  readonly corrected: number;           // answers you corrected in range (M14)
  readonly handled: number;             // conversations she handled (M16.2a)
  readonly draftsPrepared: number;
  readonly neededYou: number;           // DISTINCT conversations a human stepped into
  readonly gaps: readonly { readonly question: string; readonly count: number }[];
};

/**
 * Phase 7 — TWO DOORS, ONE DATA. What the assistant answers from, as My
 * business keeps it: read by the route through the very loaders My business
 * uses (`loadBusinessProfile`, `loadHub`, `loadProductList`), summarised
 * here, and opened there. Nothing on this screen is a form: a fact or a
 * product is changed in the one place it lives. Structurally typed, like
 * `HerContext`, so this module imports none of those pages.
 *
 * The warmth run, phase 9 (w4-products-knowledge-01, -03) — and everything
 * else it answers from: what was taught (Knowledge), and the certifications,
 * the one list that decides what may be claimed at all. The profile's row
 * says where it stands as My business says it, never the business's name the
 * page already shows.
 */
export type TalkAbout = {
  /** The profile holds what setting up asks of it: My business's own `profileFinished`, so the two rows say one thing (w4-business-assistant-31). */
  readonly finished: boolean;
  /** How you sell: answered of asked; null where it could not be read. */
  readonly selling: { readonly answered: number; readonly total: number } | null;
  /** The products on sale, and a few of their names for recognition, already in the page's language. */
  readonly products: { readonly total: number; readonly names: readonly string[] };
  /** Facts taught, about the business and its products (Knowledge). */
  readonly taught: number;
  /** The certifications switched on, by their key (`claimName` says them). */
  readonly certs: readonly string[];
};

/** What a screen may be given beyond the profile and the month's counts. */
export type ScreenExtras = { readonly talk?: TalkAbout };

const countRow = (value: number, label: string): string =>
  `<div class="hrow"><span class="hnum">${value}</span><span class="hlabel">${esc(label)}</span></div>`;

/**
 * Phase 9 — a count said as a sentence in the form its language gives that
 * number (Arabic: «ردّان جاهزان», «3 ردود», «11 ردًّا»; Spanish: "1 conversación
 * necesitó" / "2 conversaciones necesitaron"), the figure itself in bold. A
 * figure beside a fixed plural read as an error in Arabic.
 */
function countLine(locale: Locale, base: string, n: number): string {
  const said = esc(tn(locale, base, n));
  const figure = esc(new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale).format(n));
  const at = said.indexOf(figure);
  const html = at < 0 ? said : `${said.slice(0, at)}<b class="hnum">${esc(show.count(locale, n))}</b>${said.slice(at + figure.length)}`;
  return `<div class="hrow"><span class="hlabel">${html}</span></div>`;
}

/** 1 · What does she know? Her learning, in her terms — never a "database". */
// Phase 9 (w4-business-assistant-33) — "What {name} knows" is the landing's
// row; here the counts and the one door to Knowledge follow the questions,
// under no second heading of the same name.
function knowsSection(e: EmployeeProfile, c: HerContext | undefined, locale: Locale): string {
  if (e.knows === 0 && (!c || (c.taughtRecently === 0 && c.corrected === 0))) {
    return `<div class="block">
      <div class="empty">${esc(t(locale, 'her.knows.none'))}</div>
      ${deeper('/app/assistant/knowledge', t(locale, 'knowledge.teach'))}</div>`;
  }
  return `<div class="block">
    <div class="hrows">
      ${countRow(e.knows, t(locale, 'her.knows.count'))}
      ${c ? countRow(c.taughtRecently, t(locale, 'her.knows.recent')) : ''}
      ${c ? countRow(c.corrected, t(locale, 'her.knows.corrected')) : ''}
    </div>
    ${deeper('/app/assistant/knowledge', t(locale, 'knowledge.teach'))}</div>`;
}

/** 3 · What did she do recently? Real counts, no rate. The screen's heading names the span. */
function recentBody(c: HerContext | undefined, locale: Locale): string {
  if (!c) return '';
  const quiet = c.handled === 0 && c.draftsPrepared === 0 && c.neededYou === 0;
  return `<div class="block">
    ${quiet ? `<div class="empty">${esc(t(locale, 'her.recent.quiet'))} ${esc(t(locale, 'her.recent.noneWhy'))}</div>`
      : `<div class="hrows">
          ${countLine(locale, 'her.count.handled', c.handled)}
          ${countLine(locale, 'her.count.drafts', c.draftsPrepared)}
          ${countLine(locale, 'her.count.needed', c.neededYou)}
         </div>`}</div>`;
}

/** 4 · What still needs teaching? Each item leads to the EXISTING teach flow. */
function teachBody(c: HerContext | undefined, locale: Locale): string {
  if (!c) return '';
  if (c.gaps.length === 0) {
    // Phase F: "she answered everything you taught" is only TRUE once she has
    // answered something. On a new account this rendered a green ✓ for work
    // that never happened — a fabricated success on the trust surface itself.
    // Phase 9 — and "no customer has asked anything" only when nothing came
    // in at all: two replies prepared means two customers asked. The advice
    // to teach is the section below's, with its door; it is not said twice.
    const pristine = c.handled === 0 && c.draftsPrepared === 0 && c.neededYou === 0;
    // Phase 9 (V1-423) — this counts what CUSTOMERS asked; what the assistant
    // could not answer from the products themselves is Going live's list, and
    // the door to it is here, so "nothing" here never reads as "nothing anywhere".
    return `<div class="block"><div class="empty">${esc(t(locale, pristine ? 'her.teach.unasked' : 'her.teach.none'))}</div>
      ${deeper('/app/business/ready#rehearsal', t(locale, 'factory.rehearsal.title', { name: assistantName(locale) }))}</div>`;
  }
  return `<div class="block">
    <div class="gaps">${c.gaps.map((g) => `
      <a class="gap" href="/app/assistant/knowledge?view=facts&amp;teach=${encodeURIComponent(g.question)}">
        <span class="gq">${esc(g.question)}</span>
        <span class="gmeta muted">${esc(t(locale, 'her.teach.asked', { count: g.count }))}</span>
        <span class="gact">${esc(t(locale, 'her.teach.go'))}${GO}</span>
      </a>`).join('')}</div></div>`;
}

/**
 * R2 — the ramp, in the owner's words: each rung earned (and when), or how
 * close it is — "14 of the last 20 sent as written". The rung is the
 * workspace's, counted over every decision; the levels above follow it.
 */
export function rampBlock(r: RampState, locale: Locale): string {
  const name = assistantName(locale);
  const talks = r.talksEarnedAt
    ? `<p class="fok">${esc(t(locale, 'ramp.talks.earned', { date: show.date(locale, r.talksEarnedAt) }))}</p>`
    : `<p>${esc(t(locale, 'ramp.talks', { done: r.talks.done, of: r.talks.of, need: r.talks.need, customers: r.talks.customers,
        customersNeed: r.talks.customersNeed, days: r.talks.days, daysNeed: r.talks.daysNeed }))}</p>
      ${r.talks.clean ? '' : `<p class="muted small">${esc(t(locale, 'ramp.talks.flagged', { name }))}</p>`}
      ${r.checklistComplete ? '' : `<p class="muted small">${esc(t(locale, 'ramp.needs.checklist'))} ${deeper('/app/ready', t(locale, 'ready.title'))}</p>`}
      ${r.named ? '' : `<p class="muted small">${esc(t(locale, 'ramp.needs.name'))}</p>`}`;
  const sells = !r.sells
    ? `<p class="muted">${esc(t(locale, 'ramp.sells.none'))}</p>`
    : r.sellsEarnedAt
      ? `<p class="fok">${esc(t(locale, 'ramp.sells.earned', { date: show.date(locale, r.sellsEarnedAt) }))}</p>`
      : `<p>${esc(t(locale, 'ramp.sells', { done: r.sells.done, of: r.sells.of, customers: r.sells.customers,
          customersNeed: r.sells.customersNeed, days: r.sells.days, daysNeed: r.sells.daysNeed }))}</p>`;
  return `<div class="ramp">
      <h2 class="sub3">${esc(t(locale, 'ramp.title'))}</h2>
      <p class="muted small">${esc(t(locale, 'ramp.intro', { name }))}</p>
      <h4 class="k">${esc(t(locale, 'autonomy.level.talks'))}</h4>${talks}
      <h4 class="k">${esc(t(locale, 'autonomy.level.sells'))}</h4>${sells}
    </div>`;
}

/**
 * What every part of the page reads alike, from the ONE answer to "what goes
 * out without the owner now" (`aloneNow`, V1-417): which kinds go out alone
 * TODAY, which are set to but still wait (and why), what holds every reply,
 * the stage, and the level.
 *
 * Phase 9 — "Goes out without you" lists only what goes out alone TODAY. The
 * send decision (commitTurn) drafts a capability set to auto while no
 * language's sentence is signed off, the name is unconfirmed, or the
 * workspace has not earned that rung; and the send gate sends nothing while
 * the owner's Stop or the operator's pause is on. Such a capability is listed
 * as set, still waiting, with the reason — never as going out.
 */
const HELD_WHY: Readonly<Record<AloneHold, MessageKey>> = {
  silenced: 'today.silenced.body', stopped: 'today.stopped.body', release: 'her.handles.held.why.release',
  name: 'her.handles.held.why.name', ramp: 'her.handles.held.why.ramp',
};
export function standing(e: EmployeeProfile, locale: Locale) {
  const name = assistantName(locale);
  const now = aloneNow({
    capabilities: e.capabilities, released: autonomyReleased(), named: e.assistantNamed,
    ...(e.earned === undefined ? {} : { earned: e.earned }), ...(e.ramp ? { rung: e.ramp.rung } : {}),
    ...(e.stopped ? { stopped: true } : {}), ...(e.silenced ? { silenced: true } : {}),
  });
  const { hold, alone, setButHeld } = now;
  const heldWhy = t(locale, hold ? HELD_WHY[hold] : 'her.handles.held.why.ramp', { name, ready: t(locale, 'pilot.title') });
  // What happens now, in one line: nothing is sent; these go out without you; or every reply waits.
  const nowLabel = hold === 'silenced' ? t(locale, 'today.silenced.title', { name })
    : hold === 'stopped' ? t(locale, 'today.stopped.title', { name })
    : alone.length ? labelled(locale, t(locale, 'her.handles.alone'), formatList(locale, alone.map((c) => capabilityName(locale, c))))
    : t(locale, 'employee.stage.probation');
  // The level as set, and the level in force: what goes out alone now, by the same answer.
  const level = levelOf(Object.fromEntries(e.capabilities.map((c) => [c.capability, c.mode])));
  const effective = levelOf(Object.fromEntries(e.capabilities.map((c) => [c.capability, alone.includes(c.capability) ? 'auto' : 'draft'])));
  const grantable = e.capabilities.filter((c) => c.mode === 'draft' && c.promotable);
  const revocable = e.capabilities.filter((c) => c.mode === 'auto');
  return { hold, alone, setButHeld, heldWhy, nowLabel, level, effective, grantable, revocable };
}

/**
 * THE ADVISOR RUN — Settings' first row: how much the assistant does alone, as it stands — the level in force
 * (its own sentence), or, where none of the three applies, what goes out without the owner now. The same
 * reading the control beside the levels makes (`standing`).
 */
export const aloneInForce = (e: EmployeeProfile, locale: Locale): string => {
  const st = standing(e, locale);
  return st.effective ? t(locale, `autonomy.level.${st.effective}` as MessageKey) : st.nowLabel;
};

/**
 * R5 — WHAT THE OWNER CHOSE, AND WHAT IS IN FORCE. The level chosen on this
 * page and when; and, where something holds it (V1-417: the Stop, the pause,
 * the native read, the name, the ramp) or the system's own demotions (a guard
 * in auto, a spot check, a wrong price) moved things since, what holds now and
 * each step back with its date and reason. Nothing when nothing differs.
 */
/** Why a capability stepped back, in the alert's words; a reason with none reads as repeated corrections. */
function demotionWhy(locale: Locale, reasons: readonly string[]): string {
  const known = reasons.filter((r) => (SELF_DEMOTION_REASONS as readonly string[]).includes(r));
  return formatList(locale, (known.length ? known : ['repeated_corrections']).map((r) => t(locale, `notify.self_demoted.why.${r}` as MessageKey)));
}

/**
 * 0163 — each capability withdrawn in ONE language that still stands, with the language, the date and why. Shown
 * where the alert and Today land (the levels) and a level down: the capability's own mode still says "alone", so
 * nothing else on the page would show it waits in that language.
 */
export function withdrawnRows(e: EmployeeProfile, locale: Locale): string {
  const open = (e.stepped ?? []).filter((x) => x.language && x.open);
  return open.length ? `<ul class="rows">${open.map((x) => `<li class="row">${esc(t(locale, 'autonomy.since.inLanguage', {
    cap: capabilityName(locale, x.capability), language: languageDisplay(locale, x.language!),
    date: show.date(locale, x.at), why: demotionWhy(locale, x.reasons),
  }))}</li>`).join('')}</ul>` : '';
}

/**
 * R5 — what the owner chose and when; and, where the system's own demotions (a guard in auto, a spot check, a wrong
 * price) or a hold moved things since, what is in force now and each step back with its date and reason. Nothing
 * when nothing was chosen here and nothing differs.
 */
function chosenLines(e: EmployeeProfile, locale: Locale, st: ReturnType<typeof standing>): string {
  if (!e.chosen) return '';
  const levelName = (l: AutonomyLevel) => t(locale, `autonomy.level.${l}` as MessageKey);
  const chose = `<p class="set-help">${esc(t(locale, 'autonomy.chosen', { level: levelName(e.chosen.level), date: show.date(locale, e.chosen.at) }))}</p>`;
  const now = st.effective;
  if (now === e.chosen.level) return chose;
  const still = (e.stepped ?? []).filter((x) => !x.language && !st.alone.includes(x.capability));
  return `${chose}
      <p class="as-force">${esc(now ? t(locale, 'autonomy.inForce', { level: levelName(now) }) : t(locale, 'autonomy.inForce.mixed'))}</p>
      ${still.length ? `<ul class="rows">${still.map((x) => `<li class="row">${esc(t(locale, 'autonomy.since', {
        cap: capabilityName(locale, x.capability), date: show.date(locale, x.at), why: demotionWhy(locale, x.reasons),
      }))}</li>`).join('')}</ul>` : ''}`;
}

/**
 * S4 — strict mode: in which languages only signed sentences go alone. None until a native reader signs a set; the
 * line says so. Only while something goes alone at all.
 */
function strictLine(locale: Locale, hold: AloneHold | null): string {
  if (hold !== null || !autonomyReleased()) return '';
  const strict = STRICT_LOCALES.filter((l) => STRICT_SIGNED[l] !== undefined);
  // The text audit (2026-11-26): where no language is strict there is nothing to say; a strict language is still named.
  return strict.length === 0 ? '' : `<p class="set-help">${esc(t(locale, 'autonomy.strict.some', { list: formatList(locale, strict.map((l) => languageName(locale, l))) }))}</p>`;
}

/** 2026-09-30 — per language: which customers get replies sent alone, and which always wait. Only while something goes alone at all. */
function languagesLine(locale: Locale, hold: AloneHold | null): string {
  return hold === null && autonomyReleased() && disclosureAwaitingReview().length ? `<p class="set-help">${esc(t(locale, 'autonomy.languages', {
    ready: formatList(locale, disclosureReviewed().map((l) => languageName(locale, l))),
    waiting: formatList(locale, disclosureAwaitingReview().map((l) => languageName(locale, l))),
  }))}</p>` : '';
}

/**
 * What stands above everything on Reply permissions, each one line (rule 104: a safety line is ON the page, beside
 * what it is about):
 *
 *   · the operator's pause (0071) and the owner's Stop (0070, rule 13): nothing the assistant writes is sent, whatever
 *     is chosen below. Stopped: the way to start again is Going live's, the owner's alone. Answering: the Stop itself,
 *     a button that asks first and posts where Going live's does — only while something could reach a customer.
 *   · the one hold that drafts every reply: the native read (rule 1), the name (rule 2, with its door), or a workspace
 *     that has not earned sending alone (rule 57), which may only step down.
 */
function standingNotices(e: EmployeeProfile, locale: Locale, viewer: Viewer, st: ReturnType<typeof standing>): string {
  const name = assistantName(locale);
  const said = (title: MessageKey, body: MessageKey): string => `<b class="as-said">${esc(t(locale, title, { name }))}</b>${esc(t(locale, body, { name }))}`;
  const paused = e.silenced ? setNotice({ html: said('today.silenced.title', 'today.silenced.body') }) : '';
  const stop = e.stopped
    ? setNotice({ id: 'stop', html: said('today.stopped.title', 'today.stopped.body'),
        door: viewer.isOwner ? { href: '/app/settings/assistant/ready#stop', label: t(locale, 'today.stopped.start', { name }) } : undefined })
    : viewer.isOwner && e.answering
      ? setNotice({ id: 'stop', text: t(locale, 'as.perm.answering', { name }), act: rowAction({
          action: '/app/business/stop-assistant', label: t(locale, 'assistant.stop.action.stop', { name }),
          confirm: t(locale, 'assistant.stop.action.stopConfirm', { name }), danger: true, hidden: { from: 'employee' } }) })
      : '';
  const hold = st.hold === 'release' ? setNotice({ text: t(locale, 'autonomy.notReleased') })
    : st.hold === 'name' ? setNotice({ text: t(locale, 'her.handles.held.why.name'),
        door: { href: NAME_HOME, label: t(locale, 'autonomy.confirmName') } })
    : '';
  const notEarned = e.earned === false && viewer.isOwner
    ? setNotice({ html: `<b class="as-said">${esc(t(locale, 'autonomy.notEarned.title'))}</b>${esc(t(locale, 'autonomy.notEarned.body', { name }))}`,
        act: st.level !== 'waits' ? rowAction({ action: `${ASSISTANT_HOME}/autonomy`, label: t(locale, 'autonomy.notEarned.stepDown'), hidden: { level: 'waits' } }) : undefined })
    : '';
  return `${paused}${stop}${hold}${notEarned}`;
}

/** What Reply permissions is drawn with beyond the profile: the follow-up rule, and what a refused Save typed. */
export type PermissionsExtra = {
  /** The follow-up rule as it stands, or as it was typed when the Save was refused. Absent: the default rule. */
  readonly followUps?: FollowUpRule;
  /** Which follow-up field the Save refused. */
  readonly followUpError?: FollowUpRuleError | null;
  /** The level that was ticked when the Save was refused, kept ticked. */
  readonly level?: AutonomyLevel | null;
  /** Why the level was refused (a flash key: not released, not earned), said under the levels. */
  readonly levelError?: MessageKey | null;
};

/** The form the page's one Save sends; the levels, drawn above the table, belong to it by its id. */
const PERMISSIONS_FORM = 'reply-permissions';

/**
 * T1 — HOW MUCH THE ASSISTANT DOES ALONE: the three levels in their own words, the one that is set ticked. They are
 * FIELDS: they wait for the page's Save, with the follow-up rule (one route validates both, then calls the two saves
 * that were always called). The level the page was drawn with travels with them (`level_was`), so a Save that only
 * changes the follow-up words does not choose the level again. Owner only; a member of staff reads where it stands.
 * The rung of a workspace that signed itself up (rule 63) decides which levels are offered; one that has earned
 * nothing is offered none (the notice above lets it step down).
 */
function levelsSection(e: EmployeeProfile, locale: Locale, viewer: Viewer, st: ReturnType<typeof standing>, x: PermissionsExtra): string {
  const name = assistantName(locale);
  const { level } = st;
  const levelName = (l: AutonomyLevel) => t(locale, `autonomy.level.${l}` as MessageKey);
  const ticked = x.level === undefined ? level : x.level;
  const setAlone = e.capabilities.filter((c) => c.mode === 'auto').map((c) => capabilityName(locale, c.capability));
  // The mix, in words, when none of the three applies: said under the levels, beside the choice.
  const mixed = level === null ? `<p class="set-help">${esc(setAlone.length
    ? t(locale, 'autonomy.mixed', { list: formatList(locale, setAlone) }) : t(locale, 'autonomy.mixed.none'))}</p>` : '';
  const choice = !viewer.isOwner
    ? `<p>${esc(st.effective ? t(locale, 'autonomy.inForce', { level: levelName(st.effective) }) : t(locale, 'autonomy.inForce.mixed'))}</p>
       <p class="set-help">${esc(t(locale, 'staff.ownerDecides'))}</p>`
    : e.earned === false ? ''
    : `<fieldset class="levels" aria-label="${esc(t(locale, 'autonomy.title', { name }))}">
        <input type="hidden" name="level_was" value="${esc(level ?? '')}" form="${PERMISSIONS_FORM}" />
        ${AUTONOMY_LEVELS.filter((l) => !e.ramp || rungOfLevel(l) <= e.ramp.rung).map((l) => `<label class="level"><input type="radio" name="level" value="${l}" form="${PERMISSIONS_FORM}"${ticked === l ? ' checked' : ''}${x.levelError ? ' aria-describedby="level-error"' : ''} />
          <span><b>${esc(levelName(l))}</b>
          <span class="muted lnote">${esc(t(locale, `autonomy.level.${l}.note` as MessageKey))}</span></span></label>`).join('')}
      </fieldset>
      ${x.levelError ? `<p class="fielderr" role="alert" id="level-error">${esc(t(locale, x.levelError, { name }))}</p>` : ''}${mixed}`;
  // 0163 — a kind withdrawn in ONE language still says "alone" everywhere else on the page; choosing the level again
  // ends the wait (`chooseAutonomyLevel`), so the act is beside the line that says so.
  const withdrawn = withdrawnRows(e, locale);
  const again = withdrawn && viewer.isOwner && level !== null && e.earned !== false
    ? rowAction({ action: `${ASSISTANT_HOME}/autonomy`, label: t(locale, 'as.perm.again'), hidden: { level } }) : '';
  // The ramp holds some or all of it: why, and how far it has come (rule 63).
  const rampWhy = st.hold === 'ramp' || (st.hold === null && st.setButHeld.length > 0) ? `<p class="set-help">${esc(st.heldWhy)}</p>` : '';
  return setSection({ id: 'on-her-own', title: t(locale, 'autonomy.title', { name }), help: t(locale, 'as.perm.disclosure'),
    rows: `${choice}${chosenLines(e, locale, st)}${withdrawn}${again}${languagesLine(locale, st.hold)}${strictLine(locale, st.hold)}${rampWhy}${e.ramp ? rampBlock(e.ramp, locale) : ''}` });
}

/**
 * EACH KIND OF REPLY — one visible table: the kind, where it stands now, and the one act the owner has on it. A row's
 * act is sent at once, in its own small form, asking first (the one saving rule): "Wait for my OK" for a kind set to
 * go alone, "Send without my OK" for a kind that has earned it. The four that always wait are rows too, locked.
 * Staff read the table and are given no button (G9a).
 */
function kindsSection(e: EmployeeProfile, locale: Locale, viewer: Viewer, st: ReturnType<typeof standing>): string {
  const name = assistantName(locale);
  const capName = (c: string) => capabilityName(locale, c);
  const k = (key: MessageKey): string => `<span class="tm-k">${esc(t(locale, key))}</span>`;
  const row = (kind: string, pill: string, act: string, cls = ''): string =>
    `<tr class="tm${cls}"><th scope="row"><bdi>${esc(kind)}</bdi></th><td>${k('employee.promo.current')}${pill}</td><td class="as-act">${act}</td></tr>`;
  const locked = (key: MessageKey): string => `<span class="as-lock">${esc(t(locale, key))}</span>`;
  const act = (verb: 'revoke' | 'promote', c: string): string => !viewer.isOwner ? '' : rowAction({
    action: `${ASSISTANT_HOME}/capability/${c}/${verb}`, label: t(locale, verb === 'revoke' ? 'employee.actions.revoke' : 'employee.actions.grant'),
    confirm: t(locale, verb === 'revoke' ? 'employee.actions.revokeConfirm' : 'employee.actions.grantConfirm', { cap: capName(c) }),
    ariaLabel: `${t(locale, verb === 'revoke' ? 'employee.actions.revoke' : 'employee.actions.grant')}: ${capName(c)}`,
  });
  const rows = e.capabilities.filter((c) => c.capability !== 'confirm_order').map((c) => {
    if (c.mode === 'auto') {
      const goes = st.alone.includes(c.capability);
      return row(capName(c.capability), `<span class="pill long${goes ? ' ok' : ''}">${esc(t(locale, goes ? 'her.handles.alone' : 'her.handles.held'))}</span>`, act('revoke', c.capability));
    }
    const earned = c.promotable;
    return row(capName(c.capability),
      `<span class="pill long">${esc(t(locale, 'her.handles.waits'))}</span>${earned ? ` <span class="as-earned">${esc(t(locale, st.hold ? 'employee.actions.eligibleHeld' : 'employee.actions.eligible', { cap: capName(c.capability) }))}</span>` : ''}`,
      earned && viewer.isOwner ? act('promote', c.capability) : locked('as.perm.earned'));
  });
  const always = [capName('confirm_order'), ...NEVER_ALLOWED.map((key) => t(locale, key))]
    .map((kind) => row(kind, `<span class="pill long stop">${esc(t(locale, 'her.handles.always'))}</span>`, locked('as.perm.locked'), ' as-always'));
  // What comes next, in one line: now → next; and what earns it, while nothing goes out alone yet.
  const next = `<p class="set-help" id="progress">${esc(labelled(locale, t(locale, 'employee.promo.current'), st.nowLabel))}${st.alone.length
    ? ` · ${esc(t(locale, 'employee.promo.done'))}`
    : ` · ${esc(labelled(locale, t(locale, 'employee.promo.next'), t(locale, 'employee.stage.partial')))}`}</p>${e.conditions.length
    ? `<ul class="conds as-conds">${e.conditions.map((c) => `<li class="cond">${signalMark(c.met ? 'ok' : 'waiting')} ${esc(t(locale, `employee.promo.cond.${c.cond}` as MessageKey, { name }))}</li>`).join('')}</ul>` : ''}`;
  const table = `<table class="team-table as-kinds"><thead><tr><th scope="col">${esc(t(locale, 'as.perm.kind'))}</th><th scope="col">${esc(t(locale, 'employee.promo.current'))}</th><th scope="col">${viewer.isOwner ? esc(t(locale, 'as.perm.action')) : ''}</th></tr></thead>
      <tbody>${rows.join('')}${always.join('')}</tbody></table>`;
  return setSection({ id: 'reply-types', title: t(locale, 'her.handles.title'),
    help: e.canDo.length === 0 && e.needConfirm.length === 0 ? t(locale, 'her.handles.none') : undefined,
    rows: `${table}${next}<p class="set-help">${esc(t(locale, 'employee.actions.note'))}</p>${viewer.isOwner ? '' : `<p class="set-help">${esc(t(locale, 'staff.ownerDecides'))}</p>`}` });
}

/**
 * FOLLOW-UPS AFTER A QUOTE — the rule's three FIELDS (on or off, the days, the words), always in view, saved by the
 * page's Save. A refusal says what is wrong under the field it is about, with what was typed kept. A member of staff
 * reads the rule. The words are English where the catalogue has no other (`wordsHtml` says so to the browser).
 */
function followUpRows(locale: Locale, rule: FollowUpRule, owner: boolean, error: FollowUpRuleError | null): string {
  const say = (key: MessageKey, p?: Record<string, string | number>): string => wordsHtml(locale, key, p);
  const daysKey = (n: number): MessageKey => (n === 1 ? 'followUp.day' : 'followUp.days');
  const days = (n: number): string => say(daysKey(n), { n: show.count(locale, n) });
  const fieldErr = (id: string): string => `<span class="fielderr" role="alert" id="${id}">${say('followUp.ruleError')}</span>`;
  const line = (o: { label: string; forId?: string; desc?: string; descId?: string; control: string; bad?: boolean }): string =>
    `<div class="setrow${o.bad ? ' bad' : ''}"><div class="fr-l">${o.forId ? `<label class="fr-name" for="${o.forId}">${o.label}</label>` : `<span class="fr-name">${o.label}</span>`}${o.desc
      ? `<span class="fr-desc"${o.descId ? ` id="${o.descId}"` : ''}>${o.desc}</span>` : ''}</div><div class="fr-c">${o.control}</div></div>`;
  if (!owner) return [
    line({ label: say('followUp.enabled'), control: `<span class="fr-value">${say(rule.enabled ? 'followUp.on' : 'followUp.off')}</span>` }),
    line({ label: say('followUp.delay'), control: `<span class="fr-value">${days(rule.delayDays)}</span>` }),
    line({ label: say('followUp.wording'), control: rule.wording
      ? `<blockquote class="follow-up-words" dir="auto">${esc(rule.wording)}</blockquote>` : `<span class="fr-value muted">${say('followUp.emptyWords')}</span>` }),
    `<p class="set-help">${esc(t(locale, 'staff.ownerDecides'))}</p>`,
  ].join('');
  return [
    line({ label: say('followUp.enabled'), forId: 'follow-up-enabled',
      control: `<span class="as-check"><input type="checkbox" id="follow-up-enabled" name="enabled" value="1"${rule.enabled ? ' checked' : ''} /><span class="set-track" aria-hidden="true"></span></span>` }),
    line({ label: say('followUp.delay'), forId: 'follow-up-delay', desc: say('followUp.clock'), descId: 'follow-up-clock', bad: error === 'delay',
      control: `<select id="follow-up-delay" name="delayDays" aria-describedby="follow-up-clock${error === 'delay' ? ' follow-up-error' : ''}"${error === 'delay' ? ' aria-invalid="true"' : ''}>${[1, 2, 3, 4, 5, 6, 7].map((n) =>
        `<option value="${n}"${n === rule.delayDays ? ' selected' : ''}>${esc(t(locale, daysKey(n), { n: show.count(locale, n) }))}</option>`).join('')}</select>${error === 'delay' ? fieldErr('follow-up-error') : ''}` }),
    line({ label: say('followUp.wording'), forId: 'follow-up-wording', desc: say('followUp.wordsHelp'), descId: 'follow-up-words-help', bad: error === 'wording',
      control: `<textarea id="follow-up-wording" name="wording" rows="4" dir="auto" aria-describedby="follow-up-words-help${error === 'wording' ? ' follow-up-error' : ''}"${error === 'wording' ? ' aria-invalid="true" autofocus' : ''}>${esc(rule.wording)}</textarea>${error === 'wording' ? fieldErr('follow-up-error') : ''}` }),
  ].join('');
}

/**
 * A row of the menu: the settings pattern's own row (`settings.ts` menuRow —
 * one definition, so a fix to how a row draws its value reaches these too),
 * with the id a door elsewhere lands on.
 */
type MenuRow = {
  readonly href: string | null; readonly icon: IconId; readonly label: string;
  readonly value?: string; readonly tone?: 'ok' | 'warn' | undefined; readonly desc?: string; readonly id?: string;
  /** The line under the name, already escaped — for a line that isolates a name. */
  readonly descHtml?: string;
};
const menuRow = (r: MenuRow): string => {
  const html = settingsRow({ href: r.href, icon: r.icon, label: r.label, desc: r.desc ?? null, value: r.value ?? null, tone: r.tone,
    ...(r.descHtml === undefined ? {} : { descHtml: r.descHtml }) });
  return r.id ? html.replace(/^<li>/, `<li id="${r.id}">`) : html;
};

/**
 * SETTINGS › ASSISTANT › REPLY PERMISSIONS (the settings overhaul, rule 104) — what the assistant may send without
 * the owner, on ONE page, every control in view:
 *
 *   the title and one line; what stands above everything (the Stop, the pause, the one hold);
 *   1 · how much the assistant does alone — the three levels (fields), with the line that says what a customer is
 *       told when a reply goes without the owner; what was chosen beside what is in force; the ramp;
 *   2 · each kind of reply — a table whose rows act at once;
 *   3 · follow-ups after a quote — three fields;
 *   and ONE Save, at the end, for the fields of 1 and 3.
 *
 * It replaces the landing, its folds and the page "How sending without you works" (whose long form is in this page's
 * help, helpTopics.ts). Nothing here changes what a level, a kind or a follow-up MEANS or how it is stored: the form
 * posts to one route that calls the saves that were always called, and each row posts where it always did.
 */
export function renderEmployee(
  e: EmployeeProfile, locale: Locale, flash: Flash | null, viewer: Viewer = OWNER_VIEW, extra: PermissionsExtra = {},
): string {
  const name = assistantName(locale);
  const st = standing(e, locale);
  const rule = extra.followUps ?? DEFAULT_FOLLOW_UP_RULE;
  // The template's section, written out: its heading and its line are English where the catalogue has no other.
  const follow = `<section class="set-sec" id="follow-ups"><h2 class="set-h">${wordsHtml(locale, 'followUp.title')}</h2><p class="set-help">${wordsHtml(locale, 'followUp.intro')}</p><div class="set-rows">${followUpRows(locale, rule, viewer.isOwner, extra.followUpError ?? null)}</div></section>`;
  return `${pageHead(t(locale, 'settingsArea.permissions'), t(locale, 'as.perm.lede', { name }))}${flashBanner(flash)}
    ${standingNotices(e, locale, viewer, st)}
    ${levelsSection(e, locale, viewer, st, extra)}
    ${kindsSection(e, locale, viewer, st)}
    ${viewer.isOwner ? saveForm(PERMISSIONS_SAVE, `${follow}${saveActs(locale)}`, { id: PERMISSIONS_FORM }) : follow}`;
}

/**
 * One screen of the menu: the way back to it, the row's own words as the
 * heading, the notice that followed an action here, and the former section,
 * its words and its controls unchanged.
 */
export function renderEmployeeScreen(
  screen: EmployeeScreen, e: EmployeeProfile, locale: Locale, flash: Flash | null,
  ctx?: HerContext, viewer: Viewer = OWNER_VIEW, extras: ScreenExtras = {},
): string {
  const name = assistantName(locale);
  const st = standing(e, locale);
  const capName = (c: string) => capabilityName(locale, c);
  const dailyTool = screen === 'checks' || screen === 'history' || screen === 'talk' || screen === 'learning';
  const returnTo = screen === 'month' ? '/app' : dailyTool ? '/app/assistant' : ASSISTANT_HOME;
  const returnLabel = screen === 'month' ? t(locale, 'split.title') : dailyTool ? t(locale, 'nav.assistant') : name;
  const head = `${back(returnTo, returnLabel)}<h1 class="page">${esc(screenTitle(locale, screen))}</h1>${flashBanner(flash)}`;

  switch (screen) {
    // Two doors, one data: what the assistant answers from, each line opening
    // the one place it is changed. Read only — no form here edits a fact.
    case 'talk': {
      const k = extras.talk;
      if (!k) return `${head}<div class="empty">${esc(t(locale, 'her.menu.nothingYet'))}</div>`;
      const more = k.products.total > k.products.names.length;
      // Each row is named as the page it opens is named, lands on that page, and says
      // what My business's own row says (w4-products-knowledge-04, w4-business-assistant-31).
      const certs = k.certs.map((c) => claimName(locale, c));
      const rows: MenuRow[] = [
        { href: '/app/settings/profile', icon: 'business', label: t(locale, 'settings.profile.title'),
          value: t(locale, k.finished ? 'setup.state.done' : 'setup.state.toDo'), ...(k.finished ? { tone: 'ok' as const } : {}) },
        ...(k.selling ? [{
          // How you sell's own menu, which staff may open too (its questions stay the owner's, rule 11).
          href: '/app/business/how-you-sell', icon: 'sell' as const, label: t(locale, 'factory.sellhow.title'),
          desc: t(locale, 'setup.desc.selling'), value: t(locale, 'hs.progress', { done: k.selling.answered, total: k.selling.total }),
          ...(k.selling.answered >= k.selling.total ? { tone: 'ok' as const } : {}) }] : []),
        { href: '/app/products', icon: 'products', label: t(locale, 'nav.products'),
          // A product's name carries its figures ("38x40cm", "500ml"): isolated, so Arabic does not reorder them.
          desc: k.products.names.length ? `${show.isolateFigures(locale, k.products.names.join(' · '))}${more ? ' …' : ''}` : t(locale, 'factory.sell.empty'),
          value: tn(locale, 'her.talk.products', k.products.total) },
        { href: '/app/assistant/knowledge', icon: 'knowledge', label: t(locale, 'nav.knowledge'),
          value: k.taught > 0 ? tn(locale, 'knowledge.product.facts', k.taught) : t(locale, 'knowledge.product.none') },
        // The certifications by name on the line under the row's name, which wraps; a value on a phone is one short line.
        { href: '/app/business/promises', icon: 'promise', label: t(locale, 'factory.promise.title'),
          ...(certs.length ? { desc: certs.join(' · ') } : { value: t(locale, 'business.value.noneConfirmed') }) },
      ];
      return `${head}
        <p class="lede">${esc(t(locale, 'her.talk.lede'))}</p>
        <ul class="scard asst-menu talk">${rows.map(menuRow).join('')}</ul>`;
    }
    // What still needs teaching, then what is known so far, with the door to
    // the whole of it (Knowledge, and each entry under it).
    case 'learning':
      return `${head}${teachBody(ctx, locale)}${knowsSection(e, ctx, locale)}`;
    // M34.7 — 抽查: is the trust warranted? The work itself, and the words to answer it with.
    case 'checks':
      return `${head}${e.spotChecks.length
        ? `<div class="block">
            <p class="muted review-intro">${esc(t(locale, 'spotcheck.intro', { name }))}</p>
            ${e.spotChecks.map((s) => {
              const act = `${ASSISTANT_HOME}/spot-check/${encodeURIComponent(s.id)}`;
              return `<div class="scheck">
                <p class="caption muted">${esc(show.dateYear(locale,s.askedAt))} · ${esc(show.time(locale,s.askedAt))}${s.conversationId?` · <a href="${esc(conversationUrl(s.conversationId))}">${esc(t(locale,'assistantArea.conversation'))}</a>`:''}</p>
                <div class="muted sclabel">${esc(t(locale, 'spotcheck.buyerSaid'))}</div>
                <div class="scsaid"><bdi>${esc(s.buyerMessage||t(locale,'assistantArea.questionMissing'))}</bdi></div>
                <div class="muted sclabel">${esc(t(locale, s.wasAuto ? 'spotcheck.sentAlone' : 'spotcheck.sheReplied', { name }))}</div>
                <div dir="auto" class="proposed">${markSmall(16,null)}<p>${esc(s.reply)}</p></div>
                <form method="post" action="${act}" class="acts">
                  <button class="btn send" name="answer" value="好">${esc(t(locale, 'spotcheck.ok'))}</button>
                  <button class="btn danger" name="answer" value="有问题">${esc(t(locale, 'spotcheck.problem'))}</button>
                </form>
                <details class="scfix"><summary>${esc(t(locale, 'spotcheck.fix'))}</summary>
                  <form method="post" action="${act}">
                    <textarea id="check-${esc(s.id)}" name="answer" rows="2" required aria-label="${esc(t(locale, 'spotcheck.fix'))}"
                      placeholder="${esc(t(locale, 'spotcheck.fixPlaceholder'))}"></textarea>
                    <button class="btn" type="submit">${esc(t(locale, 'spotcheck.fixSave'))}</button>
                  </form>
                </details>
              </div>`;
            }).join('')}
          </div>`
        : `<div class="empty">${esc(t(locale, 'spotcheck.none'))}</div>`}`;
    case 'month':
      return `${head}${recentBody(ctx, locale)}`;
    case 'history':
      return `${head}<div class="block">
        ${e.growth.length
          ? `<ul class="growth">${e.growth.map((g) => {
              const text = g.kind === 'self_demote' && g.language
                ? t(locale, 'employee.growth.self_demote.inLanguage', {
                    cap: capName(g.capability ?? ''), language: languageDisplay(locale, g.language),
                    why: t(locale, `demote.why.${g.why ?? 'repeated_corrections'}` as MessageKey),
                  })
                : g.kind === 'self_demote'
                ? t(locale, 'employee.growth.self_demote', {
                    cap: capName(g.capability ?? ''),
                    why: t(locale, `demote.why.${g.why ?? 'repeated_corrections'}` as MessageKey),
                  })
                : t(locale, `employee.growth.${g.kind}` as MessageKey, g.capability ? { cap: capName(g.capability) } : {});
              return `<li>${esc(text)}<span class="muted"> · ${esc(show.date(locale, g.at))}</span></li>`;
            }).join('')}</ul>`
          : `<div class="muted empty">${esc(t(locale, 'employee.growth.empty'))}</div>`}
      </div>`;
  }
}
