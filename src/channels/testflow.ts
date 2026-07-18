import type { ChannelAdapter } from './contract.js';
import type { TestVerdict } from '../core/owner/channel.js';

/**
 * M3 — 测试连接. Five independent checks; the owner sees one simple result,
 * support sees which check failed. Safe by construction: the only message it
 * sends goes to the owner's own number, never to a buyer.
 */

export type TestChecks = {
  readonly outboundAccepted: boolean;      // provider accepted our send
  readonly statusCallbackSeen: boolean;    // a delivery status came back
  readonly inboundSeen: boolean;           // we have received any real inbound
  readonly orderingOk: boolean;            // sequencer invariant holds on recent rows
  readonly persisted: boolean;             // events landed in the database
};

export function summarizeTest(c: TestChecks): { verdict: TestVerdict; devDetail: readonly string[] } {
  const outboundOk = c.outboundAccepted && c.statusCallbackSeen;
  const detail = [
    `outbound_accepted=${c.outboundAccepted}`,
    `status_callback=${c.statusCallbackSeen}`,
    `inbound_seen=${c.inboundSeen}`,
    `ordering=${c.orderingOk}`,
    `persisted=${c.persisted}`,
  ];
  // Persistence or ordering failure means nothing can be trusted → reconnect.
  if (!c.persisted || !c.orderingOk) return { verdict: 'reconnect', devDetail: detail };
  if (outboundOk && c.inboundSeen) return { verdict: 'all_good', devDetail: detail };
  if (!outboundOk && c.inboundSeen) return { verdict: 'inbound_only', devDetail: detail };
  if (outboundOk) return { verdict: 'outbound_only', devDetail: detail };
  return { verdict: 'reconnect', devDetail: detail };
}

/** Ports the runner needs — implemented by the DB layer, faked in tests. */
export type TestFlowPorts = {
  readonly adapter: ChannelAdapter;
  readonly ownerPhone: string;                          // test message goes HERE
  /** Wait until a status webhook for this message id is recorded (or timeout). */
  waitForStatus(providerMessageId: string, timeoutMs: number): Promise<boolean>;
  /** Has ANY inbound event ever been recorded for this channel? */
  hasInboundEvents(): Promise<boolean>;
  /** Do recent outbound rows satisfy the sequencer invariant? */
  checkOrdering(): Promise<boolean>;
  /** Round-trip a marker row through the database. */
  checkPersistence(): Promise<boolean>;
};

export const TEST_MESSAGE_BODY = '【测试】连接检查，不用回复。';

export async function runTestConnection(
  ports: TestFlowPorts,
  opts: { statusTimeoutMs: number } = { statusTimeoutMs: 15_000 },
): Promise<{ verdict: TestVerdict; checks: TestChecks; devDetail: readonly string[] }> {
  const persisted = await ports.checkPersistence();
  const orderingOk = await ports.checkOrdering();
  const inboundSeen = await ports.hasInboundEvents();

  const sent = await ports.adapter.sendText(ports.ownerPhone, TEST_MESSAGE_BODY);
  const outboundAccepted = sent.ok;
  const statusCallbackSeen = sent.ok
    ? await ports.waitForStatus(sent.providerMessageId, opts.statusTimeoutMs)
    : false;

  const checks: TestChecks = { outboundAccepted, statusCallbackSeen, inboundSeen, orderingOk, persisted };
  const { verdict, devDetail } = summarizeTest(checks);
  return { verdict, checks, devDetail };
}
