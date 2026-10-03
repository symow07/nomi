import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * TZ — the zone of the workspace this request is for, set with the rest of
 * the request's facts (`withWorkspace` in say.ts). Its own module because
 * values.ts, which every date on a page goes through, is imported BY say.ts.
 * Outside a workspace (a public page, a test drawing a fragment) it is UTC —
 * never a business's zone it does not belong to.
 */
const store = new AsyncLocalStorage<string>();

export const withZone = <T>(zone: string, fn: () => T): T => store.run(zone, fn);

export const workspaceZone = (): string => store.getStore() ?? 'UTC';

/**
 * Phase 9 (V1-009, V1-404) — the workspace's country (`businesses.country`,
 * asked at sign-up), for the way an amount is written on its pages: Spanish
 * in Mexico writes 1.05, in Spain 1,05. Set with the zone, for the same
 * reason. Outside a workspace, or for one with no country on record, there is
 * none, and an amount is written as it always was.
 */
const country = new AsyncLocalStorage<string | null>();

export const withCountry = <T>(code: string | null, fn: () => T): T => country.run(code, fn);

export const workspaceCountry = (): string | null => country.getStore() ?? null;

/**
 * The warmth run, phase 9 (w4-products-knowledge-08) — a workspace with no
 * country on record (the demo, one made before sign-up asked): inside it the
 * store holds null; outside any workspace it holds nothing at all.
 */
export const countryUnknown = (): boolean => country.getStore() === null;
