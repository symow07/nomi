import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { goesByMail, renderOwnerAlert } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * RET (0116) — a workspace that never connected a channel, 90 days on: off
 * until the owner turns it on; the app warns and never erases; the operator's
 * tool erases through erase-workspace, under a request it records. Over
 * Postgres, with the tool run for real: tests/integration/ret-retention.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('RET · off until the owner turns it on', () => {
  const m = src('migrations/0116_retention.sql');
  it('nothing is a candidate while the switch is off, and the switch is the installation\'s', () => {
    expect(m).toContain("with on_ as (select exists (select 1 from ops_flags where flag = 'retention' and cleared_at is null) as on_)");
    expect(m).toContain('     where on_.on_');
    expect(m).toContain("check (flag <> 'retention' or business_id is null);");
  });
  it('never connected means nothing ever: WhatsApp, a Page or a mailbox, in any state; a practice copy is never a candidate', () => {
    for (const table of ['channels ch', 'meta_accounts m', 'mail_accounts a']) expect(m).toContain(`and not exists (select 1 from ${table} where`);
    expect(m).toContain('b.signed_up_at is not null and b.practice_of is null');
  });
  it('the date is never sooner than 90 days, 14 days after the first warning, 3 after the second', () => {
    expect(m).toContain("greatest((c.signed_up_at + interval '90 days')::date, (coalesce(c.first_at, now()) + interval '14 days')::date,");
    expect(m).toContain("(c.second_at + interval '3 days')::date) as erase_on");
    expect(m).toContain("greatest(w.erase_on, now()::date + 3)");
  });
  it('the app reads nothing of the warnings, and erases nothing', () => {
    expect(m).toContain('revoke all on retention_notices from public, nomi_app;');
    expect(src('src/pipeline/retention.ts')).not.toMatch(/\bdelete\b/i);
    expect(src('src/main.ts')).toContain("await boss.schedule(QUEUES.retention, '50 6 * * *', {});");
  });
});

describe('RET · the operator erases, through the one erasure', () => {
  const tool = src('tools/retention.mjs');
  it('a dry run unless --yes, and the operator\'s name', () => {
    expect(tool).toContain("if (!yes) { console.log(`Dry run: would erase");
    expect(tool).toContain("Say who you are: --by");
  });
  it('a request recorded for each, then erase-workspace with its own refusals', () => {
    expect(tool.indexOf('recordRetentionRequest(client')).toBeLessThan(tool.indexOf("spawnSync(process.execPath, [tool, '--business', r.id, '--confirm', r.name, '--yes']"));
    expect(src('tools/lib/operator.mjs')).toContain("values ($1::uuid, 'workspace', $2, $3) returning id::text as id");
  });
});

describe('RET · the owner hears, by e-mail always', () => {
  it('the warning goes by mail, and opens Channels', () => {
    expect(goesByMail('retention_warning')).toBe(true);
    expect(src('src/pipeline/notify.ts')).toContain("job.kind === 'connection_approved' || job.kind === 'retention_warning' ? CONNECTION_APPROVAL_PAGE");
  });
  for (const l of LOCALES) {
    it(`${l} · the date, in the workspace's zone; the operator's list counts the due`, () => {
      const words = renderOwnerAlert(l, 'retention_warning', null, { eraseOn: '2026-12-31', zone: 'Asia/Dubai' });
      expect(words).not.toContain('{');
      expect(words).toMatch(/31|٣١/);
      expect(renderOwnerAlert(l, 'signup_digest', null, { signups: [], retentionDue: 2 })).toContain(t(l, 'notify.signup_digest.retention', { n: 2 }));
    });
  }
});
