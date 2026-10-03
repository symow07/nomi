import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';
import type { ProviderObserver } from '../llm/provider.js';
import { classifyProviderFailure, classifyProviderResponse, providerWords } from '../llm/providerFailure.js';
import {
  BURN_WINDOW_MS, balanceVerdict, mostUrgent, parseDeepSeekBalance, refusalAlertDue,
  type BalanceReading, type BalanceStep,
} from '../core/ops/providerWatch.js';
import {
  balanceHistory, claimBalanceAlert, claimRecovery, claimRefusalAlert, providerHealth,
  rearmBalanceAlerts, recordAnswered, recordBalance, recordRefusal,
} from '../db/providerState.js';

/**
 * BILLING RESILIENCE (2026-10-04) — the model provider's account, watched.
 *
 * On 2026-10-01 the provider stopped answering because Nomi's account with it
 * was out of credit, and nothing said so for hours. Now:
 *
 *   · EVERY CALL TELLS THE STATE (`observe`, given to every model client): a
 *     billing refusal starts or continues the outage (0128 `provider_health`),
 *     any answer ends it. A turn that is refused hands its customer to a
 *     person at once, as `provider_billing` (src/worker/main.ts) — no queue
 *     retries, nothing sent, rule 19's silent hand-off under the real reason.
 *   · THE OPERATOR IS TOLD, ESCALATING: at the first refusal, after an hour,
 *     after six, then daily while it lasts (`refusalAlertDue`), and once when
 *     it answers again. By the operator-alert path: e-mail always, WhatsApp
 *     where the existing rules allow (`deliverOperatorAlert`).
 *   · NOBODY WAITS FOR A CUSTOMER TO FIND OUT IT IS BACK: every five minutes,
 *     while refusing, one small call asks (`sweep`); a success ends it.
 *   · THE BALANCE, BEFORE IT RUNS OUT: hourly, where the provider has a
 *     balance to read (DeepSeek's /user/balance; Anthropic offers none), the
 *     floor, three days, one day, and "no longer available" (`balanceSweep`).
 *     Figures go to the operator only.
 *
 * Auto-topup is not built: neither provider offers a way to add credit by API
 * (docs/PROGRESS — the finding and its sources). These alerts are what is left.
 */

export type ProviderWatchDeps = {
  readonly db: Db;
  /** The workspace whose owner runs this installation: the alerts go there. Null: written down, nobody told. */
  readonly operatorBusinessId: string | null;
  /** Queue one operator alert (QUEUES.notify). */
  readonly send: (job: NotifyJob, key: string) => Promise<void>;
  /** The provider's name as alerts say it: DeepSeek, Anthropic. */
  readonly provider: string;
  /**
   * One small call that proves the provider answers again. Null: never asked —
   * a test that scripted no model must never reach a real one (CLAUDE.md #48).
   */
  readonly probe: (() => Promise<void>) | null;
  /** The provider's balance, where it offers one. Null: it does not (Anthropic), or a test. */
  readonly readBalance: (() => Promise<BalanceReading | null>) | null;
  /** `LLM_BALANCE_FLOOR`, as set. */
  readonly floorSetting?: string | undefined;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
};

export type ProviderWatch = {
  /** Given to every model client: every answer the provider sent, whole. */
  readonly observe: ProviderObserver;
  /** A billing refusal, written down (once per refused call), and the operator's alert if one is due. */
  readonly refused: (words: string) => Promise<void>;
  /** A call answered: ends the outage if there was one, and tells the operator so. */
  readonly answered: () => Promise<void>;
  /**
   * Was this failure a billing refusal? The provider's words if so, else null.
   * A timeout counts too when the provider's balance says it no longer pays
   * for a call (`is_available: false`): the 2026-10-01 stall said nothing
   * else, and the balance is how the real reason can be told.
   */
  readonly billingReason: (e: unknown) => Promise<string | null>;
  /** Every five minutes: ask while refusing, escalate when due, tell the end. */
  readonly sweep: () => Promise<void>;
  /** Every hour: the balance's steps. */
  readonly balanceSweep: () => Promise<void>;
  /** Wait for what `observe` started (tests, and a turn that saw the same refusal). */
  readonly settled: () => Promise<void>;
};

/** How long one balance reading is trusted when a timeout asks it. */
const BALANCE_FRESH_MS = 60_000;
/** A refusal the observer wrote this recently is the one a failed turn is reporting: not written twice. */
const SAME_REFUSAL_MS = 10_000;

export function providerWatch(deps: ProviderWatchDeps): ProviderWatch {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.warn(line));
  /**
   * In this process: might the provider be refusing? True at boot (the record
   * may say so), after any refusal seen, and after a sweep that read it so —
   * so an answer is checked against the record only then, not on every call.
   */
  let suspect = true;
  let observedAt = 0;
  let pending: Promise<void> = Promise.resolve();
  let balance: { readonly at: number; readonly reading: BalanceReading | null } | null = null;

  const track = (p: Promise<void>): void => {
    pending = pending.then(() => p).catch(() => undefined);
  };

  async function alertDue(): Promise<void> {
    if (!deps.operatorBusinessId) return;
    const h = await providerHealth(deps.db);
    if (!h.refusingSince) return;
    const step = refusalAlertDue(h.refusingSince, h.alertsSent, now());
    if (step === null) return;
    if (!(await claimRefusalAlert(deps.db, step, h.refusingSince))) return;
    await deps.send({
      businessId: deps.operatorBusinessId, kind: 'provider_refusing', conversationId: null,
      providerRefusal: { provider: deps.provider, since: h.refusingSince.toISOString(), step, words: h.words ?? '' },
    }, `provider_refusing:${h.refusingSince.toISOString()}:${step}`);
    log(`[provider] ${deps.provider} refuses for billing since ${h.refusingSince.toISOString()}: operator alert ${step + 1} sent`);
  }

  async function recoveryNotice(): Promise<void> {
    if (!deps.operatorBusinessId) return;
    const r = await claimRecovery(deps.db);
    if (!r) return;
    await deps.send({
      businessId: deps.operatorBusinessId, kind: 'provider_answering', conversationId: null,
      providerRefusal: { provider: deps.provider, since: r.since.toISOString(), step: 0, words: '', until: r.until.toISOString() },
    }, `provider_answering:${r.since.toISOString()}`);
  }

  const refused = async (words: string): Promise<void> => {
    suspect = true;
    const r = await recordRefusal(deps.db, providerWords(words));
    if (r.began) log(`[provider] ${deps.provider} refused for billing: ${providerWords(words)}`);
    await alertDue();
  };

  const answered = async (): Promise<void> => {
    if (!suspect) return;
    suspect = false;
    const ended = await recordAnswered(deps.db);
    if (!ended) return;
    log(`[provider] ${deps.provider} answers again (refused for billing since ${ended.since.toISOString()})`);
    await recoveryNotice();
  };

  const observe: ProviderObserver = ({ status, text }) => {
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* not JSON: its words are the text */ }
    const c = classifyProviderResponse(status, body);
    if (c === null) {
      if (suspect) track(answered().catch((e: unknown) => log(`[provider] could not record the answer: ${(e as Error).message}`)));
      return;
    }
    if (c.kind !== 'billing') return;
    observedAt = Date.now();
    track(refused(c.words).catch((e: unknown) => log(`[provider] could not record the refusal: ${(e as Error).message}`)));
  };

  const balanceNow = async (): Promise<BalanceReading | null> => {
    if (!deps.readBalance) return null;
    if (balance && Date.now() - balance.at < BALANCE_FRESH_MS) return balance.reading;
    let reading: BalanceReading | null = null;
    try { reading = await deps.readBalance(); } catch { reading = null; }
    balance = { at: Date.now(), reading };
    return reading;
  };

  const billingReason = async (e: unknown): Promise<string | null> => {
    const f = classifyProviderFailure(e);
    let words: string | null = null;
    if (f.kind === 'billing') words = f.words;
    else if (f.kind === 'timeout') {
      const r = await balanceNow();
      if (r && !r.available) words = 'no answer in time, and the balance no longer pays for a call (is_available: false)';
    }
    if (words === null) return null;
    // The observer saw this very refusal a moment ago and is writing it: wait for that, not a second row.
    if (Date.now() - observedAt < SAME_REFUSAL_MS) await pending;
    else await refused(words);
    return words;
  };

  const sweep = async (): Promise<void> => {
    const h = await providerHealth(deps.db);
    if (h.refusingSince) {
      suspect = true;
      if (deps.probe) {
        try {
          await deps.probe();
          await pending;            // the observer already ended it, if the probe's client has one
          await answered();
        } catch (e) {
          const words = await billingReason(e).catch(() => null);
          if (words === null) log(`[provider] still no answer (${classifyProviderFailure(e).kind})`);
        }
      }
      await alertDue();
    }
    await recoveryNotice();
  };

  const balanceSweep = async (): Promise<void> => {
    if (!deps.readBalance) return;
    balance = null;
    const reading = await balanceNow();
    if (!reading) { log('[provider] the balance could not be read'); return; }
    const at = now();
    const history = await balanceHistory(deps.db, new Date(at.getTime() - BURN_WINDOW_MS));
    const verdict = balanceVerdict(reading, history, at, deps.floorSetting);
    if (verdict.line) await recordBalance(deps.db, reading.available, verdict.line);
    if (verdict.line && verdict.floor === null) log(`[provider] no floor is set for ${verdict.line.currency}: LLM_BALANCE_FLOOR sets one`);
    await rearmBalanceAlerts(deps.db, verdict.steps);
    const claimed: BalanceStep[] = [];
    for (const step of verdict.steps) if (await claimBalanceAlert(deps.db, step)) claimed.push(step);
    const step = mostUrgent(claimed);
    if (!step || !deps.operatorBusinessId) return;
    const line = verdict.line;
    await deps.send({
      businessId: deps.operatorBusinessId, kind: 'provider_balance', conversationId: null,
      providerBalance: {
        provider: deps.provider, step, currency: line?.currency ?? '', total: line?.total ?? 0,
        floor: verdict.floor, daysLeft: verdict.daysLeft, available: reading.available,
      },
    }, `provider_balance:${step}:${at.toISOString().slice(0, 13)}`);
    log(`[provider] balance ${line?.currency ?? ''} ${line?.total ?? 0}: ${step}`);
  };

  return { observe, refused, answered, billingReason, sweep, balanceSweep, settled: () => pending };
}

/**
 * DeepSeek's balance, read with the installation's key: one GET, fifteen
 * seconds at most. The key is a header and nothing else; the answer is parsed
 * for its figures and nothing is logged of it.
 * (GET https://api.deepseek.com/user/balance — api-docs.deepseek.com/api/get-user-balance)
 */
export function deepSeekBalanceReader(
  endpoint: string, apiKey: string, fetchImpl: typeof fetch = fetch,
): () => Promise<BalanceReading | null> {
  return async () => {
    const res = await fetchImpl(endpoint, {
      method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return parseDeepSeekBalance(await res.json().catch(() => null));
  };
}
