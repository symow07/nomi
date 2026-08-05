import { describe, it, expect } from 'vitest';
import {
  checkMetaReadiness, credentialState, META_CREDENTIALS, META_SHAPE, META_ENV_VAR,
} from '../../src/core/channel/metaReadiness.js';
import { renderPilotRunbook, type PilotRunbook } from '../../src/api/web/pilot.js';
import { validateEnv } from '../../src/main.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * M17.2 — go-live PREPARATION. The whole point of these tests is that nothing
 * here can switch messaging on: the check is pure, offline, value-free, and
 * `live` stays false until an operator explicitly activates the channel.
 */

const GOOD = {
  accessToken: 'x'.repeat(40),
  phoneNumberId: '123456789012345',
  businessAccountId: '987654321098765',
  appSecret: 'y'.repeat(32),
  verifyToken: 'z'.repeat(24),
  graphVersion: 'v23.0',
};

const rb = (): PilotRunbook => ({
  readiness: {
    detected: { profile: true, products: true, knowledge: true, claims: true, sandbox: true, channel: false },
    attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null },
    validation: { at: null, pass: null, total: null },
    readyToLaunch: false,
  },
  operations: {
    range: 'week',
    attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
    activity: { handled: 0, draftsCreated: 0, corrections: 0 },
    knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
    channel: { status: 'not_connected', provider: 'disabled' },
    hasAttention: false,
  },
  rehearsal: {
    available: true,
    done: { takeover: false, ownerReply: false, resume: false, knowledgeCorrection: false, validationPassed: false },
    completed: 0, total: 5,
  },
  reliability: { stuckOutbound: 0, oldestQueuedAt: null },
});

describe('M17.2 · Meta credential validation (pure, offline)', () => {
  it('classifies every credential: missing / placeholder / malformed / ok', () => {
    expect(credentialState('accessToken', undefined)).toBe('missing');
    expect(credentialState('accessToken', '   ')).toBe('missing');
    expect(credentialState('accessToken', 'CHANGE_ME_please')).toBe('placeholder');
    expect(credentialState('accessToken', 'too-short')).toBe('malformed');
    expect(credentialState('accessToken', GOOD.accessToken)).toBe('ok');

    expect(credentialState('phoneNumberId', 'not-digits')).toBe('malformed');
    expect(credentialState('phoneNumberId', GOOD.phoneNumberId)).toBe('ok');
    expect(credentialState('graphVersion', '23.0')).toBe('malformed');   // needs the v
    expect(credentialState('graphVersion', GOOD.graphVersion)).toBe('ok');
  });

  it('every credential has an env var name and a shape — no silent gaps', () => {
    for (const k of META_CREDENTIALS) {
      expect(META_ENV_VAR[k], k).toBeTruthy();
      expect(typeof META_SHAPE[k], k).toBe('function');
    }
    expect(META_CREDENTIALS).toHaveLength(6);
  });

  it('the shapes are the SAME ones the fail-closed boot check uses', () => {
    // A value this module calls ok must let meta mode boot; one it calls
    // malformed must not. If these ever diverge, the readiness page would lie.
    const base = {
      DATABASE_URL: 'postgres://u@h/db', ANTHROPIC_API_KEY: 'k'.repeat(40),
      WEBHOOK_VERIFY_TOKEN: GOOD.verifyToken, CREDENTIAL_KEY: 'a'.repeat(64),
      WHATSAPP_PROVIDER: 'meta', META_GRAPH_API_VERSION: GOOD.graphVersion,
      META_WHATSAPP_ACCESS_TOKEN: GOOD.accessToken,
      META_WHATSAPP_PHONE_NUMBER_ID: GOOD.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: GOOD.businessAccountId,
      META_APP_SECRET: GOOD.appSecret,
    };
    expect(validateEnv(base).ok).toBe(true);
    expect(checkMetaReadiness({ values: GOOD, provider: 'meta', channelStatus: 'connected' }).allCredentialsOk).toBe(true);

    const bad = { ...base, META_WHATSAPP_PHONE_NUMBER_ID: 'not-digits' };
    expect(validateEnv(bad).ok).toBe(false);
    expect(checkMetaReadiness({
      values: { ...GOOD, phoneNumberId: 'not-digits' }, provider: 'meta', channelStatus: 'connected',
    }).allCredentialsOk).toBe(false);
  });
});

describe('M17.2 · readiness never switches anything on', () => {
  it('the current pilot state: nothing configured, nothing live, blockers named', () => {
    const r = checkMetaReadiness({ values: {}, provider: 'disabled', channelStatus: 'not_connected' });
    expect(r.allCredentialsOk).toBe(false);
    expect(r.live).toBe(false);
    expect(r.credentials.every((c) => c.state === 'missing')).toBe(true);
    expect(r.blockers).toEqual(['credentials_incomplete', 'provider_disabled', 'channel_not_connected']);
  });

  it('perfect credentials alone are NOT live — the provider must be on AND the channel connected', () => {
    const creds = checkMetaReadiness({ values: GOOD, provider: 'disabled', channelStatus: 'not_connected' });
    expect(creds.allCredentialsOk).toBe(true);
    expect(creds.live).toBe(false);                       // preparation ≠ activation
    expect(creds.blockers).toEqual(['provider_disabled', 'channel_not_connected']);

    const halfway = checkMetaReadiness({ values: GOOD, provider: 'meta', channelStatus: 'not_connected' });
    expect(halfway.live).toBe(false);
    expect(halfway.blockers).toEqual(['channel_not_connected']);

    const live = checkMetaReadiness({ values: GOOD, provider: 'meta', channelStatus: 'connected' });
    expect(live.live).toBe(true);
    expect(live.blockers).toEqual([]);
  });

  it('the report NEVER carries a credential value', () => {
    const r = checkMetaReadiness({ values: GOOD, provider: 'meta', channelStatus: 'connected' });
    const blob = JSON.stringify(r);
    for (const v of Object.values(GOOD)) {
      if (v === 'v23.0') continue;                        // the interface version is not a secret
      expect(blob.includes(v), `leaked ${v.slice(0, 6)}…`).toBe(false);
    }
  });
});

describe('M17.2 · rendered on the runbook (localized, value-free)', () => {
  it('renders in en/zh/ar and states plainly that messaging is not live', () => {
    const r = checkMetaReadiness({ values: {}, provider: 'disabled', channelStatus: 'not_connected' });
    for (const l of LOCALES) {
      const html = renderPilotRunbook(rb(), l, null, undefined, r);
      expect(html).toContain(t(l, 'meta.title'));
      expect(html).toContain(t(l, 'meta.notLive'));
      expect(html).toContain(t(l, 'meta.state.missing'));
      expect(html).toContain(t(l, 'meta.blocker.provider_disabled'));
      expect(html).not.toContain(t(l, 'meta.live'));
    }
  });

  it('shows ✓ per configured credential and never prints the value', () => {
    const r = checkMetaReadiness({ values: GOOD, provider: 'disabled', channelStatus: 'not_connected' });
    const html = renderPilotRunbook(rb(), 'en', null, undefined, r);
    expect(html).toContain('✓');
    expect(html).toContain(t('en', 'meta.cred.accessToken'));
    expect(html).toContain(t('en', 'meta.state.ok'));
    expect(html).not.toContain(GOOD.accessToken);
    expect(html).not.toContain(GOOD.appSecret);
    expect(html).toContain(t('en', 'meta.notLive'));      // still not live
  });

  it('the section is omitted when not supplied, and carries no percentage', () => {
    expect(renderPilotRunbook(rb(), 'en', null)).not.toContain(t('en', 'meta.title'));
    const r = checkMetaReadiness({ values: GOOD, provider: 'meta', channelStatus: 'connected' });
    expect(renderPilotRunbook(rb(), 'en', null, undefined, r)).not.toMatch(/\d+\s*%/);
  });
});
