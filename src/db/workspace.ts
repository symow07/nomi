import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { mainAssistant } from './assistants.js';
import { setupProgress, type SetupProgress } from './setup.js';

/**
 * D — the facts about a workspace that EVERY page needs before it draws
 * anything: who answers (A5.2), whether the outreach area is shown at all, and
 * how far setup has come. One look-up per request, cached for a minute by the
 * web layer and forgotten the moment any of it changes (see `facts.evict` in
 * app.ts), so a page costs no extra round-trip for any of the three.
 */
export type WorkspaceFacts = {
  /** The main assistant's name, once the owner chose it; else null. */
  readonly name: string | null;
  /** More than one assistant: the nav says "Team" instead of a name. */
  readonly several: boolean;
  /** The outreach area (sequences, prospects, writing first) exists for this workspace. */
  readonly outreach: boolean;
  readonly setup: SetupProgress;
};

/**
 * Decided 2026-09-21: the whole outreach area sits behind a per-workspace
 * switch, OFF for a new workspace. Hidden means no links anywhere and no
 * route answering — not merely no nav entry — and `outreachFacts` treats a
 * hidden area as not enabled, so nothing is written first from it either.
 * There is no owner-facing switch: an owner turns nothing on that they cannot
 * see. The operator tool `tools/outreach-area.mjs` does.
 */
export async function outreachAreaShown(tx: Tx, businessId: BusinessId): Promise<boolean> {
  const r = (await sql<{ on: boolean }>`
    select outreach_area as on from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0];
  return r?.on === true;
}

export async function workspaceFacts(tx: Tx, businessId: BusinessId): Promise<WorkspaceFacts> {
  // Sequential on purpose: one transaction is one connection.
  const who = await mainAssistant(tx, businessId);
  const outreach = await outreachAreaShown(tx, businessId);
  const setup = await setupProgress(tx, businessId);
  return { name: who.name, several: who.several, outreach, setup };
}
