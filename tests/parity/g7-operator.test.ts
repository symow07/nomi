import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderOwnerAlert } from '../../src/pipeline/notify.js';
import { FORCE_DRAFT_CAPABILITIES, OPERATOR_FLAGS } from '../../src/db/operator.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * G7 — the operator's controls. Over Postgres, production's composition and
 * a recorded Graph: tests/integration/g7-operator.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('G7 · stop new connections (KS6\'s flag)', () => {
  it('every step of connecting asks it first: Meta\'s start, its callback, the Page choice, and WhatsApp', () => {
    const app = src('src/api/web/app.ts');
    expect(app.match(/if \(await connectionsStopped\(s\.businessId\)\) return channelsFlash\(reply, 'connect\.flash\.paused'\);/g)).toHaveLength(3);
    expect(app).toContain("if (await connectionsStopped(s.businessId)) return flashTo(reply, '/app/channels', 'connect.flash.paused');");
  });
  for (const l of LOCALES) {
    it(`${l} · the refusal says nothing was connected and that what is connected keeps working`, () => {
      expect(t(l, 'connect.flash.paused')).not.toBe('connect.flash.paused');
    });
  }
});

describe('G7 · suspend (KS2, KS3)', () => {
  it('marks the Page refused and never archives it — an archived Page falls back to the installation\'s own', () => {
    const op = src('src/db/operator.ts');
    const suspend = op.slice(op.indexOf('export async function suspendWorkspace'), op.indexOf('export async function restoreWorkspace'));
    expect(suspend).toContain("set needs_attention_at = now(), last_error = 'refused'");
    expect(suspend).not.toMatch(/archived_at\s*=/);
    expect(src('src/main.ts')).toContain('if (account.needsAttention) return {};');
  });
  it('the installation\'s own workspace and practice copies are never suspended', () => {
    const op = src('src/db/operator.ts');
    expect(op).toContain("if (w.practiceOf) return { ok: false, why: 'practice_copy' };");
    expect(op).toContain("if (input.installationId && w.id === input.installationId) return { ok: false, why: 'installation' };");
  });
});

describe('G7 · the flags (KS4)', () => {
  it('force_draft is one row per capability but confirm_order, which always drafts', () => {
    expect([...FORCE_DRAFT_CAPABILITIES].sort()).toEqual(['follow_up', 'greet', 'negotiate', 'qualify', 'quote', 'recommend']);
    expect(OPERATOR_FLAGS).toEqual(['global_silence', 'force_draft', 'connections_off', 'practice_off']);
  });
  for (const l of LOCALES) {
    it(`${l} · the daily list says which switch is still on, for whom, since when`, () => {
      const text = renderOwnerAlert(l, 'signup_digest', null, {
        signups: [], flags: [{ flag: 'connections_off', business: null, since: new Date('2026-10-01T06:00:00Z') }],
      });
      expect(text.split('\n')).toHaveLength(2);
      expect(text).toContain('connections_off');
      expect(text).toContain(t(l, 'notify.signup_digest.everyone'));
    });
  }
});

describe('G7 · the tools', () => {
  it('each needs the admin URL from the environment, refuses a role row security filters, and is a dry run until --yes', () => {
    for (const tool of ['suspend-workspace.mjs', 'ops-flags.mjs', 'workspaces.mjs']) {
      const s = src(`tools/${tool}`);
      expect(s, tool).toContain("process.env['MIGRATE_DATABASE_URL']");
      expect(s, tool).toContain('await requireAdmin(client);');
      expect(s, tool).toContain("has('--yes')");
    }
  });
});
