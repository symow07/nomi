/**
 * M3 — Connection health: derive one honest status from raw signals.
 *
 * Owner sees exactly five statuses (已连接 / 正在连接 / 需要处理 / 已断开 /
 * 暂时异常) plus, when something is wrong, the three-part problem structure.
 * Raw diagnostics (error strings, counters) stay internal — they ride along
 * in `devDetail` for support, never on an owner surface.
 */

export type ChannelStatus =
  | 'connected' | 'connecting' | 'needs_attention' | 'disconnected' | 'degraded';

export const CHANNEL_STATUS_ZH: Record<ChannelStatus, string> = {
  connected: '已连接',
  connecting: '正在连接',
  needs_attention: '需要处理',
  disconnected: '已断开',
  degraded: '暂时异常',
};

export type HealthSignals = {
  readonly credentialActive: boolean;      // provider auth currently valid
  readonly connecting: boolean;            // wizard/reconnect in progress
  readonly disconnectedByOwner: boolean;
  readonly lastInboundAt: Date | null;
  readonly lastDeliveredAt: Date | null;
  readonly lastWebhookAt: Date | null;     // any provider contact at all
  readonly consecutiveSendFailures: number;
  readonly lastError: string | null;       // internal detail — never shown
};

export type OwnerProblem = {
  readonly whatHappened: string;
  readonly beingDone: string;
  readonly whatYouDo: string | null;
};

export type ChannelHealth = {
  readonly status: ChannelStatus;
  readonly inboundOk: boolean;             // can messages come in
  readonly outboundOk: boolean;            // can messages go out
  readonly problem: OwnerProblem | null;   // owner language, three parts
  readonly devDetail: string | null;       // internal only
};

/** Send failures in a row before the owner should hear about it. */
export const DEGRADED_AFTER_FAILURES = 3;

export function deriveHealth(s: HealthSignals, employeeName: string): ChannelHealth {
  if (s.disconnectedByOwner) {
    return {
      status: 'disconnected', inboundOk: false, outboundOk: false,
      problem: {
        whatHappened: '你断开了 WhatsApp 连接。',
        beingDone: `${employeeName}收不到新消息，也不会再发消息。`,
        whatYouDo: '想恢复接待，点「重新连接」，两分钟搞定。',
      },
      devDetail: s.lastError,
    };
  }
  if (s.connecting) {
    return {
      status: 'connecting', inboundOk: false, outboundOk: false,
      problem: null, devDetail: s.lastError,
    };
  }
  if (!s.credentialActive) {
    return {
      status: 'needs_attention', inboundOk: false, outboundOk: false,
      problem: {
        whatHappened: 'WhatsApp 需要重新登录。',
        beingDone: `${employeeName}暂时收不到新消息。`,
        whatYouDo: '点「重新连接」，两分钟搞定。',
      },
      devDetail: s.lastError,
    };
  }
  if (s.consecutiveSendFailures >= DEGRADED_AFTER_FAILURES) {
    return {
      status: 'degraded',
      inboundOk: s.lastWebhookAt !== null,
      outboundOk: false,
      problem: {
        whatHappened: '最近几条消息暂时没发出去。',
        beingDone: '正在自动重试，发出去了会告诉你。',
        whatYouDo: null,   // the honest answer: nothing
      },
      devDetail: s.lastError,
    };
  }
  return {
    status: 'connected',
    inboundOk: true,
    outboundOk: true,
    problem: null,
    devDetail: null,
  };
}
