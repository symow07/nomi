import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { OWNER_ONLY, mayDo, OWNER_VIEW } from '../../src/core/conversation/people.js';
import { EXPORT_SUBJECTS, EXPORT_MAX_ROWS, isExportSubject } from '../../src/api/web/dataExport.js';
import { renderDataRights } from '../../src/api/web/dataRights.js';

/**
 * Phase 2 — CC-12 (an owner cannot get their own data out) and CC-02
 * (`/data-deletion` promised an erasure nothing performs).
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const staff = { id: 'p1', name: 'Xiao Chen', isOwner: false };
const owner = { id: 'owner', name: 'Owner', isOwner: true };

const VIEW = {
  businessName: 'Atlas Trading',
  requests: [],
};

describe('CC-12 · she can take her own data out', () => {
  it('six subjects, and every one is offered on the page', () => {
    expect([...EXPORT_SUBJECTS]).toEqual(['buyers', 'messages', 'products', 'orders', 'quotes', 'contacts']);
    const html = renderDataRights(VIEW, 'en', null, OWNER_VIEW, 'Settings');
    for (const s of EXPORT_SUBJECTS) {
      expect(html, `${s} has no link`).toContain(`/app/settings/data/${s}.csv`);
      expect(html).toContain(t('en', `data.export.subject.${s}` as MessageKey));
    }
  });

  it('only a subject this build knows is a subject', () => {
    expect(isExportSubject('buyers')).toBe(true);
    expect(isExportSubject('logins'), 'never a table somebody can name in a URL').toBe(false);
    expect(isExportSubject('../../etc/passwd')).toBe(false);
    expect(isExportSubject('')).toBe(false);
  });

  it('NOTHING SECRET IS NAMED BY ANY QUERY', () => {
    // Not "a policy stops them" — no query mentions them at all. This walks the
    // module rather than trusting the review that wrote it.
    const src = read('src/api/web/dataExport.ts');
    for (const secret of [
      'password_hash', 'code_hash', 'secret_ciphertext', 'refresh_token_ciphertext',
      'token_ciphertext', 'webhook_secret', 'api_token', 'secret_ref',
    ]) {
      expect(src, `the export names ${secret}`).not.toContain(secret);
    }
    // …and it never reads from the tables those live in.
    for (const table of [
      'channel_credentials', 'mail_accounts', 'meta_accounts', 'connector_credentials',
      'channel_sources', 'logins', 'people',
    ]) {
      expect(src, `the export reads ${table}`).not.toMatch(new RegExp(`from ${table}\\b`));
    }
  });

  it('every query is scoped by the tenant transaction, never a bare connection', () => {
    const src = read('src/api/web/dataExport.ts');
    // One entry point, and it opens the tenant transaction that RLS reads.
    expect(src).toMatch(/return withTenantTx\(db, bid\.value, \(tx\) => loader\(tx, bid\.value\)\)/);
    // The definer functions used elsewhere for cross-tenant reads are not here.
    expect(src, 'a definer function would step around the policy this needs')
      .not.toMatch(/live_business_ids|resolve_tenant|inboxes_to_read/);
  });

  it('the file is an attachment, not a page, and is never cached', () => {
    const src = read('src/api/web/app.ts');
    expect(src).toMatch(/content-disposition.*attachment; filename="\$\{csvFilename/);
    expect(src, 'a proxy holding a copy of her messages is the whole risk')
      .toMatch(/\.header\('cache-control', 'no-store'\)/);
  });

  it('the ceiling is said out loud rather than silently truncating', () => {
    const html = renderDataRights(VIEW, 'en', null, OWNER_VIEW, 'Settings');
    expect(html).toContain(t('en', 'data.export.limit', { n: EXPORT_MAX_ROWS }));
  });

  it('taking a copy is on the audit trail — the subject and the count, never a value', () => {
    const src = read('src/api/web/dataExport.ts');
    expect(src).toMatch(/'export_data'/);
    expect(src).toMatch(/JSON\.stringify\(\{ subject, rows \}\)/);
  });
});

describe('CC-02 · deletion is a request, and the page says so', () => {
  it('the page says a person does it, and that nothing here erases on its own', () => {
    for (const locale of LOCALES) {
      const html = renderDataRights(VIEW, locale, null, OWNER_VIEW, 'x');
      expect(html).toContain(t(locale, 'data.deletion.byHand'));
    }
    // In English, in as many words.
    expect(messages.en['data.deletion.byHand']).toMatch(/not a button that erases/i);
    expect(messages.en['data.deletion.byHand']).toMatch(/by hand/i);
  });

  it('she must type her own name — a checkbox is not a confirmation', () => {
    const html = renderDataRights(VIEW, 'en', null, OWNER_VIEW, 'x');
    expect(html).toContain(t('en', 'data.deletion.typeName', { name: 'Atlas Trading' }));
    expect(html).toMatch(/name="name" required/);
  });

  it('a request already waiting offers a way back, not a second request', () => {
    const asked = new Date(Date.UTC(2026, 8, 20, 9, 0, 0));
    const html = renderDataRights({
      businessName: 'Atlas Trading',
      requests: [{
        id: 'r1', scope: 'workspace', subjectNote: null, askedBy: 'owner',
        askedAt: asked, state: 'open', closedAt: null, closedNote: null,
      }],
    }, 'en', null, OWNER_VIEW, 'x');
    expect(html).toContain(t('en', 'data.deletion.withdraw'));
    expect(html).toContain('/app/settings/data/withdraw');
    expect(html, 'asking twice is one request, not two').not.toContain('/app/settings/data/delete');
  });

  it('staff are told whose decision it is, not shown a form that refuses them', () => {
    const html = renderDataRights(VIEW, 'en', null, staff, 'x');
    expect(html).toContain(t('en', 'data.deletion.ownerOnly'));
    expect(html).not.toContain('/app/settings/data/delete');
    // They still see the history — it is their workspace too.
    expect(html).toContain(t('en', 'data.export.title'));
  });

  it('the app role is never asked to delete anything', () => {
    for (const rel of ['src/api/web/dataRights.ts', 'src/api/web/dataExport.ts']) {
      expect(read(rel), `${rel} writes a delete`).not.toMatch(/\bdelete from\b/i);
    }
    // The migration keeps the grant exactly where every other table has it.
    const m = read('migrations/0064_deletion_requests.sql');
    expect(m).toContain('grant select, insert, update on deletion_requests to nomi_app;');
    expect(m).toContain('revoke delete, truncate on deletion_requests from nomi_app;');
  });

  it('the tool that DOES delete refuses three ways, and is not reachable from the app', () => {
    const tool = read('tools/erase-workspace.mjs');
    expect(tool, 'the app role cannot delete and must not be used').toContain('MIGRATE_DATABASE_URL');
    expect(tool).toMatch(/has no OPEN workspace deletion request/);
    expect(tool).toMatch(/--confirm does not match/);
    expect(tool).toMatch(/Dry run\. Nothing was deleted\./);
    // Nothing in src/ imports it, and no npm script runs it.
    expect(read('package.json')).not.toContain('erase-workspace');
  });

  it('the runbook exists and names the tool', () => {
    const doc = read('docs/DATA-DELETION-RUNBOOK.md');
    expect(doc).toContain('tools/erase-workspace.mjs');
    expect(doc, 'offer the export before the thing that cannot be undone').toMatch(/export first/i);
  });
});

describe('who may do it', () => {
  it('it is one more entry on the owner-only LIST, not a new role', () => {
    expect([...OWNER_ONLY]).toContain('data_rights');
    expect(mayDo(owner, 'data_rights')).toBe(true);
    expect(mayDo(staff, 'data_rights')).toBe(false);
  });

  it('both the page and the file are gated, not only the form', () => {
    const src = read('src/api/web/app.ts');
    expect(src).toMatch(/app\.get\('\/app\/settings\/data', ownerPage\('data_rights'/);
    expect(src).toMatch(/app\.get\('\/app\/settings\/data\/:file'[\s\S]{0,200}ownerOnly\(req, reply, 'data_rights'/);
    expect(src).toMatch(/app\.post\('\/app\/settings\/data\/delete'[\s\S]{0,200}ownerOnly\(req, reply, 'data_rights'/);
    expect(src).toMatch(/app\.post\('\/app\/settings\/data\/withdraw'[\s\S]{0,200}ownerOnly\(req, reply, 'data_rights'/);
  });

  it('it is reachable — Settings links to it', () => {
    expect(read('src/api/web/settings.ts')).toContain("'/app/settings/data'");
  });
});

describe('the sentences', () => {
  it('every one of them exists in all three languages', () => {
    const keys = Object.keys(messages.en).filter((k) => k.startsWith('data.'));
    expect(keys.length).toBeGreaterThan(25);
    for (const locale of LOCALES) {
      for (const k of keys) {
        expect(messages[locale][k as MessageKey], `${locale} is missing ${k}`).toBeTruthy();
      }
    }
  });

  it('the Chinese says a PERSON does it, with none of the banned vocabulary', () => {
    const zh = messages.zh['data.deletion.byHand'];
    expect(zh).toContain('手动');
    for (const banned of ['自动', '系统', '模型']) {
      expect(zh, `the Chinese uses ${banned}`).not.toContain(banned);
    }
  });
});
