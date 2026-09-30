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
