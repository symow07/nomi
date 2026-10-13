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
 * THE ONE EXCEPTION, AND ITS HARD CAP (the owner, Phase 3 stop-gate,
 * 2026-10-13): "Do it now" on the FIRST INCOMPLETE STEP of setting up may be a
 * link drawn as a filled button — `firstStepButton` in src/api/web/guide.ts,
 * marked `data-first-step`. At most ONE filled button on a page that carries
 * it (that one), and only on the first incomplete step; any other link drawn
 * as a button is still the mix this rule exists to end.
 *
 * The components gallery (/app/settings/components) draws buttons as
 * specimens, outside any form, on purpose: callers skip it by name.
 */
export function buttonsAndDoors(html: string): string[] {
  const problems: string[] = [];
  const forms: { post: boolean; submit: boolean }[] = [];
  let firstStep = 0;
  let filled = 0;
  for (const m of html.matchAll(/<(\/?)(form|button|a|input)\b([^>]*)>/gi)) {
    const close = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? '';
    if (!close && (tag === 'a' || tag === 'button') && /\bclass="(?:[^"]*\s)?btn\s(?:[^"]*\s)?send(?:[\s"])/i.test(attrs)) filled++;
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
      if (/\sdata-first-step(?:[\s=]|$)/i.test(attrs)) firstStep++;
      else problems.push(`a link drawn as a button: ${/\bhref="([^"]*)"/i.exec(attrs)?.[1] ?? '(no href)'}`);
    }
  }
  if (firstStep > 1) problems.push(`${firstStep} first-step buttons on one page: the cap is one`);
  if (firstStep === 1 && filled > 1) problems.push(`the first step's button is not the page's only filled button (${filled} filled)`);
  return problems;
}
