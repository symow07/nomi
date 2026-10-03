import { rampState, type RampState } from '../../db/ramp.js';
import { rungOf, rungOfLevel } from '../../core/trust/ramp.js';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { loadPendingSpotChecks, type PendingSpotCheck } from '../../pipeline/spotChecks.js';
import { promotionDecision } from '../../core/trust/evidence.js';
import { loadCapabilityEvidence, NON_PROMOTABLE } from '../../pipeline/capability.js';
import { AUTONOMY_LEVELS, levelOf, isAutonomyLevel, type AutonomyLevel } from '../../core/conversation/autonomyLevel.js';
import { SELF_DEMOTION_REASONS } from '../../pipeline/notify.js';
import { autonomyReleased, disclosureAwaitingReview, disclosureReviewed } from '../../core/conversation/disclosure.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { capabilityName, claimName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, tn, assistantName } from './say.js';
import { languageName } from './inbox.js';
import { labelled, formatList } from '../../core/owner/i18n/format.js';
import { esc, deeper, back, signalMark, type Signal } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { assistantStopped } from '../../db/assistantStop.js';
import { loadKillSwitches } from '../../db/opsFlags.js';
import { icon, type IconId } from './icons.js';
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
  readonly stepped?: readonly { readonly capability: string; readonly at: Date; readonly reasons: readonly string[] }[];
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
};

export async function loadEmployee(db: Db, businessIdRaw: string): Promise<EmployeeProfile> {
  const bid = parseBusinessId(businessIdRaw);
  const empty: EmployeeProfile = {
    hireDate: null, knows: 0, stage: 'probation', canDo: [], needConfirm: [], capabilities: [],
    growth: [], promoted: false, conditions: [], spotChecks: [], assistantNamed: false,
  };
  if (!bid.ok) return empty;

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
    const growth = (await sql<{ kind: string; capability: string | null; at: Date; why: string | null }>`
      -- M34.9 — a demotion SHE made reads differently from one the owner made.
      -- Collapsing both into 'revoke' would let the owner think he had pulled
      -- a capability back when in fact she stepped back on her own.
      (select case when action = 'promote' then 'promote'
                   when actor = 'system_self_demoted' then 'self_demote'
                   else 'revoke' end as kind,
              capability, at, reasons[1] as why
         from capability_events where business_id = ${bid.value})
      union all
      (select case when verdict = 'correct' then 'spotcheck_pass'
                   when verdict = 'needs_improvement' then 'spotcheck_improve'
                   else 'spotcheck_issue' end, null::text, answered_at, null::text
         from spot_checks where business_id = ${bid.value} and answered_at is not null)
      union all
      (select 'learned_edit', capability, decided_at, null::text
         from drafts where business_id = ${bid.value} and status = 'edited' and decided_at is not null)
      order by at desc limit 8
    `.execute(tx)).rows.map((r): GrowthEvent => ({
      kind: r.kind as GrowthKind, capability: r.capability, at: r.at, why: r.why,
    }));

    const passed = (await sql<{ n: number }>`select count(*)::int as n from spot_checks where verdict='correct'`.execute(tx)).rows[0]!.n;
    const learned = (await sql<{ n: number }>`select count(*)::int as n from drafts where status='edited'`.execute(tx)).rows[0]!.n;
    const promoted = canDo.length > 0;

    // R5 — the level the owner chose, and the system's own steps back since.
    const chose = (await sql<{ level: string | null; at: Date | null }>`
      select autonomy_level_chosen as level, autonomy_level_chosen_at as at from businesses where id = ${bid.value}`.execute(tx)).rows[0];
    const chosen = chose?.level && chose.at && isAutonomyLevel(chose.level) ? { level: chose.level, at: chose.at } : null;
    const stepped = (await sql<{ capability: string; at: Date; reasons: string[] }>`
      select distinct on (capability) capability, at, reasons from capability_events
       where business_id = ${bid.value} and actor = 'system_self_demoted'
         and at >= coalesce(${chosen?.at ?? null}::timestamptz, now() - interval '30 days')
       order by capability, at desc`.execute(tx)).rows;

    // Phase 7 — the rows' values: counted where My business and the forbidden
    // words page count them, so the two doors never disagree.
    const tallies = (await sql<{ products: number; words: number }>`
      select (select count(*)::int from products where business_id = ${bid.value} and is_active) as products,
             (select count(*)::int from forbidden_terms where business_id = ${bid.value} and archived_at is null) as words
    `.execute(tx)).rows[0];

    return {
      products: tallies?.products ?? 0,
      words: tallies?.words ?? 0,
      stopped: await assistantStopped(tx, bid.value),
      silenced: (await loadKillSwitches(tx, bid.value)).globalSilence,
      hireDate: onboard?.signup_at ?? null,
      knows,
      chosen,
      stepped: stepped.map((r) => ({ capability: r.capability, at: r.at, reasons: r.reasons ?? [] })),
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
 *                 under a way back to the menu (`/app/employee/<screen>`).
 *
 * Nothing here moved where it is edited: the business's facts and products
 * stay My business's ("two doors, one data" — the "can talk about" screen
 * reads them and opens them there), taught knowledge stays /app/knowledge,
 * the forbidden words their own page, Practice its own room.
 */

/** Phase 7 — the screens one row each opens, in the menu's order. */
export const EMPLOYEE_SCREENS = ['talk', 'learning', 'name', 'replies', 'one-kind', 'checks', 'month', 'next', 'history'] as const;
export type EmployeeScreen = typeof EMPLOYEE_SCREENS[number];
export const screenHref = (s: EmployeeScreen): string => `/app/employee/${s}`;

/** Each screen's heading — the row's own words, so the row, the tab and the heading say one thing. */
const SCREEN_TITLE: Readonly<Record<EmployeeScreen, MessageKey>> = {
  talk: 'her.talk.title', learning: 'her.teach.title', name: 'her.menu.name', replies: 'her.handles.title',
  'one-kind': 'employee.actions.title', checks: 'spotcheck.title', month: 'her.recent.title',
  next: 'employee.promo.title', history: 'employee.growth.title',
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
const list = (title: string, mark: Signal | null, items: readonly string[], emptyLabel: string): string =>
  `<div class="dgroup"><div class="dtitle">${esc(title)}</div>${items.length
    ? `<ul class="ditems">${items.map((i) => `<li class="ditem">${mark ? `${signalMark(mark)} ` : ''}${esc(i)}</li>`).join('')}</ul>`
    : `<p class="ditem muted">${esc(emptyLabel)}</p>`}</div>`;

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
  /** The profile holds what setting up asks of it — the rule My business's own row reads. */
  readonly profileDone: boolean;
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
  const html = at < 0 ? said : `${said.slice(0, at)}<b class="hnum">${figure}</b>${said.slice(at + figure.length)}`;
  return `<div class="hrow"><span class="hlabel">${html}</span></div>`;
}

/** 1 · What does she know? Her learning, in her terms — never a "database". */
function knowsSection(e: EmployeeProfile, c: HerContext | undefined, locale: Locale): string {
  if (e.knows === 0 && (!c || (c.taughtRecently === 0 && c.corrected === 0))) {
    return `<div class="block"><h2>${esc(t(locale, 'her.knows.title'))}</h2>
      <div class="empty">${esc(t(locale, 'her.knows.none'))}</div>
      ${deeper('/app/knowledge', t(locale, 'knowledge.teach'))}</div>`;
  }
  return `<div class="block"><h2>${esc(t(locale, 'her.knows.title'))}</h2>
    <div class="hrows">
      ${countRow(e.knows, t(locale, 'her.knows.count'))}
      ${c ? countRow(c.taughtRecently, t(locale, 'her.knows.recent')) : ''}
      ${c ? countRow(c.corrected, t(locale, 'her.knows.corrected')) : ''}
    </div>
    ${deeper('/app/knowledge', t(locale, 'knowledge.teach'))}</div>`;
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
    return `<div class="block"><div class="empty">${esc(t(locale, pristine ? 'her.teach.unasked' : 'her.teach.none'))}</div></div>`;
  }
  return `<div class="block">
    <div class="gaps">${c.gaps.map((g) => `
      <a class="gap" href="/app/knowledge?teach=${encodeURIComponent(g.question)}">
        <span class="gq">${esc(g.question)}</span>
        <span class="gmeta muted">${esc(t(locale, 'her.teach.asked', { count: g.count }))}</span>
        <span class="gact">${esc(t(locale, 'her.teach.go'))}<span class="go" aria-hidden="true">›</span></span>
      </a>`).join('')}</div></div>`;
}

/**
 * R2 — the ramp, in the owner's words: each rung earned (and when), or how
 * close it is — "14 of the last 20 sent as written". The rung is the
 * workspace's, counted over every decision; the levels above follow it.
 */
function rampBlock(r: RampState, locale: Locale): string {
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
      <h3 class="sub3">${esc(t(locale, 'ramp.title'))}</h3>
      <p class="muted small">${esc(t(locale, 'ramp.intro', { name }))}</p>
      <h4 class="k">${esc(t(locale, 'autonomy.level.talks'))}</h4>${talks}
      <h4 class="k">${esc(t(locale, 'autonomy.level.sells'))}</h4>${sells}
    </div>`;
}

/**
 * R5 — WHAT THE OWNER CHOSE, AND WHAT IS IN FORCE. The level chosen on this
 * page and when; and, where the system's own demotions (a guard in auto, a
 * spot check, a wrong price) or a lost rung moved things since, what holds now
 * and each step back with its date and reason. Nothing when nothing differs.
 */
function chosenBlock(e: EmployeeProfile, locale: Locale): string {
  if (!e.chosen) return '';
  const levelName = (l: AutonomyLevel) => t(locale, `autonomy.level.${l}` as MessageKey);
  const chose = `<p class="muted">${esc(t(locale, 'autonomy.chosen', { level: levelName(e.chosen.level), date: show.date(locale, e.chosen.at) }))}</p>`;
  // In force: a capability set to auto that its rung does not allow still waits.
  const held = (capability: string) => e.ramp !== undefined && rungOf(capability as never) > e.ramp.rung;
  const effective = Object.fromEntries(e.capabilities.map((c) => [c.capability, c.mode === 'auto' && !held(c.capability) ? 'auto' : 'draft']));
  const now = levelOf(effective as Record<string, 'auto' | 'draft'>);
  if (now === e.chosen.level) return chose;
  const still = (e.stepped ?? []).filter((x) => effective[x.capability] !== 'auto');
  const why = (reasons: readonly string[]) => formatList(locale, (reasons.filter((r) => (SELF_DEMOTION_REASONS as readonly string[]).includes(r)).length
    ? reasons.filter((r) => (SELF_DEMOTION_REASONS as readonly string[]).includes(r)) : ['repeated_corrections'])
    .map((r) => t(locale, `notify.self_demoted.why.${r}` as MessageKey)));
  return `${chose}
      <p>${esc(now ? t(locale, 'autonomy.inForce', { level: levelName(now) }) : t(locale, 'autonomy.inForce.mixed'))}</p>
      ${still.length ? `<ul class="rows">${still.map((x) => `<li class="row">${esc(t(locale, 'autonomy.since', {
        cap: capabilityName(locale, x.capability), date: show.date(locale, x.at), why: why(x.reasons),
      }))}</li>`).join('')}</ul>` : ''}`;
}

/**
 * What every part of the page reads alike: which kinds go out alone TODAY,
 * which are set to but still wait (and why), the stage, and the level.
 *
 * Phase 9 — "Handled without you" lists only what goes out alone TODAY.
 * The send decision (commitTurn) drafts a capability set to auto while no
 * language's sentence is signed off, the name is unconfirmed, or the
 * workspace has not earned that rung; such a capability is listed as set,
 * still waiting, with the reason — never as handled.
 */
function standing(e: EmployeeProfile, locale: Locale) {
  const heldBecause: MessageKey | null = !autonomyReleased() ? 'her.handles.held.why.release'
    : !e.assistantNamed ? 'her.handles.held.why.name'
    : e.earned === false ? 'her.handles.held.why.ramp' : null;
  const goesAlone = (c: string): boolean => heldBecause === null && !(e.ramp && rungOf(c as never) > e.ramp.rung);
  const alone = e.canDo.filter(goesAlone);
  const setButHeld = e.canDo.filter((c) => !goesAlone(c));
  const heldWhy = t(locale, heldBecause ?? 'her.handles.held.why.ramp', { ready: t(locale, 'pilot.title') });
  const stageLabel = t(locale, `employee.stage.${alone.length ? e.stage : 'probation'}` as MessageKey);
  const level = levelOf(Object.fromEntries(e.capabilities.map((c) => [c.capability, c.mode])));
  const grantable = e.capabilities.filter((c) => c.mode === 'draft' && c.promotable);
  const revocable = e.capabilities.filter((c) => c.mode === 'auto');
  return { alone, setButHeld, heldWhy, stageLabel, level, grantable, revocable };
}

/**
 * 0070 / 0071 (rule 13) — stopped, or paused by the operator: nothing the
 * assistant writes is sent, whatever is chosen below. Said first, in Today's
 * own words; the way to Start is My business's, and the owner's alone.
 */
function heldEverywhere(e: EmployeeProfile, locale: Locale, viewer: Viewer): string {
  const name = assistantName(locale);
  const stop = e.stopped
    ? `<div class="held-all" role="status"><p class="fwarn">${esc(t(locale, 'today.stopped.title', { name }))}</p>
        <p class="small">${esc(t(locale, 'today.stopped.body', { name }))}</p>
        ${viewer.isOwner ? deeper('/app/business/ready', t(locale, 'today.stopped.start', { name })) : ''}</div>`
    : '';
  const paused = e.silenced
    ? `<div class="held-all" role="status"><p class="fwarn">${esc(t(locale, 'today.silenced.title', { name }))}</p>
        <p class="small">${esc(t(locale, 'today.silenced.body', { name }))}</p></div>`
    : '';
  return `${paused}${stop}`;
}

/**
 * T1 — HOW MUCH THE ASSISTANT DOES ALONE: the heart of the product, so it
 * stays on the landing, whole — the three levels in their own words, the one
 * in force checked, the form posting where it always did — with everything
 * that holds it said beside it. The ladder stays as advice about what has been
 * EARNED; this is what the owner has DECIDED. Owner only, like it; a member of
 * staff reads where it stands and who decides it.
 */
function levelControl(e: EmployeeProfile, locale: Locale, viewer: Viewer): string {
  const { level } = standing(e, locale);
  if (!viewer.isOwner) {
    const said = level ? t(locale, 'autonomy.inForce', { level: t(locale, `autonomy.level.${level}` as MessageKey) }) : t(locale, 'autonomy.inForce.mixed');
    return `<section class="block level-control">
      <h2>${esc(t(locale, 'autonomy.title'))}</h2>
      ${heldEverywhere(e, locale, viewer)}
      <p>${esc(said)}</p>
      <p class="muted small">${esc(t(locale, 'staff.ownerDecides'))}</p>
    </section>`;
  }
  // Phase 9 — what holds every level, said ABOVE the levels and at the size
  // of the text around it: an unconfirmed name (hers to fix, so the waiting
  // mark and the door), a sentence not yet read by a native speaker, and the
  // languages whose customers always wait. Under Save, in grey small print
  // ending in a bare "Open", it read as the end of the paragraph.
  const holds = [
    autonomyReleased() ? '' : `<p class="small">${esc(t(locale, 'autonomy.notReleased'))}</p>`,
    e.assistantNamed ? '' : `<p class="fwarn">${esc(t(locale, 'autonomy.needsName'))}</p>${deeper('/app/onboarding', t(locale, 'autonomy.confirmName'))}`,
    /* 2026-09-30 — per language: which customers get replies sent alone, and which always wait. */
    autonomyReleased() && disclosureAwaitingReview().length ? `<p class="small">${esc(t(locale, 'autonomy.languages', {
      ready: formatList(locale, disclosureReviewed().map((l) => languageName(locale, l))),
      waiting: formatList(locale, disclosureAwaitingReview().map((l) => languageName(locale, l))),
    }))}</p>` : '',
  ].join('');
  // The mix, in words: which kinds are set to go without the owner now.
  const setAlone = e.capabilities.filter((c) => c.mode === 'auto').map((c) => capabilityName(locale, c.capability));
  const mixed = level === null
    ? `<p class="small">${esc(setAlone.length
      ? t(locale, 'autonomy.mixed', { list: formatList(locale, setAlone) })
      : t(locale, 'autonomy.mixed.none'))}</p>` : '';
  return `<section class="block level-control" id="on-her-own">
      <h2>${esc(t(locale, 'autonomy.title'))}</h2>
      ${heldEverywhere(e, locale, viewer)}
      <p class="muted small">${esc(t(locale, 'autonomy.intro'))}</p>
      ${holds}
      ${chosenBlock(e, locale)}
      <p class="muted small disclose">${esc(t(locale, 'autonomy.disclosure'))}</p>
      <!-- Waiting, not alarm: nothing has gone wrong, this is simply the one
           fact that decides whether the switch below it does what it says. -->
      ${e.ramp ? rampBlock(e.ramp, locale) : ''}
      ${e.earned === false ? `<p class="fwarn">${esc(t(locale, 'autonomy.notEarned.title'))}</p>
      <p class="muted">${esc(t(locale, 'autonomy.notEarned.body', { name: assistantName(locale) }))}</p>
      ${level !== 'waits' ? `<form method="post" action="/app/employee/autonomy"><input type="hidden" name="level" value="waits" />
        <button class="btn" type="submit">${esc(t(locale, 'autonomy.notEarned.stepDown'))}</button></form>` : ''}` : `<form method="post" action="/app/employee/autonomy" class="levels">
        ${mixed}
        ${AUTONOMY_LEVELS.filter((l) => !e.ramp || rungOfLevel(l) <= e.ramp.rung).map((l) => `<label class="level"><input type="radio" name="level" value="${l}"${level === l ? ' checked' : ''} required />
          <span><b>${esc(t(locale, `autonomy.level.${l}` as MessageKey))}</b>
          <span class="muted lnote">${esc(t(locale, `autonomy.level.${l}.note` as MessageKey))}</span></span></label>`).join('')}
        <button class="btn send" type="submit">${esc(t(locale, 'autonomy.save'))}</button>
      </form>`}
    </section>`;
}

/** A row of the menu: its shape, its name, where it stands now, and the door. Without a door, the value alone. */
type MenuRow = {
  readonly href: string | null; readonly icon: IconId; readonly label: string;
  readonly value?: string; readonly tone?: 'ok' | 'warn' | undefined; readonly desc?: string; readonly id?: string;
};
const menuRow = (r: MenuRow): string => {
  const inner = `${icon(r.icon)}<span class="sr-main"><span class="sr-label">${esc(r.label)}</span>${r.desc ? `<span class="sr-desc">${esc(r.desc)}</span>` : ''}</span>`
    + `${r.value ? `<span class="sr-value${r.tone ? ` ${r.tone}` : ''}"><bdi>${esc(r.value)}</bdi></span>` : ''}`;
  return `<li${r.id ? ` id="${r.id}"` : ''}>${r.href
    ? `<a class="srow sr-menu" href="${r.href}">${inner}<span class="go" aria-hidden="true">›</span></a>`
    : `<div class="srow sr-menu">${inner}</div>`}</li>`;
};
const menuGroup = (id: string, title: string, rows: readonly MenuRow[]): string =>
  `<section class="sgroup" aria-labelledby="ag-${id}"><h2 class="sgroup-h" id="ag-${id}">${esc(title)}</h2>
    <ul class="scard asst-menu">${rows.map(menuRow).join('')}</ul></section>`;

/**
 * The landing: the name, the control, the menu. Three groups, named by me as
 * the owner allowed: what the assistant says (what it can talk about, what it
 * was taught, what it still needs, the words it never uses); how it works with
 * you (its name, each kind of reply, one kind at a time, checking its work,
 * Practice); and how it is going (the month, what comes next, what changed).
 */
export function renderEmployee(
  e: EmployeeProfile, locale: Locale, flash: Flash | null, ctx?: HerContext, viewer: Viewer = OWNER_VIEW,
): string {
  const name = assistantName(locale);
  const st = standing(e, locale);
  const nothingYet = t(locale, 'her.menu.nothingYet');
  const met = e.conditions.filter((c) => c.met).length;

  const says: MenuRow[] = [
    { href: screenHref('talk'), icon: 'talk', label: t(locale, 'her.talk.title'),
      ...(e.products === undefined ? {} : { value: tn(locale, 'her.talk.products', e.products) }) },
    { href: '/app/knowledge', icon: 'book', label: t(locale, 'nav.knowledge'),
      value: e.knows ? tn(locale, 'knowledge.product.facts', e.knows) : nothingYet },
    { href: screenHref('learning'), icon: 'question', label: t(locale, 'her.teach.title'),
      ...(ctx ? ctx.gaps.length ? { value: tn(locale, 'her.menu.questions', ctx.gaps.length), tone: 'warn' as const }
        : { value: t(locale, 'setup.value.nothingWaiting') } : {}) },
    { href: '/app/settings/forbidden', icon: 'nope', label: t(locale, 'forbidden.title'),
      ...(e.words === undefined ? {} : { value: e.words ? tn(locale, 'forbidden.floor.count', e.words) : nothingYet }) },
  ];
  const works: MenuRow[] = [
    { href: screenHref('name'), icon: 'assistant', label: t(locale, 'her.menu.name'),
      ...(e.assistantNamed ? { value: name } : { value: t(locale, 'her.menu.name.unconfirmed'), tone: 'warn' as const }) },
    // Where it stands is a sentence here, so it is the line under the name, never a value cut short.
    { href: screenHref('replies'), icon: 'setup', label: t(locale, 'her.handles.title'), desc: st.stageLabel },
    // What stands here is a choice waiting to be made, if any: the kinds that
    // may go out alone now, said as the screen says it (a line, not a value).
    { href: screenHref('one-kind'), icon: 'settings', label: t(locale, 'employee.actions.title'),
      ...(viewer.isOwner && st.grantable.length
        ? { desc: t(locale, 'employee.actions.eligible', { cap: formatList(locale, st.grantable.map((c) => capabilityName(locale, c.capability))) }) } : {}) },
    // M34.7 — 抽查, the one thing here that asks the owner to act, so its row
    // carries the count in the waiting colour. Absent when there is nothing to
    // check — an empty ritual is worse than none. Today's line lands on it.
    ...(e.spotChecks.length ? [{ href: screenHref('checks'), icon: 'check' as const, label: t(locale, 'spotcheck.title'),
      value: tn(locale, 'today.spotChecks', e.spotChecks.length), tone: 'warn' as const, id: 'spot-checks' }] : []),
    { href: '/app/sandbox', icon: 'play', label: t(locale, 'nav.sandbox'), desc: t(locale, 'her.menu.practice') },
  ];
  const going: MenuRow[] = [
    { href: screenHref('month'), icon: 'calendar', label: t(locale, 'her.recent.title'),
      ...(ctx ? { desc: tn(locale, 'her.count.handled', ctx.handled) } : {}) },
    { href: screenHref('next'), icon: 'flag', label: t(locale, 'employee.promo.title'),
      ...(e.conditions.length ? { value: t(locale, 'nav.setup.progress', { done: met, total: e.conditions.length }) } : { desc: st.stageLabel }) },
    { href: screenHref('history'), icon: 'history', label: t(locale, 'employee.growth.title'),
      value: e.growth[0] ? show.date(locale, e.growth[0].at) : nothingYet },
  ];

  return `<h1 class="page">${esc(name)}</h1>
    ${flashBanner(flash)}
    ${levelControl(e, locale, viewer)}
    ${menuGroup('says', t(locale, 'her.group.says'), says)}
    ${menuGroup('works', t(locale, 'her.group.works'), works)}
    ${menuGroup('going', t(locale, 'her.group.going'), going)}`;
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
  const head = `${back('/app/employee', name)}<h1 class="page">${esc(screenTitle(locale, screen))}</h1>${flashBanner(flash)}`;

  switch (screen) {
    // Two doors, one data: what the assistant answers from, each line opening
    // the one place it is changed. Read only — no form here edits a fact.
    case 'talk': {
      const k = extras.talk;
      if (!k) return `${head}<div class="empty">${esc(t(locale, 'her.menu.nothingYet'))}</div>`;
      const more = k.products.total > k.products.names.length;
      // Each row is named as the page it opens is named, and lands on that page (w4-products-knowledge-04).
      const certs = k.certs.map((c) => claimName(locale, c));
      const rows: MenuRow[] = [
        { href: '/app/settings/profile', icon: 'business', label: t(locale, 'settings.profile.title'),
          value: t(locale, k.profileDone ? 'setup.state.done' : 'setup.state.toDo'), tone: k.profileDone ? 'ok' : 'warn' },
        ...(k.selling ? [{
          // How you sell's own menu, which staff may open too (its questions stay the owner's, rule 11).
          href: '/app/business/how-you-sell', icon: 'receipt' as const, label: t(locale, 'factory.sellhow.title'),
          desc: t(locale, 'setup.desc.selling'), value: t(locale, 'hs.progress', { done: k.selling.answered, total: k.selling.total }),
          tone: (k.selling.answered >= k.selling.total ? 'ok' : 'warn') as 'ok' | 'warn' }] : []),
        { href: '/app/products', icon: 'box', label: t(locale, 'nav.products'),
          // A product's name carries its figures ("38x40cm", "500ml"): isolated, so Arabic does not reorder them.
          desc: k.products.names.length ? `${show.isolateFigures(locale, k.products.names.join(' · '))}${more ? ' …' : ''}` : t(locale, 'factory.sell.empty'),
          value: tn(locale, 'her.talk.products', k.products.total) },
        { href: '/app/knowledge', icon: 'book', label: t(locale, 'nav.knowledge'),
          value: k.taught > 0 ? tn(locale, 'knowledge.product.facts', k.taught) : t(locale, 'knowledge.product.none') },
        // The certifications by name on the line under the row's name, which wraps; a value on a phone is one short line.
        { href: '/app/business/promises', icon: 'shield', label: t(locale, 'factory.promise.title'),
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
    // Phase 9 — the h1 of the landing names the assistant; this says what it
    // does today, and since when. Until the name is confirmed it says so, with
    // the way to confirm it (the owner's: `messaging_activation`); once it is,
    // the way to change it, where every assistant is named (A5).
    case 'name': {
      const door = !viewer.isOwner ? ''
        : !e.assistantNamed ? deeper('/app/onboarding', t(locale, 'autonomy.confirmName'))
        : deeper('/app/settings/people#assistants', t(locale, 'people.title'));
      return `${head}
        <p class="emp-called"><bdi>${esc(name)}</bdi></p>
        <div class="card emp">
          <div class="emp-stage">${esc(st.stageLabel)} · ${esc(t(locale, 'employee.role.reception'))}</div>
          ${/* CC-13 — the locale's own colon (it was the Chinese one in every language). */ ''}${e.hireDate ? `<div class="muted emp-hired">${esc(labelled(locale, t(locale, 'employee.hired'), show.date(locale, e.hireDate)))}</div>` : ''}
          ${e.assistantNamed ? '' : `<p class="fwarn">${esc(t(locale, 'employee.name.unconfirmed'))}</p>`}
        </div>
        ${door}`;
    }
    // 2 · What can she handle? Permission and trust boundaries — never a
    //     measure of how good she is. Promotion LOGIC is untouched; only the framing.
    case 'replies': {
      const cannotDo = [capName('confirm_order'), ...NEVER_ALLOWED.map((k) => t(locale, k))];
      return `${head}<div class="block">
        ${e.canDo.length === 0 && e.needConfirm.length === 0
          ? `<div class="empty">${esc(t(locale, 'her.handles.none'))}</div>` : ''}
        ${list(t(locale, 'her.handles.alone'), 'ok', st.alone.map(capName), t(locale, 'employee.duties.none'))}
        ${st.setButHeld.length ? `${list(t(locale, 'her.handles.held'), 'waiting', st.setButHeld.map(capName), '')}
          <p class="muted small">${esc(st.heldWhy)}</p>` : ''}
        ${list(t(locale, 'her.handles.waits'), 'waiting', e.needConfirm.map(capName), t(locale, 'employee.duties.none'))}
        ${list(t(locale, 'her.handles.always'), null, cannotDo, t(locale, 'employee.duties.none'))}
      </div>`;
    }
    // G9a — what she may do on her own is the owner's decision; staff see the
    // ladder but not the buttons that move her along it.
    case 'one-kind':
      return `${head}${!viewer.isOwner
        ? `<div class="block"><div class="muted empty">${esc(t(locale, 'staff.ownerDecides'))}</div></div>`
        : (st.grantable.length || st.revocable.length)
        ? `<div class="block">
            ${/* CC-29 — each asks first, in this block's own words: grant, revoke. Phase 9 — making a kind wait again is an ordinary choice the owner can undo: not red. */ ''}${st.revocable.map((c) => `<form method="post" action="/app/employee/capability/${esc(c.capability)}/revoke" class="actrow">
                <span>${esc(t(locale, 'employee.actions.granted', { cap: capName(c.capability) }))}</span><button class="btn" type="submit"
                  onclick="return confirm(this.dataset.confirm)"
                  data-confirm="${esc(t(locale, 'employee.actions.revokeConfirm', { cap: capName(c.capability) }))}">${esc(t(locale, 'employee.actions.revoke'))}</button></form>`).join('')}
            ${st.grantable.map((c) => `<form method="post" action="/app/employee/capability/${esc(c.capability)}/promote" class="actrow">
                <span>${esc(t(locale, 'employee.actions.eligible', { cap: capName(c.capability) }))}</span><button class="btn" type="submit"
                  onclick="return confirm(this.dataset.confirm)"
                  data-confirm="${esc(t(locale, 'employee.actions.grantConfirm', { cap: capName(c.capability) }))}">${esc(t(locale, 'employee.actions.grant'))}</button></form>`).join('')}
            ${st.grantable.length === 0 ? `<p class="muted">${esc(t(locale, 'employee.actions.more', { name }))}</p>` : ''}
            <p class="muted">${esc(t(locale, 'employee.actions.note'))}</p>
          </div>`
        : `<div class="block"><div class="muted empty">${esc(t(locale, 'employee.actions.empty'))}</div></div>`}`;
    // M34.7 — 抽查: is the trust warranted? The work itself, and the words to answer it with.
    case 'checks':
      return `${head}${e.spotChecks.length
        ? `<div class="block">
            <p class="muted review-intro">${esc(t(locale, 'spotcheck.intro', { name }))}</p>
            ${e.spotChecks.map((s) => {
              const act = `/app/employee/spot-check/${encodeURIComponent(s.id)}`;
              return `<div class="scheck">
                <div class="muted sclabel">${esc(t(locale, 'spotcheck.buyerSaid'))}</div>
                <div class="scsaid"><bdi>${esc(s.buyerMessage)}</bdi></div>
                <div class="muted sclabel">${esc(t(locale, s.wasAuto ? 'spotcheck.sentAlone' : 'spotcheck.sheReplied', { name }))}</div>
                <div class="proposed"><bdi>${esc(s.reply)}</bdi></div>
                <form method="post" action="${act}" class="acts">
                  <button class="btn send" name="answer" value="好">${esc(t(locale, 'spotcheck.ok'))}</button>
                  <button class="btn danger" name="answer" value="有问题">${esc(t(locale, 'spotcheck.problem'))}</button>
                </form>
                <details class="scfix"><summary>${esc(t(locale, 'spotcheck.fix'))}</summary>
                  <form method="post" action="${act}">
                    <textarea name="answer" rows="2" required
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
    case 'next':
      return `${head}<div class="block">
        <div class="pstage">${esc(labelled(locale, t(locale, 'employee.promo.current'), st.stageLabel))}</div>
        ${st.alone.length
          ? `<div class="muted">${esc(t(locale, 'employee.promo.done'))}</div>`
          : `<div class="pstage">${esc(labelled(locale, t(locale, 'employee.promo.next'), t(locale, 'employee.stage.partial')))}</div>
             ${st.setButHeld.length ? `<p class="muted small">${esc(st.heldWhy)}</p>` : ''}`}
        ${e.conditions.length ? `<div class="conds">${e.conditions.map((c) =>
          `<div class="cond">${signalMark(c.met ? 'ok' : 'waiting')} ${esc(t(locale, `employee.promo.cond.${c.cond}` as MessageKey, { name }))}</div>`).join('')}</div>` : ''}
      </div>`;
    case 'history':
      return `${head}<div class="block">
        ${e.growth.length
          ? `<ul class="growth">${e.growth.map((g) => {
              const text = g.kind === 'self_demote'
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
