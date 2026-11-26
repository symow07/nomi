/**
 * THE PICTURE OF AN ANSWER — its ribbons and its motion (the owner, 2026-11-26; askPicture.ts draws the boxes,
 * askPictureStyle.ts is the picture at rest). A file of its own, asked for by the one script only on a page that
 * drew a picture (layout.ts, ASK_PICTURE_JS).
 *
 *   · RIBBONS. Where a picture's boxes are joined (`data-ap-links`), it measures the boxes where the page laid them
 *     out and draws a ribbon from each to the next, behind them and tucked under their edges, so no end shows short
 *     or long. Drawn again when the picture changes width or is shown again.
 *   · MOTION, all of it here and none in the stylesheet: the boxes arrive one after another, a light runs once
 *     round the picture's edge, then one light travels inside the ribbons from the first box to the last, each box
 *     lit as the light reaches it; the trend draws its line. The owner chose this pace for the picture (2026-11-26);
 *     it is slower than the app's own short moves on purpose. For a reader who asked for less motion NOTHING here
 *     moves: the ribbons are drawn, still.
 *
 * It reads nothing but the page and sends nothing. Without it the boxes stand in the same places, unjoined.
 */
export const ASK_PICTURE_SCRIPT = String.raw`
(function () {
  var doc = document, pics = doc.querySelectorAll('.ask-pic');
  if (!pics.length) return;
  var TUCK = 12, STEP = 950, REST = 1500, EASE = 'cubic-bezier(.25,.46,.45,.94)', seq = 0;
  function calm() { return !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !doc.body.animate; }
  function box(e) { return { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight, cx: e.offsetLeft + e.offsetWidth / 2, cy: e.offsetTop + e.offsetHeight / 2 }; }
  function is(e, name) { return (' ' + e.getAttribute('class') + ' ').indexOf(' ' + name + ' ') >= 0; }
  /* From box a to box b, ending under each one's edge; a round b is met on its curve. */
  function route(a, b, round, trunk) {
    var apart = b.x >= a.x + a.w - 2 || b.x + b.w <= a.x + 2, r = b.w / 2, s, x1, y1, x2, y2, m, dy;
    if (trunk && apart && (a.cy > b.y + b.h || a.cy < b.y)) {
      s = b.cx < a.cx ? -1 : 1; dy = b.cy < a.cy ? -1 : 1;
      x1 = a.cx + s * (a.w / 2 - TUCK); y1 = a.cy; y2 = b.cy - dy * (r - TUCK);
      return { d: 'M' + x1 + ',' + y1 + ' L' + (b.cx - s * 22) + ',' + y1 + ' Q' + b.cx + ',' + y1 + ' ' + b.cx + ',' + (y1 + dy * 22) + ' L' + b.cx + ',' + y2, x1: x1, y1: y1, x2: b.cx, y2: y2 };
    }
    /* Beside and below (or above) with little room between: out of a's side, and round into b from above. */
    if (apart && !round && (b.y > a.y + a.h || b.y + b.h < a.y) && Math.max(b.x - a.x - a.w, a.x - b.x - b.w) < 40) {
      s = b.cx > a.cx ? 1 : -1; dy = b.cy > a.cy ? 1 : -1;
      x1 = a.cx + s * (a.w / 2 - TUCK); y1 = a.cy; y2 = b.cy - dy * (b.h / 2 - TUCK);
      return { d: 'M' + x1 + ',' + y1 + ' L' + (b.cx - s * 28) + ',' + y1 + ' Q' + b.cx + ',' + y1 + ' ' + b.cx + ',' + (y1 + dy * 28) + ' L' + b.cx + ',' + y2, x1: x1, y1: y1, x2: b.cx, y2: y2 };
    }
    if (apart) {
      s = b.cx > a.cx ? 1 : -1; x1 = a.cx + s * (a.w / 2 - TUCK); y1 = a.cy;
      if (round) { dy = Math.max(-r * 0.6, Math.min(r * 0.6, (a.cy - b.cy) * 0.14)); y2 = b.cy + dy; x2 = b.cx - s * (Math.sqrt(r * r - dy * dy) - TUCK); }
      else { x2 = b.cx - s * (b.w / 2 - TUCK); y2 = b.cy; }
      m = (x1 + x2) / 2;
      return { d: 'M' + x1 + ',' + y1 + ' C' + m + ',' + y1 + ' ' + m + ',' + y2 + ' ' + x2 + ',' + y2, x1: x1, y1: y1, x2: x2, y2: y2 };
    }
    s = b.cy > a.cy ? 1 : -1; x1 = a.cx; y1 = a.cy + s * (a.h / 2 - TUCK); x2 = b.cx; y2 = b.cy - s * ((round ? r : b.h / 2) - TUCK); m = (y1 + y2) / 2;
    return { d: 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + m + ' ' + x2 + ',' + m + ' ' + x2 + ',' + y2, x1: x1, y1: y1, x2: x2, y2: y2 };
  }
  function stop(host) { var run = host._apRun || [], i; for (i = 0; i < run.length; i++) { try { run[i].cancel(); } catch (e) { /* already over */ } } host._apRun = []; }
  function draw(fig, first) {
    var svg = fig.querySelector('svg.ap-wires');
    if (!svg) return;
    stop(fig);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!fig.offsetWidth) return;
    function el(name, attrs) { var e = doc.createElementNS(svg.namespaceURI, name), k; for (k in attrs) e.setAttribute(k, attrs[k]); return e; }
    var links = String(fig.getAttribute('data-ap-links') || '').split(',').filter(Boolean).map(function (l) {
      var waits = l.charAt(l.length - 1) === '!', p = (waits ? l.slice(0, -1) : l).split('>');
      return { from: p[0], to: p[1], waits: waits };
    });
    var nodes = {}, found = fig.querySelectorAll('[data-ap-k]'), i;
    for (i = 0; i < found.length; i++) nodes[found[i].getAttribute('data-ap-k')] = found[i];
    var defs = el('defs', {}), depth = {}, pass, top = 0, plan = [], still = calm();
    svg.appendChild(defs);
    links.forEach(function (l) { if (!links.some(function (o) { return o.to === l.from; })) depth[l.from] = 0; });
    for (pass = 0; pass < 8; pass++) links.forEach(function (l) { if (depth[l.from] != null) depth[l.to] = Math.max(depth[l.to] || 0, depth[l.from] + 1); });
    links.forEach(function (l) {
      var A = nodes[l.from], B = nodes[l.to];
      if (!A || !B) return;
      var r = route(box(A), box(B), is(B, 'ap-you'), is(fig, 'ap-people'));
      var id = 'ap-g' + (++seq), g = el('linearGradient', { id: id, gradientUnits: 'userSpaceOnUse', x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 });
      g.appendChild(el('stop', { offset: '0', 'class': l.waits ? 'ap-s-wa' : 'ap-s-a' }));
      g.appendChild(el('stop', { offset: '1', 'class': l.waits ? 'ap-s-wb' : 'ap-s-b' }));
      defs.appendChild(g);
      svg.appendChild(el('path', { 'class': 'ap-ribbon', d: r.d, stroke: 'url(#' + id + ')' }));
      if (still || is(B, 'ap-none')) return;
      var soft = el('path', { 'class': 'ap-streak ap-soft', d: r.d, pathLength: '100' }), light = el('path', { 'class': 'ap-streak', d: r.d, pathLength: '100' });
      svg.appendChild(soft); svg.appendChild(light);
      top = Math.max(top, depth[l.from] || 0);
      plan.push({ marks: [soft, light], depth: depth[l.from] || 0, to: B, from: A });
    });
    if (still || !plan.length) return;
    var whole = (top + 1) * STEP + REST, wait = first ? 1100 : 0, lit = [];
    if (first) fig._apRun.push(svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 350, easing: EASE, fill: 'backwards' }));
    function glow(node, at) {
      if (lit.indexOf(node) >= 0 || is(node, 'ap-none')) return;
      lit.push(node);
      var o = Math.min(at / whole, 0.97), e = Math.min(o + 0.14, 1), off = '0 0 0 0 transparent, 0 0 0 0 transparent';
      var on = '0 0 0 5px color-mix(in srgb, var(--color-cue) 18%, transparent), 0 0 26px 2px color-mix(in srgb, var(--color-cue) 40%, transparent)';
      fig._apRun.push(node.animate([{ boxShadow: off, offset: 0 }, { boxShadow: off, offset: Math.max(o - 0.02, 0) }, { boxShadow: on, offset: Math.min(o + 0.03, e) }, { boxShadow: off, offset: e }, { boxShadow: off, offset: 1 }],
        { duration: whole, iterations: Infinity, delay: wait }));
    }
    plan.forEach(function (p) { if (p.depth === 0) glow(p.from, 0); });
    plan.forEach(function (p) {
      var s0 = (p.depth * STEP + 140) / whole, s1 = ((p.depth + 1) * STEP + 80) / whole;
      p.marks.forEach(function (m) {
        fig._apRun.push(m.animate([{ strokeDashoffset: 26, offset: 0 }, { strokeDashoffset: 26, offset: s0, easing: 'cubic-bezier(.45,.05,.3,1)' }, { strokeDashoffset: -100, offset: s1 }, { strokeDashoffset: -100, offset: 1 }],
          { duration: whole, iterations: Infinity, delay: wait }));
      });
      glow(p.to, (p.depth + 1) * STEP);
    });
  }
  /* The arrival, once: the boxes one after another, a light round the edge, the trend's line drawn. */
  function arrive(pic) {
    var frame = pic.querySelector('.ap-fig'), parts, i, sweep, line, area, dot, pulse;
    if (!frame || calm()) return;
    parts = frame.querySelectorAll('.ap-n, .ap-item');
    for (i = 0; i < parts.length; i++) parts[i].animate([{ opacity: 0, transform: 'translateY(10px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
      { duration: 500, delay: Math.min(i, 9) * 90, easing: EASE, fill: 'backwards' });
    sweep = doc.createElement('span');
    sweep.className = 'ap-sweep';
    sweep.setAttribute('aria-hidden', 'true');
    frame.appendChild(sweep);
    sweep.animate([{ opacity: 1, backgroundPosition: '100% 0' }, { opacity: 1, backgroundPosition: '0% 0', offset: 0.85 }, { opacity: 0, backgroundPosition: '0% 0' }], { duration: 1400, easing: 'ease-in-out' });
    line = frame.querySelector('.ap-now-line'); area = frame.querySelector('.ap-area'); dot = frame.querySelector('.ap-dot'); pulse = frame.querySelector('.ap-pulse');
    if (line) line.animate([{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], { duration: 1100, delay: 200, easing: EASE, fill: 'backwards' });
    if (area) area.animate([{ opacity: 0 }, { opacity: 0.08 }], { duration: 900, delay: 700, easing: EASE, fill: 'backwards' });
    if (dot) dot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1200, easing: EASE, fill: 'backwards' });
    if (pulse) pulse.animate([{ transform: 'scale(1)', opacity: 0.5 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 2200, delay: 1400, iterations: Infinity, easing: 'ease-out' });
  }
  Array.prototype.forEach.call(pics, function (pic) {
    var fig = pic.querySelector('[data-ap-links]'), pending = 0, wide = fig ? fig.offsetWidth : 0;
    function again() { if (pending || !fig) return; pending = window.setTimeout(function () { pending = 0; wide = fig.offsetWidth; draw(fig, false); }, 60); }
    arrive(pic);
    if (!fig) return;
    draw(fig, true);
    if (window.ResizeObserver) new ResizeObserver(function () { if (fig.offsetWidth !== wide) again(); }).observe(fig);
    else window.addEventListener('resize', again);
    pic.addEventListener('change', again);
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) doc.fonts.ready.then(again);
  });
})();
`;
