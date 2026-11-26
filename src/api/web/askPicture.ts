import type { Locale } from '../../core/owner/i18n/locale.js';
import type { Picture, FlowPicture, PeoplePicture, TrendPicture, WeekPicture } from '../../advisor/picture.js';
import { t } from './say.js';
import { esc, ASK_PICTURE_JS } from './layout.js';

/**
 * THE PICTURE OF AN ANSWER, DRAWN (the owner, 2026-11-26; src/advisor/picture.ts says what a picture is). The page
 * draws it from the read's own data: boxes, days and lines are plain marks with their words in them, so the picture
 * reads without any script and to a screen reader as it stands. The picture's own file (askPictureScript.ts, named
 * here as `data-ap-src` and asked for by the one script on a page that has a picture) only joins the boxes with
 * ribbons and moves things; without it the boxes stand in the same places, unjoined and still.
 *
 * Two radios, in the page's own markup, choose Picture or Words: the stylesheet shows one or the other, so the
 * choice works with no script as well. "Words" is the answer's own lines, as they were before there was a picture.
 */

const bdi = (s: string): string => `<bdi>${esc(s)}</bdi>`;
/** The links the script joins, as `from>to` pairs; `!` marks the one that ends in something waiting. */
const linksAttr = (links: readonly { readonly from: string; readonly to: string; readonly tone?: 'waits' }[]): string =>
  esc(links.map((l) => `${l.from}>${l.to}${l.tone === 'waits' ? '!' : ''}`).join(','));
/** A box that is a door when it has somewhere to go. */
const box = (cls: string, key: string, inner: string, href?: string): string => href
  ? `<a class="ap-n ${cls}" data-ap-k="${esc(key)}" href="${esc(href)}">${inner}</a>`
  : `<div class="ap-n ${cls}" data-ap-k="${esc(key)}">${inner}</div>`;

function flow(locale: Locale, p: FlowPicture): string {
  return `<div class="ap-flow" data-ap-links="${linksAttr(p.links)}"><svg class="ap-wires" aria-hidden="true" focusable="false"></svg>${p.nodes.map((n) => box(
    `ap-c${n.col} ap-r${n.row}${n.tone === 'waits' ? ' ap-waits' : ''}${n.value === null ? ' ap-none' : ''}`, n.id,
    `<span class="ap-l" dir="auto">${esc(n.label)}</span><strong class="ap-v">${n.value === null ? esc(t(locale, 'askPicture.notOnRecord')) : bdi(n.value)}</strong>`,
    n.value === null ? undefined : n.href)).join('')}</div>`;
}

function people(locale: Locale, p: PeoplePicture): string {
  const links = p.people.map((x, i) => ({ from: `p${i}`, to: 'you', ...(x.waits ? { tone: 'waits' as const } : {}) }));
  return `<div class="ap-people" data-ap-rows="${Math.max(1, Math.ceil(p.people.length / 2))}" data-ap-links="${linksAttr(links)}"><svg class="ap-wires" aria-hidden="true" focusable="false"></svg>
    <div class="ap-n ap-you" data-ap-k="you">${esc(t(locale, 'advisor.you'))}</div>
    ${p.people.map((x, i) => box(`ap-p ${i % 2 === 0 ? 'ap-start' : 'ap-end'}`, `p${i}`,
    `<strong class="ap-name">${bdi(x.name)}</strong><span class="ap-tag${x.waits ? ' ap-waits' : ''}" dir="auto">${esc(x.what)}</span>`, x.href)).join('')}
    ${p.more ? `<p class="ap-more muted" dir="auto">${esc(p.more)}</p>` : ''}</div>`;
}

function week(_locale: Locale, p: WeekPicture): string {
  return `<ol class="ap-week">${p.days.map((d) => `<li class="ap-day${d.today ? ' ap-today' : ''}"${d.today ? ' aria-current="date"' : ''}>
      <span class="ap-dl">${bdi(d.label)}</span>${d.items.length
    ? `<ul>${d.items.map((i) => `<li class="ap-item${i.late ? ' ap-late' : ''}" dir="auto">${esc(i.text)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`;
}

/** The plot's own box, in its own units: the page scales it whole, so a mark keeps its shape at any width. */
const PLOT = { w: 640, h: 220, pad: 10, top: 18, base: 200 } as const;
function trend(locale: Locale, p: TrendPicture): string {
  const n = Math.min(p.now.length, p.then.length);
  const top = Math.max(1, ...p.now, ...p.then);
  const x = (i: number): number => PLOT.pad + (n < 2 ? 0 : i * (PLOT.w - 2 * PLOT.pad) / (n - 1));
  const y = (v: number): number => PLOT.base - (v / top) * (PLOT.base - PLOT.top);
  const line = (a: readonly number[]): string => a.slice(0, n).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = n - 1;
  const legend = (cls: string, label: string, amount: string): string =>
    `<li class="${cls}"><span class="ap-key" aria-hidden="true"></span><span dir="auto">${esc(label)}</span> <strong>${bdi(amount)}</strong></li>`;
  return `<div class="ap-trend">
    <ul class="ap-legend">${legend('ap-now', t(locale, 'askPicture.trend.now'), p.nowLabel)}${legend('ap-then', t(locale, 'askPicture.trend.then'), p.thenLabel)}</ul>
    <div class="ap-plot" dir="ltr"><svg class="ap-chart" viewBox="0 0 ${PLOT.w} ${PLOT.h}" aria-hidden="true" focusable="false">
      <path class="ap-then-line" d="${line(p.then)}"/>
      <path class="ap-area" d="${line(p.now)}L${x(last).toFixed(1)},${PLOT.base}L${x(0).toFixed(1)},${PLOT.base}Z"/>
      <path class="ap-now-line" pathLength="1" d="${line(p.now)}"/>
      <circle class="ap-pulse" cx="${x(last).toFixed(1)}" cy="${y(p.now[last] ?? 0).toFixed(1)}" r="6"/>
      <circle class="ap-dot" cx="${x(last).toFixed(1)}" cy="${y(p.now[last] ?? 0).toFixed(1)}" r="5"/>
    </svg></div>
    <p class="ap-axis"><span>${bdi(p.from)}</span><span>${bdi(p.to)}</span></p></div>`;
}

const DRAW = { flow, people, week, trend } as const;

/**
 * An answer's picture with its words: the two radios, the picture, and `wordsHtml` (the answer's own lines).
 * `kind` names the picture for whoever cannot see it.
 */
export function pictureHtml(locale: Locale, p: Picture, wordsHtml: string): string {
  const drawn = (DRAW[p.kind] as (l: Locale, x: Picture) => string)(locale, p);
  return `<div class="ask-pic" data-ask-pic="${p.kind}" data-ap-src="${ASK_PICTURE_JS}">
    <figure class="ap-fig" aria-label="${esc(t(locale, `askPicture.kind.${p.kind}`))}">${drawn}</figure>
    <div class="ap-lines">${wordsHtml}</div>
    <fieldset class="ap-show"><legend>${esc(t(locale, 'askPicture.show'))}</legend>
      <label><input type="radio" name="ask-pic-show" value="picture" class="ap-as-pic" checked><span>${esc(t(locale, 'askPicture.picture'))}</span></label>
      <label><input type="radio" name="ask-pic-show" value="words" class="ap-as-words"><span>${esc(t(locale, 'askPicture.words'))}</span></label>
    </fieldset></div>`;
}
