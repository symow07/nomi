/**
 * BUTTONS DO THINGS; DOORS GO PLACES (V1 decision 4, held by a test since
 * 2026-09-29 — the design pass's first rule, written before any page moved).
 *
 *   · a BUTTON changes something: a <button> in a form, drawn as a box with a
 *     verb on it. A <button> outside a form may only be a script's control
 *     (`type="button"` with a `data-` hook) — it cannot submit anything;
 *   · a DOOR goes somewhere: an <a>, drawn as words with its arrow (`deeper`,
 *     `back` in layout.ts), never as a box. `<a class="btn">` is the mix this
 *     rule exists to end: Today's "Review" was a link dressed as an action;
 *   · a form that posts has a button to post it with.
 *
 * The components gallery (/app/settings/components) draws buttons as
 * specimens, outside any form, on purpose: callers skip it by name.
 */
export function buttonsAndDoors(html: string): string[] {
  const problems: string[] = [];
  const forms: { post: boolean; submit: boolean }[] = [];
  for (const m of html.matchAll(/<(\/?)(form|button|a|input)\b([^>]*)>/gi)) {
    const close = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? '';
    if (tag === 'form') {
      if (close) {
        const f = forms.pop();
        if (f?.post && !f.submit) problems.push('a form that posts has no button to post it');
      } else {
        forms.push({ post: /\bmethod="post"/i.test(attrs), submit: false });
      }
    } else if (tag === 'button' && !close) {
      const scriptOnly = /\btype="button"/i.test(attrs);
      const inForm = forms.length > 0;
      if (inForm && !scriptOnly) forms[forms.length - 1]!.submit = true;
      if (!inForm && !(scriptOnly && /\bdata-[a-z-]+/i.test(attrs))) {
        problems.push(`a button outside a form: <button${attrs.slice(0, 80)}>`);
      }
    } else if (tag === 'input' && !close && /\btype="(?:submit|image)"/i.test(attrs) && forms.length > 0) {
      forms[forms.length - 1]!.submit = true;
    } else if (tag === 'a' && !close && /\bclass="(?:[^"]*\s)?btn(?:[\s"])/i.test(attrs)) {
      problems.push(`a link drawn as a button: ${/\bhref="([^"]*)"/i.exec(attrs)?.[1] ?? '(no href)'}`);
    }
  }
  return problems;
}
