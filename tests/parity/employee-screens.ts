import {
  renderEmployee, renderEmployeeScreen, EMPLOYEE_SCREENS,
  type EmployeeProfile, type EmployeeScreen, type HerContext, type ScreenExtras, type PermissionsExtra,
} from '../../src/api/web/employee.js';
import { renderNameIdentity } from '../../src/api/web/assistants.js';
import { DEFAULT_VOICE } from '../../src/core/owner/assistants.js';
import { assistantName } from '../../src/api/web/say.js';
import { OWNER_VIEW, type Viewer } from '../../src/core/conversation/people.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';
import type { FollowUpRule } from '../../src/core/conversation/followUps.js';

/**
 * THE SETTINGS OVERHAUL (rule 104) — what the assistant's menu and its setup screens held is on two settings pages
 * now: "Reply permissions" (`renderEmployee`: the level, the kinds of reply, follow-ups) and "Name and identity"
 * (`renderNameIdentity`); the daily screens (`EMPLOYEE_SCREENS`) are where they were. A test about WHAT the
 * assistant's pages say reads them all, end to end, through `everyScreen`: every word and control is still there.
 * A test about WHERE something sits renders one page (`permissions`, `namePage`) or one screen.
 */
export const screen = (
  s: EmployeeScreen, e: EmployeeProfile, l: Locale, ctx?: HerContext, viewer: Viewer = OWNER_VIEW, extras: ScreenExtras = {},
): string => renderEmployeeScreen(s, e, l, null, ctx, viewer, extras);

/** Settings › Assistant › Reply permissions. */
export const permissions = (
  e: EmployeeProfile, l: Locale, viewer: Viewer = OWNER_VIEW, extra: PermissionsExtra = {},
  flash: Parameters<typeof renderEmployee>[2] = null,
): string => renderEmployee(e, l, flash, viewer, extra);

/** Settings › Assistant › Name and identity, for a workspace with its one main assistant, named as the profile says. */
export const namePage = (e: EmployeeProfile, l: Locale, viewer: Viewer = OWNER_VIEW): string => {
  const name = assistantName(l);
  return renderNameIdentity({ named: e.assistantNamed !== false, pending: name },
    [{ id: 'a-main', name, role: 'sales', note: null, channels: [], isDefault: true, voice: DEFAULT_VOICE }],
    l, null, viewer);
};

/** A workspace with nothing set: no kind of reply, no name confirmed. */
export const NEW_PROFILE: EmployeeProfile = {
  hireDate: null, knows: 0, stage: 'probation', canDo: [], needConfirm: [], capabilities: [],
  growth: [], promoted: false, conditions: [], spotChecks: [], assistantNamed: false,
};
/** Reply permissions' follow-up section (it was a fold of its own, `renderFollowUpRule`), to the page's end. */
export const followUpSection = (l: Locale, rule: FollowUpRule, owner: boolean): string => {
  const page = permissions(NEW_PROFILE, l, owner ? OWNER_VIEW : { isOwner: false }, { followUps: rule });
  const at = page.indexOf('<section class="set-sec" id="follow-ups">');
  if (at < 0) throw new Error('no follow-ups section');
  return page.slice(at);
};

export const everyScreen = (
  e: EmployeeProfile, l: Locale, flash: Parameters<typeof renderEmployee>[2] = null, ctx?: HerContext,
  viewer: Viewer = OWNER_VIEW, extras: ScreenExtras = {},
): string => [renderEmployee(e, l, flash, viewer), namePage(e, l, viewer),
  ...EMPLOYEE_SCREENS.map((s) => screen(s, e, l, ctx, viewer, extras))].join('\n');
