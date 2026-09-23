import { describe, it, expect } from 'vitest';
import { shell, NAV, CONTEXTUAL_ROUTES_BY_HUB, CONTEXTUAL_ROUTES, hubFor, isOutreachRoute, OUTREACH_PREFIXES } from '../../src/api/web/layout.js';
import { withWorkspace, withAssistantName, outreachShown, setupState, type RequestScope } from '../../src/api/web/say.js';
import { renderSettings } from '../../src/api/web/settings.js';
import { renderOperationsHome } from '../../src/api/web/operations.js';
import { renderCustomerList } from '../../src/api/web/conversations.js';
import { renderAccounts } from '../../src/api/web/connect.js';
import { renderReach } from '../../src/api/web/channels.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { setupFrom, SETUP_STEPS, NOTHING_DONE } from '../../src/db/setup.js';
import { t, messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * D — the drawer split (docs/IA-PROPOSAL.md §D, decided 2026-09-21).
 *
 * Five entries. What you SELL under My business, how the assistant BEHAVES
 * under its own entry, how the installation is WIRED under Setup. While setup
 * is unfinished, Setup carries a count and Today carries a card. The outreach
 * area exists only where it is switched on — no route, no link, no switch.
 * URLs did not move.
 */

const facts = (over: Partial<RequestScope> = {}): RequestScope => ({
  name: null, several: false, outreach: false,
  setup: setupFrom({ profile: true, products: true, name: false, channels: true, first_success: false }),
  ...over,
});
const COMPLETE = setupFrom({ profile: true, products: true, name: true, channels: true, first_success: true });

const page = (path: string, scope: RequestScope | null = null) => {
  const draw = () => shell({ title: 'T', active: 'home', locale: 'en', path, avatar: '·', bodyHtml: '' });
  return scope ? withWorkspace(scope, draw) : draw();
};
const navOf = (html: string) => html.split('<nav class="side"')[1]?.split('</nav>')[0] ?? '';

describe('D · five entries', () => {
  it('Today, Buyers, the assistant, My business, Setup — in that order, and no conditional sixth', () => {
    expect(NAV.map((n) => n.href)).toEqual(['/app', '/app/inbox', '/app/employee', '/app/factory', '/app/settings']);
    expect(NAV.map((n) => n.id)).toEqual(['home', 'inbox', 'employee', 'factory', 'settings']);
  });

  it('Setup is named in every language, in owner words', () => {
    expect(t('en', 'nav.settings')).toBe('Setup');
    for (const l of LOCALES) expect(messages[l]['nav.settings'].length).toBeGreaterThan(0);
  });

  it('the map puts what you sell under My business, behaviour under the assistant, wiring under Setup', () => {
    const under = (hub: string) => CONTEXTUAL_ROUTES_BY_HUB.find((g) => g.hub === hub)?.routes ?? [];
    expect(under('/app/factory')).toEqual(expect.arrayContaining([
      '/app/products', '/app/factory/prices', '/app/settings/terms', '/app/settings/samples', '/app/settings/closures', '/app/settings/rate',
    ]));
    expect(under('/app/employee')).toEqual(expect.arrayContaining(['/app/knowledge', '/app/settings/forbidden', '/app/sandbox']));
    expect(under('/app/settings')).toEqual(expect.arrayContaining(['/app/onboarding', '/app/channels', '/app/settings/people']));
    // and Settings itself is a nav entry now, not somebody's contextual route
    expect(CONTEXTUAL_ROUTES).not.toContain('/app/settings');
  });

  it('every page lights the entry it now sits under — URLs did not move, doors did', () => {
    expect(hubFor('/app/settings/terms', 'x')).toBe('factory');
    expect(hubFor('/app/settings/rate', 'x')).toBe('factory');
    expect(hubFor('/app/products/abc', 'x')).toBe('factory');
    expect(hubFor('/app/knowledge', 'x')).toBe('employee');
    expect(hubFor('/app/settings/forbidden', 'x')).toBe('employee');
    expect(hubFor('/app/sandbox', 'x')).toBe('employee');
    expect(hubFor('/app/settings', 'x')).toBe('settings');
    expect(hubFor('/app/settings/people', 'x')).toBe('settings');
    expect(hubFor('/app/settings/data', 'x')).toBe('settings');
    expect(hubFor('/app/channels', 'x')).toBe('settings');
    expect(hubFor('/app/onboarding', 'x')).toBe('settings');
    // the outreach chain still resolves, for a workspace that has it
    expect(hubFor('/app/sequences/abc', 'x')).toBe('home');
  });
});

describe('D · the Setup count', () => {
  it('shows "done/total" on Setup while setup is unfinished, with a spoken form', () => {
    const html = page('/app', facts());
    const nav = navOf(html);
    expect(nav).toContain('<span class="navcount" aria-hidden="true">3/5</span>');
    expect(nav).toContain(`aria-label="${t('en', 'nav.settings')}, ${t('en', 'nav.setup.progress', { done: 3, total: 5 })}"`);
    // only on Setup
    expect(nav.split('navcount').length - 1).toBe(1);
  });

  it('disappears when the last step is done, and the entry stays', () => {
    const nav = navOf(page('/app', facts({ setup: COMPLETE })));
    expect(nav).not.toContain('navcount');
    expect(nav).toContain('href="/app/settings"');
  });

  it('is absent outside a workspace — a public page, a bare render', () => {
    expect(navOf(page('/app'))).not.toContain('navcount');
    expect(setupState()).toBeNull();
  });

  it('the count is a figure in secondary ink, not a state colour', () => {
    const html = page('/app', facts());
    const rule = html.match(/nav\.side \.navcount \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('var(--color-ink-secondary)');
    expect(rule).not.toMatch(/warn|jade|ok|waiting/);
  });
});

describe('D · the Today card', () => {
  const snapshot: Parameters<typeof renderOperationsHome>[0] = {
    range: 'today',
    attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
    activity: { handled: 0, draftsCreated: 0, corrections: 0 },
    knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
    channel: { status: 'connected', provider: 'active', live: true }, budget: null,
    hasAttention: false,
  };

  it('names the next step and opens its door while setup is unfinished', () => {
    const html = withWorkspace(facts(), () => renderOperationsHome(snapshot, 'en'));
    expect(html).toContain(t('en', 'today.setup.title'));
    expect(html).toContain(t('en', 'nav.setup.progress', { done: 3, total: 5 }));
    // the next step here is the name — confirmed on Getting ready
    expect(html).toContain(`href="${STEP_LINK.name}"`);
    expect(html).toContain(t('en', 'factory.next.name'));
  });

  it('is gone when setup is complete, and absent outside a workspace', () => {
    expect(withWorkspace(facts({ setup: COMPLETE }), () => renderOperationsHome(snapshot, 'en'))).not.toContain(t('en', 'today.setup.title'));
    expect(renderOperationsHome(snapshot, 'en')).not.toContain(t('en', 'today.setup.title'));
  });

  it('the five steps are the ones the badge counts, the name among them, and each has a door', () => {
    expect(SETUP_STEPS).toEqual(['profile', 'products', 'name', 'channels', 'first_success']);
    for (const s of SETUP_STEPS) {
      expect(STEP_LINK[s]).toMatch(/^\/app/);
      for (const l of LOCALES) expect(messages[l][`factory.next.${s}` as MessageKey], `${l} ${s}`).toBeTruthy();
    }
    expect(NOTHING_DONE.next).toBe('profile');
    expect(setupFrom({ profile: true, products: true, name: false, channels: true, first_success: true }).next).toBe('name');
  });
});

describe('D · the doors moved, the pages did not', () => {
  const profile = {
    name: 'X', description: null, location: null, workingHours: null, languagesServed: ['en'],
    contactEmail: null, contactPhone: null, categories: [],
  } as unknown as Parameters<typeof renderSettings>[0];

  it('Setup holds Getting ready, channels, people, business, sign-in, data — and none of what you sell', () => {
    const html = withWorkspace(facts(), () => renderSettings(profile, 'en', null));
    for (const href of ['/app/onboarding', '/app/channels', '/app/settings/people', '/app/settings/business', '/app/settings/account', '/app/settings/data'])
      expect(html).toContain(`href="${href}"`);
    for (const href of ['/app/settings/terms', '/app/settings/samples', '/app/settings/closures', '/app/settings/rate', '/app/settings/forbidden'])
      expect(html).not.toContain(`href="${href}"`);
    expect(html).toContain(`<h1 class="page">${t('en', 'nav.settings')}</h1>`);
    expect(html).toContain(t('en', 'nav.setup.progress', { done: 3, total: 5 }));
  });
});

describe('D · the outreach area exists only where it is switched on', () => {
  it('its addresses are known by prefix, query strings and sub-pages included', () => {
    expect(OUTREACH_PREFIXES).toEqual(['/app/contacts', '/app/prospects', '/app/sequences', '/app/channels/outreach']);
    for (const u of ['/app/contacts', '/app/contacts/write', '/app/contacts?flash=1', '/app/prospects', '/app/sequences/abc/steps', '/app/channels/outreach', '/app/channels/outreach/cap'])
      expect(isOutreachRoute(u), u).toBe(true);
    for (const u of ['/app', '/app/channels', '/app/contactsx', '/app/inbox/abc', '/app/settings'])
      expect(isOutreachRoute(u), u).toBe(false);
    // the groups that need it say so in the map
    for (const g of CONTEXTUAL_ROUTES_BY_HUB)
      expect(g.outreach === true, g.hub).toBe(g.routes.some(isOutreachRoute) || g.hub === '/app/contacts');
  });

  it('outside a scope, and with the area off, nothing is shown; inside, with it on, it is', () => {
    expect(outreachShown()).toBe(false);
    expect(withWorkspace(facts({ outreach: false }), outreachShown)).toBe(false);
    expect(withWorkspace(facts({ outreach: true }), outreachShown)).toBe(true);
    // narrowing to one conversation's assistant keeps the request's facts
    expect(withWorkspace(facts({ outreach: true }), () => withAssistantName('Noor', outreachShown))).toBe(true);
  });

  const list = { customers: [], query: '' } as unknown as Parameters<typeof renderCustomerList>[0];
  const accounts: Parameters<typeof renderAccounts>[0] = {
    mail: null, connectable: { google: true, microsoft: false }, sendingDomain: 'example.com', smtpFrom: null,
    apollo: { kind: 'none' },
  };

  it('the door to contacts, the Apollo card and the writing-first switch appear only with the area on', () => {
    const off = facts({ outreach: false }); const on = facts({ outreach: true });
    expect(withWorkspace(off, () => renderCustomerList(list, 'en', new Date()))).not.toContain('href="/app/contacts"');
    expect(withWorkspace(on, () => renderCustomerList(list, 'en', new Date()))).toContain('href="/app/contacts"');

    expect(withWorkspace(off, () => renderAccounts(accounts, 'en'))).not.toContain('/app/prospects');
    expect(withWorkspace(on, () => renderAccounts(accounts, 'en'))).toContain('href="/app/prospects"');

    const reach = (s: RequestScope) => withWorkspace(s, () => renderReach('en', new Set(['domain_verified', 'template_approved'] as never[]), new Map([['email', false]] as never)));
    expect(reach(off)).not.toContain('action="/app/channels/outreach"');
    expect(reach(off)).not.toContain('action="/app/channels/outreach/cap"');
    expect(reach(on)).toContain('action="/app/channels/outreach"');
  });
});
