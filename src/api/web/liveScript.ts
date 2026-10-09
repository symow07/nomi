/**
 * CC-26 — THE ONE SCRIPT, as the browser receives it.
 *
 * The audit: "Nothing on the page updates by itself. A new buyer message
 * appears only if she reloads, and there is no script anywhere in the app to
 * tell her." This is that script, and the only one: the shell links it once,
 * at an address named by its content (`/assets/live.<hash>.js`, the stylesheets'
 * mechanism), so the browser fetches it once per build and keeps it.
 *
 * WHAT IT DOES, AND NOTHING ELSE:
 *
 *   1. On a page that declares a watch (a `[data-live]` region, drawn by
 *      `liveRegion` in flash.ts), it asks the address in that attribute every
 *      twenty seconds whether anything arrived since the page was drawn. The
 *      page carries the mark it was drawn at; the app compares — the browser's
 *      clock never decides anything. When the answer is yes it puts the line
 *      the page prepared (a `<template>`) into the region, once, and stops
 *      asking. It never reloads by itself and never moves the page.
 *   2. It does not ask while the tab is hidden, asks at once when it is shown
 *      again, lets an answer that never comes go after fifteen seconds, waits
 *      longer after each failure (up to five minutes), and stops for good when
 *      the answer says the owner is signed out or the page is gone (401, 403,
 *      404, a redirect) — no error loops.
 *   3. The line's door reloads the page when it is the same address — a link
 *      to the address a page already has only scrolls to its mark — and lands
 *      where a fresh page lands (CC-25's `#latest`), not where this one was.
 *   4. The draft's edit box and the owner's own reply box (`textarea[data-keep]`)
 *      keep what she typed in the tab's own memory, by conversation and box,
 *      until it is sent: any reload puts it back in the same box, and after
 *      this script's door, with the caret where it was. CC-24 already keeps a
 *      REFUSED edit or reply on the server; this covers the words that never
 *      left the page. Signing out forgets them.
 *   5. PHASE 5 OF THE UI REBUILD (2026-10-02) — the assistant at work, in
 *      place. A page drawn while the assistant is answering its conversation
 *      (`data-live-working`, live.ts `assistantWorking`) says so where the
 *      reply will be, and asks every four seconds instead of twenty. When the
 *      work is done — or anything else changed — it fetches the same address
 *      and draws that page's main into this one: no reload, the words being
 *      typed kept in their box, the reply brought into view if the line was in
 *      view. If the page cannot be had, the line is shown instead, as above.
 *      Phase 6: fifteen minutes at most; then the page's own last word (its
 *      `slow` line, where it has one — Billing's) instead of asking forever.
 *   7. Phase 6 — a form on its way: the button that sent it is marked busy
 *      (`aria-busy`, three dots after its word), and a second press does not
 *      send it again. A page that stays where it is (a download) gives the
 *      button back after twelve seconds; coming back to a page from history
 *      gives every button back.
 *   6. Phase 5 — asking first in the product's own dialog (`askDialog`,
 *      layout.ts) instead of the browser's grey box: a click on a button that
 *      asks (`data-confirm`) is caught before the button's own handler, the
 *      dialog says the question, its button carries the button's word, and
 *      going ahead submits the form as that button would. With no dialog in
 *      the browser the click goes through and the button asks as before.
 *   8. THE WARMTH RUN (2026-10-03), phase 8 — wherever the owner is in Nomi,
 *      a customer newly waiting surfaces: every page asks the rail's question
 *      (`data-rail`, live.ts `railAnswer`) on the same twenty-second rhythm;
 *      the rail's number is redrawn in place, and a RISE also puts a quiet
 *      dot on Inbox and one small card at the foot of the screen — who and
 *      why, a door to the conversation — that goes after six seconds or when
 *      it is tapped. One at a time, in a polite live region; its motion is
 *      the stylesheet's, so a reader who asked for less gets none. No sound,
 *      no counter in the tab's title. On Today (`data-live-redraw`) news is
 *      drawn into the page in place, as item 5 draws a reply, instead of the
 *      line. (The browser's own "an order waits" notice, asked for on Today,
 *      is retired: how anyone hears outside Nomi is their choice on
 *      Notifications, and the card says it inside.)
 *
 *   9. THE ADVISOR'S ORB (2026-10-07) — on the advisor's page only (its form names it, `data-orb`), in
 *      two states and no other. RESTING: while nothing has been asked (the page draws `[data-orb-rest]`
 *      only then), a large orb at the head of the page, gently moving — the page's "ask me". THINKING:
 *      once a question is on its way, the resting orb gives way; the question goes up as asked and,
 *      under it, the small orb and its calm line (`template[data-orb-pending]`), until the answer's page
 *      replaces this one. The orb is the library's own (thinking-orbs, vendored in assets/vendor/; its
 *      `composing` state, its painter in its dark-paper mode), only its two ends ours; under it, a ground
 *      that is ours — the deep magenta glow behind it, and nothing solid (no body, no shadow: 2026-10-09). The
 *      ground is drawn at once; the orb's file is imported once the page has loaded. It moves only while
 *      the page is seen (paused while the tab is hidden, resumed when shown); a reader who asked for less
 *      motion gets one still frame of each. If the orb cannot be had, its ground stays — no gap, nothing
 *      moves; back from history, the page is as it was. tests/parity/advisor-orb.test.ts.
 *
 * Progressive: every page works exactly as before with scripting off — read,
 * reply, approve, send. Nothing here is needed for any of it.
 *
 * It is written for the browser, not compiled: plain ES2017 in a string, so
 * what is tested is byte for byte what ships (`tests/parity/live-refresh.test.ts`
 * runs it against a small stand-in for the page). It ships to the owner's
 * browser like the stylesheet, so it is held to the owner vocabulary the same
 * way (the exceptions are the browser's own two names for the answer's
 * format: the `.json()` method and the `application/json` type it asks for;
 * and G5b's `JSON.stringify(sub)`, the browser's way to hand over a push
 * subscription).
 */
export const LIVE_SCRIPT = `/* Nomi: the line a page shows when something new arrives (CC-26).
   One small script, linked once by the shell. Every page works without it. */
(function () {
  'use strict';
  var doc = document;
  var EVERY = 20000;
  var LONGEST = 300000;
  var HIDDEN = 60000;
  /* Phase 5: while the assistant is at work on the page's conversation. */
  var WORKING = 4000;
  /* Phase 6: and for fifteen minutes at most; then the page's own last word, if it has one. */
  var WORKING_ROUNDS = 225;

  /* The tab's own memory: it goes when the tab closes and is never sent. */
  var memory = (function () {
    try {
      var s = window.sessionStorage;
      s.setItem('nomi.probe', '1');
      s.removeItem('nomi.probe');
      return s;
    } catch (e) { return false; }
  })();
  function recall(k) { try { return memory ? memory.getItem(k) : ''; } catch (e) { return ''; } }
  function note(k, v) { try { if (memory) memory.setItem(k, v); } catch (e) { /* full or refused: the words stay in the box */ } }
  function forget(k) { try { if (memory) memory.removeItem(k); } catch (e) { /* nothing to do */ } }

  /* The half-typed reply: kept by conversation and box until it is sent. */
  var boxes = [];
  var typing = '';

  function keepBox(box, back) {
    var which = box.getAttribute('data-keep');
    var key = 'nomi.words.' + which;
    var kept = recall(key);
    if (kept) {
      var words = kept.slice(1);
      if (box.value !== words) box.value = words;
    }
    if (back && back === which) {
      try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
      var caret = String(recall(key + '.caret') || '').split(',');
      var a = Number(caret[0]);
      var b = Number(caret[1]);
      if (caret.length === 2 && a >= 0 && b >= a && b <= box.value.length) {
        try { box.setSelectionRange(a, b); } catch (e) { /* not every box can say where */ }
      }
    }
    /* Sent: the words are on their way, and leaving the page must not
       write them back. Typing again takes them back. */
    var entry = { box: box, key: key, sent: false, save: save };
    function save() {
      if (entry.sent) return;
      if (box.value === box.defaultValue) { forget(key); forget(key + '.caret'); return; }
      note(key, '=' + box.value);
      note(key + '.caret', box.selectionStart + ',' + box.selectionEnd);
    }
    box.addEventListener('input', function () { entry.sent = false; save(); });
    box.addEventListener('blur', save);
    boxes.push(entry);
  }

  /* Only the line's door asks for the caret back: any other way out keeps the words alone. */
  function keepNow(returning) {
    for (var i = 0; i < boxes.length; i++) boxes[i].save();
    if (returning === true && typing) note('nomi.return', typing);
  }

  function keepWords() {
    var back = recall('nomi.return');
    forget('nomi.return');
    var found = doc.querySelectorAll('textarea[data-keep]');
    for (var i = 0; i < found.length; i++) keepBox(found[i], back);
    doc.addEventListener('focusin', function (e) {
      var t = e.target;
      var tag = t && t.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') typing = t.getAttribute('data-keep') || '';
    });
    doc.addEventListener('submit', function (e) {
      var form = e.target;
      var to = form && form.action ? String(form.action) : '';
      if (/\\/logout$/.test(to)) { forgetAll(); return; }
      for (var i = 0; i < boxes.length; i++) {
        var own = boxes[i].box.form;
        if (own && String(own.action) === to) {
          boxes[i].sent = true;
          forget(boxes[i].key);
          forget(boxes[i].key + '.caret');
        }
      }
    }, true);
  }

  function forgetAll() {
    if (!memory) return;
    try {
      for (var i = memory.length - 1; i >= 0; i--) {
        var k = memory.key(i);
        if (k && k.indexOf('nomi.') === 0) memory.removeItem(k);
      }
    } catch (e) { /* nothing to do */ }
  }

  /* The door: the same address is loaded again, landing where a fresh page lands. */
  function go(e, door) {
    keepNow(true);
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var to;
    try { to = new URL(door.href, location.href); } catch (x) { return; }
    if (to.pathname + to.search !== location.pathname + location.search) return;
    e.preventDefault();
    try { history.scrollRestoration = 'manual'; } catch (x) { /* the browser keeps its own */ }
    if (to.hash !== location.hash) history.replaceState(history.state, '', to.href);
    location.reload();
  }

  /* The line: put in once, from the page's own template, and never moved. */
  function show(region, what) {
    if (region.firstChild) return;
    var tpl = doc.querySelector('template[data-live-news="' + (/^[a-z]+$/.test(String(what)) ? what : '') + '"]')
      || doc.querySelector('template[data-live-news]');
    if (!tpl) return;
    region.appendChild(tpl.content.cloneNode(true));
    var door = region.querySelector('a');
    if (door) door.addEventListener('click', function (e) { go(e, door); });
  }

  /* G5b: alerts on this phone. The browser's push service gives an address
     and two keys; Nomi keeps them, and the phone's own worker shows the alert. */
  function phone() {
    var on = doc.querySelector('[data-push-key]');
    var bad = doc.querySelector('[data-push-failed]');
    if (!on) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      var no = doc.querySelector('[data-push-cannot]');
      if (no) no.hidden = false;
      return;
    }
    on.hidden = false;
    on.addEventListener('click', function () {
      on.disabled = true;
      var raw = atob(on.getAttribute('data-push-key').replace(/-/g, '+').replace(/_/g, '/'));
      var key = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
      navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; })
        .then(function (reg) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); })
        .then(function (sub) {
          var form = new URLSearchParams();
          form.set('subscription', JSON.stringify(sub));
          form.set('device', String(navigator.userAgent).slice(0, 120));
          return fetch(on.getAttribute('data-push-save'), { method: 'POST', credentials: 'same-origin', body: form });
        })
        .then(function (r) { if (!r.ok) throw new Error('not kept'); location.reload(); })
        .catch(function () { on.disabled = false; if (bad) bad.hidden = false; });
    });
  }

  /* Phase 5: the page again, drawn into this one: no reload, nothing typed
     lost, the place the reply took brought into view if it was in view. If
     the page cannot be had, the line is shown instead, as before. */
  function redraw(region, what) {
    keepNow();
    var main = doc.querySelector('main');
    var active = doc.activeElement;
    var held = active && main && main.contains(active) && active.id && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')
      ? { id: active.id, value: active.value, a: active.selectionStart, b: active.selectionEnd } : 0;
    var where = doc.querySelector('.working');
    var box = where && where.getBoundingClientRect ? where.getBoundingClientRect() : 0;
    var seen = !!box && box.bottom > 0 && box.top < (window.innerHeight || 0);
    fetch(location.pathname + location.search, {
      credentials: 'same-origin', redirect: 'manual', cache: 'no-store', headers: { Accept: 'text/html' }
    }).then(function (r) {
      if (!r.ok || r.type === 'opaqueredirect') throw new Error('not drawn');
      return r.text();
    }).then(function (html) {
      var next = new DOMParser().parseFromString(html, 'text/html');
      var fresh = next.querySelector('main');
      if (!main || !fresh) throw new Error('not drawn');
      /* The page's own nodes, as Nomi drew them, moved across: the script writes no markup. */
      while (main.firstChild) main.removeChild(main.firstChild);
      while (fresh.firstChild) main.appendChild(doc.adoptNode(fresh.firstChild));
      if (main.setAttribute) main.setAttribute('data-drawn-again', '1');
      if (next.title) doc.title = next.title;
      var found = main.querySelectorAll('textarea[data-keep]');
      for (var i = 0; i < found.length; i++) keepBox(found[i], '');
      if (held) {
        var again = doc.getElementById(held.id);
        if (again && 'value' in again) {
          if (!again.value) again.value = held.value;
          try { again.focus({ preventScroll: true }); again.setSelectionRange(held.a, held.b); } catch (e) { /* not every box can say where */ }
        }
      }
      if (seen) {
        var to = doc.getElementById('approve') || doc.getElementById('latest');
        var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        if (to && to.scrollIntoView) {
          try { to.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' }); } catch (e) { to.scrollIntoView(false); }
        }
      }
      begin();
    }).catch(function () { show(region, what || 'reply'); });
  }

  /* One question, asked again and again: every so often while the tab is in
     view, at once when it is shown again, longer after each failure (up to
     five minutes), let go after fifteen seconds without an answer, and never
     again once the answer says the session or the page is gone. */
  function asker(address, every, use, before) {
    var wait = every;
    var timer = 0;
    var over = false;
    var busy = false;
    var self = {
      stop: function () { over = true; clearTimeout(timer); },
      shown: function () { later(0); },
      hidden: function () { clearTimeout(timer); }
    };
    function later(ms) {
      clearTimeout(timer);
      timer = over ? 0 : setTimeout(look, ms);
    }
    function look() {
      if (over || busy || doc.visibilityState === 'hidden') return;
      if (before && !before(self)) return;
      busy = true;
      var init = {
        credentials: 'same-origin', redirect: 'manual', cache: 'no-store',
        headers: { Accept: 'application/json' }
      };
      var ctl = window.AbortController ? new window.AbortController() : 0;
      var cut = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : 0;
      if (ctl) init.signal = ctl.signal;
      fetch(address(), init).then(function (r) {
        /* Signed out, the page gone, or an answer this page cannot use: stop, quietly. */
        if (r.type === 'opaqueredirect' || (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)) {
          self.stop();
          return;
        }
        if (!r.ok) throw new Error('not now');
        return r.json().then(function (said) {
          wait = every;
          use(said, self);
          later(every);
        });
      }).catch(function () {
        wait = Math.min(wait * 2, LONGEST);
        later(wait);
      }).then(function () { clearTimeout(cut); busy = false; });
    }
    later(every);
    return self;
  }

  function watch(region) {
    var ask = region.getAttribute('data-live');
    /* Phase 5: drawn with the assistant at work: ask often, and draw its answer in. */
    var working = region.getAttribute('data-live-working') === '1';
    /* Phase 8: a page that is drawn again in place when it changes (Today). */
    var redraws = region.getAttribute('data-live-redraw') === '1';
    var rounds = 0;
    return asker(function () { return ask; }, working ? WORKING : EVERY, function (said, self) {
      if (!said) return;
      /* The work is done, or something else changed: the page is drawn again, in place. */
      if ((working && (said.working !== true || said.news === true)) || (redraws && said.news === true)) {
        self.stop();
        redraw(region, said.what);
        return;
      }
      /* The line goes in once, and asking stops. */
      if (said.news === true) { show(region, said.what); self.stop(); }
    }, function (self) {
      if (working && ++rounds > WORKING_ROUNDS) {
        self.stop();
        if (doc.querySelector('template[data-live-news="slow"]')) show(region, 'slow');
        return false;
      }
      return true;
    });
  }

  /* Phase 8: the rail's question, from every page. The number is redrawn in
     place; a rise also marks Inbox and says who and why in one small card. */
  var SHOWN = 6000;
  var LEAVE = 250;
  var card = 0;
  var cardTimer = 0;
  /* Gone at once when tapped; after its time it slides out first (the stylesheet's "out"). */
  function drop(c, slow) {
    if (card === c) { card = 0; clearTimeout(cardTimer); }
    if (!slow) { if (c.parentNode) c.parentNode.removeChild(c); return; }
    c.className = 'toast out';
    setTimeout(function () { drop(c); }, LEAVE);
  }
  function toast(slot, said) {
    var door = String(said.door || '');
    /* Only an address inside the app, as the answer gives it. */
    if (!/^\\/app\\/[A-Za-z0-9\\/_.#-]*$/.test(door)) return;
    if (card) drop(card, 1);
    var c = doc.createElement('a');
    c.className = 'toast';
    c.href = door;
    c.textContent = String(said.say || '');
    c.addEventListener('click', function () { drop(c); });
    /* Read at the reader's pace: held while pointed at or focused, then its time again. */
    function hold() { if (card === c) clearTimeout(cardTimer); }
    function release() { if (card !== c) return; clearTimeout(cardTimer); cardTimer = setTimeout(function () { drop(c, 1); }, SHOWN); }
    c.addEventListener('mouseenter', hold);
    c.addEventListener('focus', hold);
    c.addEventListener('mouseleave', release);
    c.addEventListener('blur', release);
    slot.appendChild(c);
    card = c;
    release();
  }
  function tally(entry, said) {
    var badge = entry.querySelector('.navcount');
    if (said.n > 0) {
      if (!badge) {
        badge = doc.createElement('span');
        badge.className = 'navcount';
        badge.setAttribute('aria-hidden', 'true');
        (entry.querySelector('.nl-body') || entry).appendChild(badge);
      }
      /* The words where there is room, the figure on a phone's tile, as the page draws them. */
      while (badge.firstChild) badge.removeChild(badge.firstChild);
      var long = doc.createElement('span');
      long.className = 'nl-long';
      long.textContent = String(said.words || said.shown);
      var short = doc.createElement('span');
      short.className = 'nl-short';
      short.textContent = String(said.shown);
      badge.appendChild(long);
      badge.appendChild(short);
      entry.setAttribute('aria-label', String(said.label));
    } else {
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      entry.removeAttribute('aria-label');
      entry.removeAttribute('data-fresh');
    }
  }
  function rail(slot) {
    var ask = slot.getAttribute('data-rail');
    return asker(function () { return ask; }, EVERY, function (said) {
      if (!said || typeof said.n !== 'number' || !/^[0-9]+([.][0-9]+)?$/.test(String(said.mark))) return;
      ask = ask.replace(/since=[0-9.]+/, 'since=' + said.mark);
      var entry = doc.querySelector('[data-nav="inbox"]');
      if (entry) tally(entry, said);
      if (said.toast) {
        if (entry) entry.setAttribute('data-fresh', '1');
        toast(slot, said.toast);
      }
    });
  }

  /* One watcher at a time: a page drawn in place starts its own, and the old one stops. */
  var watcher = 0;
  // Phase 9 (V1-195) — a month wider than the screen opens on the chosen day, else on today.
  function toToday() {
    var cell = doc.querySelector('a[aria-current="true"]') || doc.querySelector('[aria-current="date"]');
    var box = cell && cell.closest ? cell.closest('.wk-scroll') : 0;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    var b = box.getBoundingClientRect(), c = cell.getBoundingClientRect();
    box.scrollLeft += (c.left - b.left) - (b.width - c.width) / 2;
  }

  function begin() {
    if (watcher) watcher.stop();
    watcher = 0;
    var region = doc.querySelector('[data-live]');
    if (region && window.fetch) watcher = watch(region);
  }
  var railer = 0;
  function startRail() {
    var slot = doc.querySelector('[data-rail]');
    if (slot && window.fetch) railer = rail(slot);
  }
  doc.addEventListener('visibilitychange', function () {
    var hidden = doc.visibilityState === 'hidden';
    if (watcher) { if (hidden) watcher.hidden(); else watcher.shown(); }
    if (railer) { if (hidden) railer.hidden(); else railer.shown(); }
  });
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    if (watcher) watcher.shown();
    if (railer) railer.shown();
  });

  /* Phase 5: the product's own dialog in place of the browser's grey box, for
     every button that asks first (its question in data-confirm). Without it,
     or in a browser that cannot, the button still asks with the browser's own. */
  function asking() {
    var box = doc.querySelector('[data-ask]');
    if (!box || typeof box.showModal !== 'function') return;
    var said = box.querySelector('[data-ask-q]');
    var yes = box.querySelector('[data-ask-yes]');
    var no = box.querySelector('[data-ask-no]');
    var pending = 0;
    function shut() { pending = 0; box.close(); }
    doc.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-confirm]') : 0;
      if (!b || !b.form || typeof b.form.requestSubmit !== 'function') return;
      e.preventDefault();
      e.stopPropagation();
      /* A form not filled in is said so first, by the browser, under its field; nothing is asked (w4-settings-a-15). */
      if (typeof b.form.checkValidity === 'function' && !b.form.checkValidity()) {
        if (typeof b.form.reportValidity === 'function') b.form.reportValidity();
        return;
      }
      pending = b;
      said.textContent = b.getAttribute('data-confirm');
      yes.textContent = String(b.textContent || '').trim();
      yes.className = 'btn ' + (/(^| )danger( |$)/.test(String(b.className)) ? 'danger' : 'send');
      box.showModal();
    }, true);
    yes.addEventListener('click', function () {
      var b = pending;
      shut();
      /* 0126 — a form that erases carries asked=0; said yes here, it goes with asked=1. With no script, the route asks on a page. */
      var said1 = b && b.form.querySelector ? b.form.querySelector('input[name="asked"]') : 0;
      if (said1) said1.value = '1';
      if (b) b.form.requestSubmit(b);
    });
    no.addEventListener('click', shut);
    box.addEventListener('click', function (e) { if (e.target === box) shut(); });
  }

  /* Phase 6: a form on its way says so on the button that sent it, and is not
     sent twice. A page that stays (a download) gives the button back after a while. */
  var SENDING = 12000;
  function sending() {
    doc.addEventListener('submit', function (e) {
      var form = e.target;
      if (e.defaultPrevented || !form || !form.setAttribute || !form.getAttribute) return;
      /* A dialog's own close goes nowhere: never held. */
      if (form.getAttribute('method') === 'dialog') return;
      if (form.getAttribute('data-sending') === '1') { e.preventDefault(); return; }
      form.setAttribute('data-sending', '1');
      var b = e.submitter || (form.querySelector ? form.querySelector('button') : 0);
      if (b && b.setAttribute) b.setAttribute('aria-busy', 'true');
      /* The advisor's question is held until its answer's page arrives: the orb says it is still on its way. */
      if (form.hasAttribute && form.hasAttribute('data-orb')) return;
      setTimeout(function () {
        form.removeAttribute('data-sending');
        if (b && b.removeAttribute) b.removeAttribute('aria-busy');
      }, SENDING);
    });
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      var forms = doc.querySelectorAll('[data-sending]');
      for (var i = 0; i < forms.length; i++) forms[i].removeAttribute('data-sending');
      var buttons = doc.querySelectorAll('[aria-busy]');
      for (var j = 0; j < buttons.length; j++) buttons[j].removeAttribute('aria-busy');
    });
  }

  /* The warmth run: a face opens its customer's card, sprung up over the page
     (from the foot, on a phone). The card is its own page, fetched and lifted
     in; if it cannot be had, the face's link goes to that page. */
  function cards() {
    var sheet = doc.querySelector('[data-sheet]');
    var body = sheet && sheet.querySelector('[data-sheet-body]');
    if (!sheet || !body || typeof sheet.showModal !== 'function' || !window.fetch) return;
    var from = 0;
    doc.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[data-card]') : 0;
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      from = a;
      /* The press is heard at once: the face says it is opening (w4-whole-22). */
      if (a.setAttribute) a.setAttribute('aria-busy', 'true');
      fetch(a.href, { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'text/html' } }).then(function (r) {
        if (!r.ok || r.type === 'opaqueredirect') throw new Error('no card');
        return r.text();
      }).then(function (html) {
        var card = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-card-body]');
        if (!card) throw new Error('no card');
        if (a.removeAttribute) a.removeAttribute('aria-busy');
        while (body.firstChild) body.removeChild(body.firstChild);
        body.appendChild(doc.adoptNode(card));
        /* Opened over the conversation it would open, its door closes the card instead. */
        var door = card.querySelector ? card.querySelector('a.pc-open') : 0;
        if (door && String(door.getAttribute('href') || '').split('#')[0] === location.pathname) {
          door.addEventListener('click', function (ev) { ev.preventDefault(); sheet.close(); });
        }
        if (!sheet.open) sheet.showModal();
      }).catch(function () { location.href = a.href; });
    });
    sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.close(); });
    /* Closed, the card sinks away whole; the next face's card replaces it. */
    sheet.addEventListener('close', function () {
      if (from && from.focus) { try { from.focus({ preventScroll: true }); } catch (x) { from.focus(); } }
      from = 0;
    });
  }

  /* The advisor's orb (item 9): on its page only, resting while nothing is asked, thinking while a question is on its way. */
  function still() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function rgbOf(name) {
    return rgbFrom(window.getComputedStyle ? window.getComputedStyle(doc.documentElement).getPropertyValue(name) : '');
  }
  function rgbFrom(v) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(v || '').trim());
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : 0;
  }
  /* The library's own painter (thinking-orbs 0.3.2: paintFrame, paintLines, paint; MIT, Jakub Antalik,
     assets/vendor/thinking-orbs/0.3.2/LICENSE), line for line, in its dark-paper mode: a near dot light, a far
     one dark, by the same depth (1 - w). ONE change: the two ends are ours — the light end and the ink — where
     the library has white and black (the far end was the glow until 2026-10-09: a far dot vanished into the
     glow behind it). With white and black the two draw the very same calls; tests/parity/advisor-orb.test.ts
     holds that. */
  function inkColor(w, alpha, light, far) {
    var ramp = function (l, f) { return Math.round(f + (l - f) * (1 - w)); };
    return 'rgba(' + ramp(light.r, far.r) + ',' + ramp(light.g, far.g) + ',' + ramp(light.b, far.b) + ',' + alpha + ')';
  }
  function paintDots(ctx, dots, light, far) {
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      var alpha = typeof d.a === 'number' ? d.a : 1;
      var w = Math.min(1, Math.max(0, d.white));
      ctx.fillStyle = inkColor(w, alpha, light, far);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function paintLines(ctx, lines, light, far) {
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var alpha = typeof l.a === 'number' ? l.a : 1;
      var w = Math.min(1, Math.max(0, l.white));
      ctx.strokeStyle = inkColor(w, alpha, light, far);
      ctx.lineWidth = l.w;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    }
  }
  function paintFrame(ctx, frame, light, far) {
    if (frame.lines.length) paintLines(ctx, frame.lines, light, far);
    paintDots(ctx, frame.dots, light, far);
  }
  /* The ground under the orb — ours, not the library's, drawn first and never over its dots: the glow's halo
     bleeding into the paper, and nothing else. NOTHING SOLID (the owner, 2026-10-09): no body behind the dots,
     no shadow under them — dots floating in the light, every one the library draws in view, across the middle
     too. The halo is as it was (the owner's "medium"): [its depth, its reach]. */
  var GROUND = [0.75, 1.42];
  function tone(c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'; }
  function ground(ctx, size, glow, o) {
    var c = size / 2;
    var R = size / 2 * 0.78;
    var g = ctx.createRadialGradient(c, c, R * 0.55, c, c, R * o[1]);
    g.addColorStop(0, tone(glow, o[0]));
    g.addColorStop(0.55, tone(glow, o[0] * 0.35));
    g.addColorStop(1, tone(glow, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c, c, R * o[1], 0, Math.PI * 2); ctx.fill();
  }
  /* The lit field (the redesign, 2026-10-08): the orb's glow at its centre falling to nothing at the edges,
     drawn pixel by pixel with half a step of noise in each channel, so the fall shows no bands; a pixel the
     fall does not reach is left clear, and the paper shows. r: how far it reaches up, down, back and on.
     o.depth: how deep at the centre; o.fall: how fast it falls (higher: sooner to the paper); o.clear: drawn as
     the glow made thin, never as paper, for light that whatever passes beneath must show through. */
  function smoother(x) { x = x <= 0 ? 0 : x >= 1 ? 1 : x; return x * x * x * (x * (x * 6 - 15) + 10); }
  function wash(canvas, cx, cy, r, o) {
    var paper = o.paper;
    var glow = o.glow;
    var ctx = canvas.getContext ? canvas.getContext('2d') : 0;
    if (!ctx || !ctx.createImageData) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var box = canvas.getBoundingClientRect();
    var W = Math.max(1, Math.round(box.width * dpr));
    var H = Math.max(1, Math.round(box.height * dpr));
    canvas.width = W; canvas.height = H;
    var img = ctx.createImageData(W, H);
    var d = img.data;
    var seed = 2463534242;
    function noise() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
    for (var y = 0; y < H; y++) {
      var dy = (y + 0.5) / dpr - cy;
      var ny = dy / (dy < 0 ? r.up : r.down);
      ny *= ny;
      if (ny >= 1) continue;
      for (var x = 0; x < W; x++) {
        var dx = (x + 0.5) / dpr - cx;
        var nx = dx / (dx < 0 ? r.back : r.on);
        var q = nx * nx + ny;
        if (q >= 1) continue;
        var f = 1 - smoother(Math.sqrt(q));
        var t = Math.pow(f, o.fall) * o.depth;
        var at = (y * W + x) * 4;
        if (o.clear) {
          d[at] = glow.r; d[at + 1] = glow.g; d[at + 2] = glow.b;
          d[at + 3] = 255 * t + noise() + noise() - 1;
          continue;
        }
        d[at] = paper.r + (glow.r - paper.r) * t + noise() + noise() - 1;
        d[at + 1] = paper.g + (glow.g - paper.g) * t + noise() + noise() - 1;
        d[at + 2] = paper.b + (glow.b - paper.b) * t + noise() + noise() - 1;
        d[at + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  /* The empty bar types out three questions, one at a time, calmly, and loops; never the box's own text, never
     sent. It stops and clears the moment the box is touched or typed in, and starts again only when it is left
     empty. Less motion: the first question stands still, as the page drew it. */
  function typer(box, lines) {
    if (!box || !lines.length || still()) return;
    var k = 0; var n = 0; var timer = 0;
    function idle() { return box.isConnected && doc.activeElement !== box && box.value === '' && doc.visibilityState !== 'hidden'; }
    function stop() { if (timer) clearTimeout(timer); timer = 0; }
    function step() {
      timer = 0;
      if (!idle()) return;
      if (k >= lines.length) k = 0;
      var line = lines[k];
      if (n < line.length) { n += 1; box.setAttribute('placeholder', line.slice(0, n)); timer = setTimeout(step, n === line.length ? 2600 : 55); return; }
      box.setAttribute('placeholder', ''); n = 0; k += 1; timer = setTimeout(step, 700);
    }
    function start(wait) { stop(); if (idle()) timer = setTimeout(step, wait); }
    function hush() { stop(); box.setAttribute('placeholder', ''); }
    box.addEventListener('focus', hush);
    box.addEventListener('input', hush);
    box.addEventListener('blur', function () { if (box.value === '') { n = 0; k += 1; start(1200); } });
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') stop(); else if (!timer) start(700); });
    /* The box keeps the height of the longest question at this width, so nothing moves while one is typed. */
    var measured = -1;
    function room() {
      if (window.innerWidth === measured || box.value !== '') return;
      measured = window.innerWidth;
      var said = box.getAttribute('placeholder') || '';
      var most = 0;
      box.style.minBlockSize = '';
      for (var i = 0; i < lines.length; i++) { box.setAttribute('placeholder', lines[i]); most = Math.max(most, box.offsetHeight || 0); }
      box.setAttribute('placeholder', said);
      if (most > 0) box.style.minBlockSize = most + 'px';
    }
    room();
    window.addEventListener('resize', room);
    /* The page's own type arrives after the first measure, and a question that fitted may then take two lines. */
    function again() { measured = -1; room(); }
    if (doc.fonts && doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', again);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(again);
    box.setAttribute('placeholder', '');
    start(400);
  }
  function orbs() {
    var form = doc.querySelector('form[data-orb]');
    if (!form) return;
    var page = doc.querySelector('.adv-page');
    var tpl = doc.querySelector('template[data-orb-pending]');
    var line = doc.querySelector('.timeline');
    var rest = doc.querySelector('[data-orb-rest]');
    var here = form.querySelector('[data-orb-here]');
    var field = doc.querySelector('[data-adv-field]');
    var pool = form.querySelector('[data-adv-pool]');
    var src = form.getAttribute('data-orb');
    var state = form.getAttribute('data-orb-state');
    /* The glow is a palette colour, named: the page cannot hand the orb a colour of its own. */
    var glowSaid = String(form.getAttribute('data-orb-glow') || '');
    var glow = /^[a-z-]+$/.test(glowSaid) ? rgbOf('--color-' + glowSaid) : 0;
    var light = rgbOf('--color-surface');
    var ink = rgbOf('--color-ink');
    var paper = rgbOf('--color-paper');
    var plan = GROUND;
    var core = 0;
    var failed = false;
    var shown = [];
    function load() { if (!core) core = import(src); return core; }
    /* The orb's file is asked for only once the page has loaded: it plays no part in its first paint. */
    var loaded = new Promise(function (ok) { if (doc.readyState === 'complete') ok(); else window.addEventListener('load', function () { ok(); }); });
    /* Draws on a canvas half as large again as the orb (its margin holds the halo): the ground
       at once, with no file to wait for; then the library's orb on it, at a pace of its own speed, moving only
       while seen. If the orb cannot be had, the ground stays: no gap, and nothing moves. The pace can change
       (resting, then thinking) without the orb jumping. */
    function draw(canvas, pace) {
      var ctl = { pace: pace, base: 0, since: 0 };
      var ctx = glow && light && ink && plan && canvas.getContext ? canvas.getContext('2d') : 0;
      if (!ctx) { failed = true; return { ctl: ctl, done: Promise.reject(new Error('no orb here')) }; }
      var box = canvas.getBoundingClientRect().width || 96;
      var size = box / 1.5;
      var pad = size / 4;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(box * dpr);
      canvas.height = Math.round(box * dpr);
      function under() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, box, box);
        ctx.setTransform(dpr, 0, 0, dpr, dpr * pad, dpr * pad);
        ground(ctx, size, glow, plan);
      }
      under();
      var done = loaded.then(load).then(function (orb) {
        var pre = orb.r(state, 64);
        var shape = pre && orb.M[pre.mode];
        if (!shape) throw new Error('no such orb');
        /* The library's tuned 64 px orb, unchanged; larger only by the canvas's scale (the resting orb). */
        var k = size / 64;
        function paint(t) {
          under();
          ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * pad, dpr * pad);
          paintFrame(ctx, shape(64, t, pre.opts), light, ink);
        }
        paint(0.6);
        var running = false;
        function seen() { return canvas.isConnected && doc.visibilityState !== 'hidden' && !still() && !!window.requestAnimationFrame; }
        function frame(now) {
          if (!seen()) { running = false; return; }
          paint(ctl.base + (now - ctl.since) / 1000 * pre.speed * ctl.pace);
          ctl.last = now;
          window.requestAnimationFrame(frame);
        }
        ctl.speed = pre.speed;
        function go() { if (!running && seen()) { running = true; window.requestAnimationFrame(frame); } }
        doc.addEventListener('visibilitychange', go);
        go();
      });
      done.catch(function () { failed = true; });
      return { ctl: ctl, done: done };
    }
    /* A new pace from now on, the orb taking up where it is. */
    function quicken(d, pace) {
      var c = d.ctl;
      if (typeof c.last === 'number' && typeof c.speed === 'number') { c.base += (c.last - c.since) / 1000 * c.speed * c.pace; c.since = c.last; }
      c.pace = pace;
    }
    /* The light, wherever the orb is: the broad field round the resting orb, fading before the bar; or, once a
       question is asked, a small pool round the orb beside the bar, fading before the bar's edge. */
    function litField() {
      if (!field || !rest || !paper || !glow) return;
      var a = field.getBoundingClientRect();
      var o = rest.getBoundingClientRect();
      var b = form.getBoundingClientRect();
      var cx = o.left + o.width / 2 - a.left;
      var cy = o.top + o.height / 2 - a.top;
      var side = Math.min(cx, a.width - cx) - 8;
      /* Close round the orb (its canvas holds a margin of half its size, so its radius is a third of the
         canvas): a soft presence the paper holds, never a cloud that fills the page. Wider than it is tall. */
      var orb = o.width / 3;
      var wide = Math.max(48, Math.min(side, orb * 2.6));
      var tall = orb * 2.1;
      var down = Math.min(b.top - a.top - cy - 24, tall);
      if (down < 48) return;
      wash(field, cx, cy, { up: Math.max(48, Math.min(cy - 8, tall)), down: down, back: wide, on: wide }, { depth: 1, fall: 3, paper: paper, glow: glow });
    }
    function litPool() {
      if (!pool || !here || !paper || !glow) return;
      var p = pool.getBoundingClientRect();
      var slot = here.parentNode.getBoundingClientRect();
      var boxEl = form.querySelector('.adv-box');
      var bx = boxEl ? boxEl.getBoundingClientRect() : slot;
      var c = slot.left + slot.width / 2;
      var edge = Math.min(Math.abs(bx.left - c), Math.abs(bx.right - c)) - 4;
      var reach = Math.max(16, Math.min(p.width / 2, edge));
      wash(pool, p.width / 2, p.height / 2, { up: reach, down: reach, back: reach, on: reach }, { depth: 0.6, fall: 2, clear: true, paper: paper, glow: glow });
    }
    var restDraw = 0;
    var hereDraw = 0;
    /* Resting: the page's face while nothing has been asked. Shown only when this script can draw it. */
    var restWrap = rest && rest.parentNode;
    var restBefore = restWrap && restWrap.nextSibling;
    function wake() {
      restDraw = draw(rest, Number(rest.getAttribute('data-orb-pace')) || 1);
      restDraw.done.catch(function () { /* the ground stays */ });
      litField();
      if (field && field.animate && !still()) field.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
    }
    if (rest) wake();
    /* Talking: the orb beside the bar, small and calm, with its pool of light. */
    function settle(pace) {
      if (!here) return;
      if (!hereDraw) { hereDraw = draw(here, pace); hereDraw.done.catch(function () { /* the ground stays */ }); }
      else quicken(hereDraw, pace);
      litPool();
    }
    if (!rest && page && page.getAttribute('data-adv') === 'chat') settle(Number((rest || here || form).getAttribute('data-orb-pace')) || 0.5);
    /* Talking: the page opens at its end, the newest answer's last line above the bar, never under it; and
       again once everything has loaded (type and pictures can lengthen it), unless the owner has scrolled. */
    if (page && page.getAttribute('data-adv') === 'chat' && window.scrollTo) {
      var root = doc.scrollingElement || doc.documentElement;
      var toEnd = function () { window.scrollTo(0, root.scrollHeight); return window.scrollY; };
      var landed = toEnd();
      loaded.then(function () { if (Math.abs(window.scrollY - landed) < 2) toEnd(); });
    }
    var widthWas = window.innerWidth;
    window.addEventListener('resize', function () {
      if (window.innerWidth === widthWas) return;
      widthWas = window.innerWidth;
      if (page && page.getAttribute('data-adv') === 'rest') litField(); else litPool();
    });
    var box = form.querySelector('textarea');
    if (box) box.addEventListener('focus', function () { load().catch(function () { core = 0; }); });
    /* The three questions, one to a line of the form's attribute. */
    var lines = String(form.getAttribute('data-adv-suggest') || '').split('\\n');
    if (rest) typer(box, lines.filter(function (l) { return l !== ''; }));
    if (!tpl || !tpl.content || !line) return;
    /* The orb goes down beside the bar, small, and the light goes with it. Less motion, or no orb to move: it is
       simply there. */
    function glide() {
      var from = rest.getBoundingClientRect();
      var lit = field ? field.getBoundingClientRect() : from;
      var lift = doc.createElement('div');
      lift.className = 'orb-lift';
      lift.style.position = 'fixed';
      lift.style.left = from.left + 'px';
      lift.style.top = from.top + 'px';
      lift.style.zIndex = '3';
      lift.style.pointerEvents = 'none';
      lift.style.transformOrigin = '0 0';
      doc.body.appendChild(lift);
      lift.appendChild(rest);
      page.setAttribute('data-adv', 'chat');
      page.setAttribute('data-gliding', '');
      settle(1);
      var to = here.getBoundingClientRect();
      var k = to.width / (from.width || 1);
      var dx = to.left - from.left;
      var dy = to.top - from.top;
      here.style.visibility = 'hidden';
      var ease = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      /* The bar makes room for the orb as it comes, never at a jump. */
      var slot = here.parentNode;
      var gap = window.getComputedStyle ? String(window.getComputedStyle(form).columnGap || '') : '';
      if (slot && slot.animate && /px$/.test(gap)) {
        slot.animate([{ inlineSize: '0px', marginInlineEnd: '-' + gap }, { inlineSize: slot.getBoundingClientRect().width + 'px', marginInlineEnd: '0px' }], { duration: 560, easing: ease });
      }
      var fly = lift.animate([{ transform: 'translate(0, 0) scale(1)' }, { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + k + ')' }], { duration: 560, easing: ease });
      /* The field gathers into the orb as it goes — smaller with it, and fainter — so it never lies behind the bar. */
      if (field) {
        field.style.transformOrigin = (from.left + from.width / 2 - lit.left) + 'px ' + (from.top + from.height / 2 - lit.top) + 'px';
        field.animate([{ opacity: 1, transform: 'translate(0, 0) scale(1)' }, { opacity: 0.3, offset: 0.45 },
          { opacity: 0, transform: 'translate(' + (dx + (to.width - from.width) / 2) + 'px, ' + (dy + (to.height - from.height) / 2) + 'px) scale(' + k + ')' }], { duration: 560, easing: ease, fill: 'forwards' });
      }
      if (pool) pool.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 360, easing: ease, fill: 'backwards' });
      fly.onfinish = function () { here.style.visibility = ''; page.removeAttribute('data-gliding'); if (lift.parentNode) lift.parentNode.removeChild(lift); };
    }
    /* Thinking: once the question is on its way. */
    doc.addEventListener('submit', function (e) {
      if (e.target !== form || e.defaultPrevented || shown.length) return;
      var asked = box ? String(box.value).trim() : '';
      if (!asked) return;
      var piece = tpl.content.cloneNode(true);
      var said = piece.querySelector('[data-orb-asked]');
      var wait = piece.querySelector('[data-orb-wait]');
      if (!said || !wait) return;
      said.textContent = asked;
      shown = [].slice.call(piece.childNodes);
      line.appendChild(piece);
      if (rest && page && page.getAttribute('data-adv') === 'rest') {
        if (still() || failed || !rest.animate || !here) {
          if (rest.parentNode) rest.parentNode.removeChild(rest);
          if (page) page.setAttribute('data-adv', 'chat');
          if (field) field.style.opacity = '0';
          settle(1);
        } else glide();
      } else settle(1);
      if (wait.scrollIntoView) wait.scrollIntoView({ block: 'nearest' });
    });
    /* Back from history: the question never went, so the page is as it was, resting orb and all. */
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted || !shown.length) return;
      for (var i = 0; i < shown.length; i++) if (shown[i].parentNode) shown[i].parentNode.removeChild(shown[i]);
      shown = [];
      if (rest && restWrap) {
        var lift = doc.querySelector('.orb-lift');
        if (lift && lift.parentNode) lift.parentNode.removeChild(lift);
        if (restBefore && restBefore.parentNode === restWrap) restWrap.insertBefore(rest, restBefore); else restWrap.appendChild(rest);
        if (page) page.setAttribute('data-adv', 'rest');
        if (field) { field.style.opacity = ''; if (field.getAnimations) field.getAnimations().forEach(function (a) { a.cancel(); }); }
        wake();
      }
    });
  }

  /* A customer's photo that does not arrive leaves their initial, never a hole. */
  function faces() {
    doc.addEventListener('error', function (e) {
      var img = e.target;
      if (img && img.tagName === 'IMG' && /(^| )face-p( |$)/.test(String(img.className)) && img.parentNode) img.parentNode.removeChild(img);
    }, true);
  }

  toToday();
  keepWords();
  phone();
  asking();
  sending();
  orbs();
  cards();
  faces();
  begin();
  startRail();
  window.addEventListener('pagehide', keepNow);
  window.addEventListener('load', function () {
    try { if (history.scrollRestoration === 'manual') history.scrollRestoration = 'auto'; } catch (e) { /* the browser keeps its own */ }
  });
})();
`;
