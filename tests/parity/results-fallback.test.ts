import { describe, it, expect } from 'vitest';
import { renderResultsTabs } from '../../src/api/web/resultsNavigation.js';
import { renderAnalytics } from '../../src/api/web/analytics.js';
import { renderMonthReport } from '../../src/api/web/monthReport.js';
import { renderEmployeeScreen, type EmployeeProfile } from '../../src/api/web/employee.js';
import { renderPilotScreen, type PilotRunbook } from '../../src/api/web/pilot.js';
import { FIXTURE_MONTH_REPORT } from '../../src/core/report/month.js';
import { shell } from '../../src/api/web/layout.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { unisolatedEnglish } from './english-isolates.js';
import { linkedCss } from './linked-css.js';

const employee: EmployeeProfile = { knows: 0, assistantNamed: true, spotChecks: [], hireDate: null, stage: 'partial', canDo: [], needConfirm: [], capabilities: [], growth: [], promoted: false, conditions: [], products: 0, words: 0, answering: true, chosen: null, pendingName: null };
const runbook: PilotRunbook = { readiness: { detected: { profile: true, products: true, priceRules: true, knowledge: true, claims: false, sandbox: false, channel: false }, attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: null }, assistantName: 'ياسمين', validation: { at: null, pass: null, total: null }, backupVerifiedAt: null, readyToLaunch: false }, rehearsal: { available: true, done: { takeover: false, ownerReply: false, resume: false, knowledgeCorrection: false, validationPassed: false }, completed: 0, total: 5 }, operations: { range: 'week', attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 }, activity: { handled: 0, draftsCreated: 0, corrections: 0 }, knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 }, budget: null, channel: { status: 'not_connected', provider: 'disabled' }, hasAttention: false }, reliability: { stuckOutbound: 0, oldestQueuedAt: null } };
const pages = () => ({
  sales: renderAnalytics({ range: 'month', hasActivity: false, summary: { newClients: 0, activeConvos: 0, quotes: 0, orders: 0 }, activity: { inbound: 0, replied: 0, waiting: 0 }, commerce: { quotes: 0, orders: 0, deals: [], totals: [] }, employee: { handled: 0, waiting: 0, edits: 0 } }, 'ar'),
  assistant: renderEmployeeScreen('month', employee, 'ar', null),
  setup: renderPilotScreen('activity', runbook, 'ar'),
  month: renderMonthReport(FIXTURE_MONTH_REPORT, 'ar', { canSetMinutes: true, months: ['2026-10'], flash: null, now: new Date('2026-11-07'), startedAt: new Date('2026-09-14'), setupDone: true }),
});
describe('F3 · English fallback stays isolated on Arabic Results pages', () => {
  it('detects bare sentences and wrappers that do not isolate the words', () => {
    expect(unisolatedEnglish('<p>Customer activity.</p>')).toHaveLength(1);
    expect(unisolatedEnglish('<span dir="auto">Customer activity.</span>')).toHaveLength(1);
    expect(unisolatedEnglish('<p><bdi lang="en" dir="ltr">Customer activity.</bdi></p>')).toEqual([]);
  });
  for (const view of ['sales', 'assistant', 'setup', 'month'] as const) it(view, () => {
    const html = withAssistantName('ياسمين', () => shell({ locale: 'ar', title: 'Nomi', path: view === 'month' ? '/app/results/month' : '/app/results', active: 'analytics', bodyHtml: renderResultsTabs('ar', view) + pages()[view] }));
    expect(unisolatedEnglish(html)).toEqual([]);
  });
  it('keeps the fallback text aligned with its parent', () => {
    const css = linkedCss(shell({ locale: 'ar', title: 'Nomi', path: '/app/results', active: 'analytics', bodyHtml: '' }));
    expect(css).toMatch(/bdi\[lang="en"\]\s*\{[^}]*text-align:\s*match-parent/);
  });
});
