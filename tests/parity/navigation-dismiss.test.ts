import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';

/** Run the shipped script with only its navigation surfaces present. */
function browser() {
  const listeners = new Map<string, ((event: any) => void)[]>();
  let focused: unknown;
  const menu = (className: string) => {
    const summary = { focus: () => { focused = summary; } };
    const link = {};
    return { open: false, summary, link, getAttribute: () => className, contains: (target: unknown) => target === summary || target === link,
      querySelector: (selector: string) => selector === 'summary' ? summary : null };
  };
  const more = menu('nav-more'), sections = menu('area-chooser'), reading = menu('reading');
  const document = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === 'details' ? [more, sections, reading] : [],
    addEventListener: (type: string, fn: (event: any) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  };
  vm.runInNewContext(LIVE_SCRIPT, { document, window: { addEventListener: () => {} }, location: { pathname: '/app', hash: '', search: '' } });
  const emit = (type: string, target: unknown, key?: string, prevented = false) => {
    const event = { target, key, defaultPrevented: prevented, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of listeners.get(type) ?? []) fn(event);
    return event;
  };
  return { more, sections, reading, emit, focused: () => focused };
}

describe('navigation menu dismissal', () => {
  for (const name of ['more', 'sections'] as const) {
    it(`Escape closes ${name} and returns focus to its summary without closing reading details`, () => {
      const b = browser();
      b[name].open = true;
      b.reading.open = true;
      expect(b.emit('keydown', b[name].link, 'Escape').defaultPrevented).toBe(true);
      expect(b[name].open).toBe(false);
      expect(b.focused()).toBe(b[name].summary);
      expect(b.reading.open).toBe(true);
    });
  }
  it('outside clicks close navigation without stealing focus or changing unrelated details', () => {
    const b = browser();
    b.more.open = true;
    b.sections.open = true;
    b.reading.open = true;
    b.emit('click', {});
    expect(b.more.open).toBe(false);
    expect(b.sections.open).toBe(false);
    expect(b.reading.open).toBe(true);
    expect(b.focused()).toBeUndefined();
  });
  it('inside clicks and other keys keep the current menu open; handled Escape remains handled', () => {
    const b = browser();
    b.more.open = true;
    b.emit('click', b.more.link);
    b.emit('keydown', b.more.link, 'Enter');
    b.emit('keydown', b.more.link, 'Escape', true);
    expect(b.more.open).toBe(true);
    expect(b.focused()).toBeUndefined();
  });
});
