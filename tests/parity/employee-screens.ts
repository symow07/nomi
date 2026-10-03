import {
  renderEmployee, renderEmployeeScreen, EMPLOYEE_SCREENS,
  type EmployeeProfile, type EmployeeScreen, type HerContext, type ScreenExtras,
} from '../../src/api/web/employee.js';
import { OWNER_VIEW, type Viewer } from '../../src/core/conversation/people.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';

/**
 * THE WARMTH RUN, phase 7 — the assistant's page is a menu now: the landing
 * (the name, the control, the rows) and one screen per row. A test about
 * WHAT the page says reads it all, end to end, through this: every word and
 * control the one long page held is still there, one tap deeper. A test about
 * WHERE something sits renders the landing (`renderEmployee`) or one screen.
 */
export const screen = (
  s: EmployeeScreen, e: EmployeeProfile, l: Locale, ctx?: HerContext, viewer: Viewer = OWNER_VIEW, extras: ScreenExtras = {},
): string => renderEmployeeScreen(s, e, l, null, ctx, viewer, extras);

export const everyScreen = (
  e: EmployeeProfile, l: Locale, flash: Parameters<typeof renderEmployee>[2] = null, ctx?: HerContext,
  viewer: Viewer = OWNER_VIEW, extras: ScreenExtras = {},
): string => [renderEmployee(e, l, flash, ctx, viewer), ...EMPLOYEE_SCREENS.map((s) => screen(s, e, l, ctx, viewer, extras))].join('\n');
