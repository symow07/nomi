/** Progressive panel enhancement; the conversation and its forms are never replaced. */
export const COPILOT_SCRIPT = String.raw`
(function () {
  var doc = document;
  var root = doc.querySelector('[data-conversation]');
  if (!root || !window.fetch) return;
  var tools = root.querySelector('[data-conversation-tools]');
  if (!tools) return;
  var cid = root.getAttribute('data-conversation');
  var slot = tools.querySelector('[data-copilot-slot]');
  var status = tools.querySelector('[data-tool-status]');
  var recovery = tools.querySelector('[data-tool-recovery]'), retryRequest = null;
  var opener = null, viewScroll = null, readingScroll = [], loaded = false, pending = 0, useGeneration = 0, using = false;
  /* On a phone the page's own region scrolls, not the window: the reading place is kept there too. */
  var region = doc.querySelector('.content');
  var home = location.pathname + location.search + location.hash;
  function say(key) {
    status.textContent = key ? status.getAttribute('data-' + key) || '' : '';
    if (recovery) recovery.hidden = key !== 'failed';
  }
  function invalidateUse() {
    ++useGeneration;
    /* A newer panel request owns its own status until it settles. */
    if (using && !slot.hasAttribute('aria-busy')) say('');
  }
  function composer() {
    return root.querySelector('textarea[data-keep="' + cid + ':edit"]') || root.querySelector('textarea[data-keep="' + cid + ':reply"]');
  }
  function draftOf(box) {
    var f = box && box.form, d = f && f.querySelector('input[name="draftId"]');
    return d ? d.value : '';
  }
  function focus(el) { if (el) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } } }
  function expose() {
    slot.querySelectorAll('[data-use-reply]').forEach(function (button) { button.hidden = false; });
  }
  function setTab(which) {
    if (root.getAttribute('data-tool-open') !== which) invalidateUse();
    root.setAttribute('data-tool-open', which);
    tools.querySelectorAll('[data-tool-content]').forEach(function (el) { el.hidden = el.getAttribute('data-tool-content') !== which; });
    tools.querySelectorAll('[data-tool-tab]').forEach(function (el) {
      if (el.getAttribute('data-tool-tab') === which) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    root.querySelectorAll('[data-open-tool]').forEach(function (el) { el.setAttribute('aria-expanded', String(el.getAttribute('data-open-tool') === which)); });
  }
  function restorePlace(restore) {
    /* Settle the restored pane and pending fragment layout before applying its saved scroll. */
    if (viewScroll) root.getBoundingClientRect();
    if (viewScroll && window.scrollTo) window.scrollTo(viewScroll[0], viewScroll[1]);
    if (viewScroll && region) region.scrollTop = viewScroll[2];
    readingScroll.forEach(function (saved) { saved[0].scrollTop = saved[1]; saved[0].scrollLeft = saved[2]; });
    if (restore !== false) focus(opener);
  }
  function close(restore) {
    invalidateUse();
    root.removeAttribute('data-tool-open');
    root.style.removeProperty('--conversation-acts-height');
    root.querySelectorAll('[data-open-tool]').forEach(function (el) { el.setAttribute('aria-expanded', 'false'); });
    restorePlace(restore);
  }
  function open(which, link, remember) {
    var already = root.hasAttribute('data-tool-open'), draftTop = null;
    if (!already && remember !== false) {
      opener = link;
      viewScroll = [window.scrollX, window.scrollY, region ? region.scrollTop : 0];
      readingScroll = Array.from(root.querySelectorAll('.conv-thread, .conv-acts, .listpane')).map(function (el) { return [el, el.scrollTop, el.scrollLeft]; });
      home = location.pathname + location.search + location.hash;
      /* F13: keep the decision's existing height while its width changes. Extra wrapped context scrolls inside
         that same region, so opening the neighbouring pane does not lift the owner's unsent draft. */
      var acts = root.querySelector('.conv-acts');
      if (acts && window.matchMedia && window.matchMedia('(min-width:1300px)').matches) {
        root.style.setProperty('--conversation-acts-height', acts.getBoundingClientRect().height + 'px');
        var box = composer();
        if (box) draftTop = box.getBoundingClientRect().top;
      }
    }
    setTab(which);
    /* A translated attribution can gain a line at the narrower width. Keep the same draft edge inside the
       held region; its contextual lines remain reachable just above it, and close restores the original scroll. */
    if (draftTop !== null && acts && box) acts.scrollTop += box.getBoundingClientRect().top - draftTop;
    if (window.matchMedia && window.matchMedia('(max-width:1099px)').matches && window.scrollTo) { window.scrollTo(0, 0); if (region) region.scrollTop = 0; }
    if (remember !== false) {
      try { history[already ? 'replaceState' : 'pushState']({ nomiTool: which }, '', '#nomi-' + which); } catch (_) {}
    }
    if (which === 'ask' && !loaded) loadPanel(tools.getAttribute('data-copilot-url'), null);
    else focus(tools.querySelector(which === 'ask' ? '#copilot-title' : '[data-close-tool]'));
  }
  function loadPanel(url, body) {
    retryRequest = [url, body];
    invalidateUse();
    var turn = ++pending;
    say(body ? 'busy' : 'loading');
    slot.setAttribute('aria-busy', 'true');
    var target = new URL(url, location.href);
    target.searchParams.set('fragment', '1');
    return fetch(target.pathname + target.search, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html' } : { 'Accept': 'text/html' },
      ...(body ? { body: body.toString() } : {})
    }).then(function (r) {
      if (!r.ok) throw new Error('unavailable');
      return r.text();
    }).then(function (html) {
      if (turn !== pending) return;
      var page = new DOMParser().parseFromString(html, 'text/html');
      var panel = page.querySelector('[data-copilot-panel]');
      if (!panel || panel.getAttribute('data-conversation-id') !== cid) throw new Error('unavailable');
      slot.replaceChildren(doc.importNode(panel, true));
      loaded = true; expose(); say('');
      if (root.getAttribute('data-tool-open') === 'ask') focus(slot.querySelector('#copilot-title'));
    }).catch(function () { if (turn === pending) say('failed'); })
      .finally(function () { if (turn === pending) slot.removeAttribute('aria-busy'); });
  }
  function bodyOf(form, submitter) {
    var data = new URLSearchParams(new FormData(form));
    if (submitter && submitter.name) data.set(submitter.name, submitter.value);
    return data;
  }
  doc.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-open-tool], [data-tool-tab], [data-close-tool], [data-retry-tool]') : null;
    if (!a || !root.contains(a) || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (a.hasAttribute('data-retry-tool')) {
      if (retryRequest) loadPanel(retryRequest[0], retryRequest[1]);
      return;
    }
    if (a.hasAttribute('data-close-tool')) {
      close(); try { history.replaceState(null, '', home); } catch (_) {} return;
    }
    open(a.getAttribute('data-open-tool') || a.getAttribute('data-tool-tab'), a);
  });
  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented || !root.hasAttribute('data-tool-open') || doc.querySelector('dialog[open]')) return;
    e.preventDefault(); close(); try { history.replaceState(null, '', home); } catch (_) {}
  });
  window.addEventListener('popstate', function (e) {
    if (e.state && (e.state.nomiTool === 'ask' || e.state.nomiTool === 'customer')) open(e.state.nomiTool, null, false);
    else {
      close(false);
      /* B2-V02: the browser restores #latest AFTER popstate, including its own focus/scroll reset.
         Restore in the next event-loop turn, once that native history traversal is complete. */
      setTimeout(function () { if (!root.hasAttribute('data-tool-open')) restorePlace(); }, 0);
    }
  });
  doc.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !tools.contains(form) || e.defaultPrevented) return;
    if (form.hasAttribute('data-copilot-ask')) {
      e.preventDefault(); loadPanel(form.action, bodyOf(form, e.submitter)); return;
    }
    if (!form.hasAttribute('data-copilot-use')) return;
    e.preventDefault();
    if (using) return;
    var box = composer(), draft = draftOf(box), useTurn = useGeneration;
    if (!box) { say('no-composer'); return; }
    using = true; say('busy');
    fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: bodyOf(form).toString() })
      .then(function (r) { return r.json(); })
      .then(function (answer) {
        if (useTurn !== useGeneration || !form.isConnected || !tools.contains(form)) return;
        if (!answer.ok) { say(answer.reason === 'stale' ? 'stale' : 'failed'); return; }
        if (!box.isConnected || composer() !== box || draftOf(box) !== draft || (draft ? answer.draftId !== draft : answer.draftId !== null || answer.assignedTo !== box.getAttribute('data-copilot-holder')) || typeof answer.text !== 'string' || !answer.text.trim()) { say('stale'); return; }
        /* Read the box NOW, including anything typed while validation was pending. */
        box.value = box.value + (box.value && !box.value.endsWith('\n\n') ? '\n\n' : '') + answer.text;
        box.setSelectionRange(box.value.length, box.value.length);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        close(false); try { history.replaceState(null, '', home); } catch (_) {}
        focus(box); say('used');
      }).catch(function () { if (useTurn === useGeneration && form.isConnected && tools.contains(form)) say('failed'); })
      .finally(function () { using = false; });
  });
  expose();
  if (location.hash === '#customer' || location.hash === '#nomi-customer' || location.hash === '#nomi-ask') {
    home = location.pathname + location.search + '#latest';
    var initial = location.hash === '#nomi-ask' ? 'ask' : 'customer';
    opener = root.querySelector('[data-open-tool="' + initial + '"]');
    open(initial, opener, false);
  }
})();
`;
