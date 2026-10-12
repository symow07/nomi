import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gateOutbound } from '../../src/core/channel/sendGate.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { renderDataDeletion } from '../../src/api/web/legal.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * D4 (the owner's decision, 2026-10-12) — FROZEN ON LAPSE, NEVER ERASED BY A
 * TIMER. A lapsed workspace messages no customer at all (the owner's own
 * replies included: "that's the paid product"), receives nothing new, and its
 * dashboard is read-only except taking a copy, closing it, renewing, a
 * customer's deletion request, and taking someone's access away.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');
const openPlan = { action: 'send_free', ownerNoteZh: '' } as const;
const base = {
  assignedTo: null, paused: false, windowPlan: openPlan, activated: true, silenced: false, stopped: false,
  pilotMode: false, recipientAllowed: true, dailyCeilingReached: false,
} as const;

describe('D4 · the send gate: frozen refuses everything, first', () => {
  it('every origin, and even the line that answers a stop', () => {
    for (const origin of ['employee', 'owner', 'outreach'] as const) {
      expect(gateOutbound({ ...base, origin, frozen: true }), origin).toEqual({ allow: false, reason: 'frozen' });
    }
    expect(gateOutbound({ ...base, origin: 'employee', notice: 'opt_out', frozen: true })).toEqual({ allow: false, reason: 'frozen' });
    // The control: not frozen, the assistant's and the owner's messages go.
    for (const origin of ['employee', 'owner'] as const) expect(gateOutbound({ ...base, origin, frozen: false }).allow, origin).toBe(true);
    // Before activation too: frozen is the first question.
    expect(gateOutbound({ ...base, origin: 'owner', activated: false, frozen: true })).toEqual({ allow: false, reason: 'frozen' });
  });
  it('the store reads it at send time, required all the way down; the worker suppresses as frozen first', () => {
    expect(read('src/db/channels.ts')).toContain('frozen: await billingHeld(tx),');
    expect(read('src/outbound/worker.ts')).toContain('frozen: ctx.frozen,');
    expect(read('src/outbound/worker.ts')).toContain("const suppressReason = ctx.frozen ? 'frozen' as const");
  });
});

describe('D4 · nothing new is received', () => {
  it('the webhooks, the e-mail reply hook and the mailbox reader drop what arrives', () => {
    expect(read('src/main.ts')).toMatch(/if \(await withTenantTx\(db, bid, \(tx\) => billingHeld\(tx\)\)\) return 'duplicate';/);
    expect(read('src/pipeline/emailReply.ts')).toMatch(/billingHeld\(tx\)\)\) return \{ outcome: 'frozen', conversationId: null \};/);
    expect(read('src/channels/email/inboxReader.ts')).toMatch(/billingHeld\(tx\)\)\) return \{ outcome: 'not_reading' \};/);
  });
});

describe('D4 · the dashboard is read-only, with the doors that must stay open', () => {
  it('one gate refuses every write but these, reading the hold fresh', () => {
    const app = read('src/api/web/app.ts');
    const list = app.slice(app.indexOf('const FROZEN_STILL_OPEN'), app.indexOf('];', app.indexOf('const FROZEN_STILL_OPEN')));
    for (const door of ['billing', 'data\\/(close|delete|withdraw)', 'deletion(\\/(erase|dismiss))?', 'account\\/password',
      'people\\/[^/]+\\/remove', 'phone\\/[^/]+\\/remove', '(mail|meta|whatsapp)\\/disconnect']) {
      expect(list, door).toContain(door);
    }
    expect(list.match(/\/\^/g)?.length).toBe(7);
    expect(app).toMatch(/if \(!\(await withTenantTx\(deps\.db, bid\.value, \(tx\) => billingHeld\(tx\)\)\)\) return;\s*const back/);
  });
  it('every language says what frozen means and the way back, and the refusal names Billing', () => {
    for (const l of LOCALES) {
      for (const k of ['frozen.banner.title', 'frozen.banner.body', 'frozen.banner.billing', 'frozen.banner.data', 'frozen.refused', 'refused.why.frozen', 'refused.do.frozen'] as const) {
        expect(t(l, k).length, `${l} ${k}`).toBeGreaterThan(5);
      }
      expect(t(l, 'frozen.refused'), l).toContain(t(l, 'billing.title'));
    }
  });
});

describe('D4 · one notice when it freezes: what frozen means, and the way back — no countdown', () => {
  const frozen = { en: /frozen/i, zh: /冻结/, ar: /تجمّد|مجمّد/, es: /congelado/i, fr: /gelé/i } as const;
  it('the lapse e-mail, the Billing line and Setup say frozen, in every language; none promises "Needs you" any more', () => {
    for (const l of LOCALES) {
      for (const k of ['notify.billing_lapsed.subject', 'notify.billing_lapsed', 'billing.status.lapsed', 'setup.value.billing.lapsed'] as const) {
        expect(t(l, k), `${l} ${k}`).toMatch(frozen[l]);
      }
    }
    expect(t('en', 'notify.billing_lapsed')).toMatch(/nothing is deleted on its own/);
    expect(t('en', 'notify.billing_lapsed')).toMatch(/take a copy of your data/);
    expect(t('en', 'notify.billing_lapsed')).toMatch(/close the workspace/);
    expect(t('en', 'notify.billing_lapsed')).not.toMatch(/Needs you|paused/);
  });
});

describe('D4 · the pages say it plainly: a lapse freezes, and only a request or closing erases', () => {
  const frozen = { en: /frozen/, zh: /冻结/, ar: /تُجمَّد/, es: /congela/, fr: /gelé/ } as const;
  const noTimer = { en: /No timer deletes/, zh: /不会因为时间到了就删除/, ar: /لا يُحذف شيء بمرور الوقت/, es: /Ningún plazo (lo )?borra/, fr: /Aucun délai ne (les efface|supprime)/ } as const;
  const restored = { en: /(restores it|brings it back) exactly as it was/, zh: /续订后一切恢复原样/, ar: /وبالتجديد تعود كما كانت تمامًا/, es: /vuelve exactamente como estaba/, fr: /le rétablit à l’identique/ } as const;
  it('the privacy page, to the people who write to a business: no set end, no timer, frozen when the business stops paying', () => {
    for (const l of LOCALES) {
      const line = t(l, 'legal.privacy.howLong.body', { deletion: 'X' });
      expect(line, l).toMatch(frozen[l]);
      expect(line, l).toMatch(noTimer[l]);
      // The words this replaced: a business that stopped paying "keeps it", as if nothing changed.
      expect(line, l).not.toMatch(/stops using Nomi without closing|不再使用 Nomi 但没有关闭|توقفت الشركة عن استخدام Nomi دون|deja de usar Nomi sin cerrar|cesse d’utiliser Nomi sans fermer/);
    }
  });
  it('the privacy page, to the owner, and the terms: frozen not deleted, what still works, and renewing restores it', () => {
    for (const l of LOCALES) {
      for (const key of ['legal.privacy.owner.howLong', 'legal.terms.fees.body'] as const) {
        const line = t(l, key);
        expect(line, `${l} ${key}`).toMatch(frozen[l]);
        expect(line, `${l} ${key}`).toMatch(noTimer[l]);
        expect(line, `${l} ${key}`).toMatch(restored[l]);
      }
    }
    expect(t('en', 'legal.terms.fees.body')).toMatch(/nothing is sent from it — your own replies included — and nothing that arrives is kept/);
    expect(t('en', 'legal.terms.fees.body')).toMatch(/read everything, download your business’s records[\s\S]*and close the workspace/);
  });
  it('the deletion page: freezing erases nothing, and a request that waits is chased — the business still decides', () => {
    for (const l of LOCALES) {
      expect(t(l, 'legal.deletion.closed'), l).toMatch(frozen[l]);
      const chased = t(l, 'legal.deletion.chased');
      for (const n of ['7', '30', '60']) expect(chased, `${l} ${n}`).toContain(n);
      expect(withoutIsolates(renderDataDeletion(l, null)), l).toContain(`<p>${esc(withoutIsolates(chased))}</p>`);
    }
    expect(t('en', 'legal.deletion.chased')).toMatch(/Nomi does not delete anything in the business’s place: the business decides\./);
  });
  it('no served sentence still says "for as long as the business uses Nomi"', () => {
    const src = read('src/core/owner/i18n/messages.ts');
    expect(src).not.toMatch(/as long as the business uses Nomi/i);
    expect(src).not.toMatch(/商家使用 Nomi 期间一直保存/);
  });
});
