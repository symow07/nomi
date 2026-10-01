/**
 * D5 — which notices are refusals, decided once, for the whole product.
 *
 * Every notice after a POST was painted in the jade of a success: "Only the
 * owner can do that", "That number does not look right" and "Sent" all arrived
 * in the same green banner. At a glance there was nothing to tell a thing that
 * happened from a thing that did not.
 *
 * SO THE DECISION LIVES HERE, NOT AT THE CALL SITE. Sixty-nine routes end in a
 * notice, and several pick their key from a result code at run time; a tone
 * chosen route by route would be right in most places and quietly wrong in the
 * rest. The tone belongs to the SENTENCE, so it is a property of the key.
 *
 * A REFUSAL is: what she asked for did not happen. Not "it happened and there
 * is a caveat" — `prices.flash.unchanged` ("No change — those were already
 * your answers") is not a refusal, and neither is a partial import that asks
 * her for a price. But "Saved. Messaging is not switched on yet, so nothing
 * went to the buyer" IS one, because the part she cared about did not happen.
 *
 * EVERY FLASH KEY IS IN EXACTLY ONE OF THESE LISTS, and a test holds that
 * true — so a new sentence cannot ship without someone deciding how it looks.
 */

import type { MessageKey } from './i18n/messages.js';

/** What she asked for did not happen. Drawn in the warning tone, announced as an alert. */
export const FLASH_REFUSALS: ReadonlySet<string> = new Set<MessageKey>([
  // HS — saved with no line ticked: nothing was written.
  'hs.flash.noneTicked',
  // G5b — a phone that could not be added, or a test no phone received.
  'alerts.flash.bad', 'alerts.flash.testNone',
  'account.flash.failed', 'account.flash.short', 'account.flash.wrong', 'allowlist.flash.invalid',
  // 0080 — the order still waits, or was already decided; and like
  // `inbox.flash.sentNotLive`, recorded but nothing sent.
  'order.flash.not_found', 'order.flash.already_decided', 'order.flash.incomplete',
  'order.flash.assistant_stopped', 'order.flash.assistant_silenced', 'order.flash.confirmedNotLive',
  // G3 — the day's allowance is used: the order still waits.
  'order.flash.allowance_used', 'order.flash.billing_lapsed',
  'data.export.flash.tooMany', 'data.flash.already_open', 'data.flash.failed',
  'data.flash.name_wrong', 'data.flash.not_open',
  // CC-02a — a buyer's deletion request that was not recorded.
  'conv.deletion.flash.already_open', 'conv.deletion.flash.note_missing', 'conv.deletion.flash.note_long',
  // 0076 — a noted request that was already decided: nothing changed.
  'conv.deletion.flash.not_waiting',
  // P5 — a practice message Practice would not take: the day's are used, or the operator paused it.
  'practice.flash.daily_limit', 'practice.flash.switched_off',
  // TZ — a zone this build does not know: nothing changed.
  'settings.flash.zoneInvalid',
  // CUR — a currency not on the list, or one fixed by prices already set: nothing changed.
  'settings.flash.currencyInvalid', 'settings.flash.currencyFixed',
  'assistants.flash.channel_taken', 'assistants.flash.is_default', 'assistants.flash.name_long',
  'assistants.flash.name_missing', 'channel.flash.already_connected', 'channel.flash.failed',
  'channel.flash.no_credential', 'channel.flash.not_configured', 'channel.flash.nothing_to_connect',
  'channel.flash.number_taken', 'channel.flash.test_not_connected', 'closures.flash.ends_before_starts',
  'calendar.flash.title', 'calendar.flash.day', 'calendar.flash.time', 'calendar.flash.order', 'calendar.flash.notFound',
  'closures.flash.failed', 'closures.flash.from_missing', 'closures.flash.label_missing',
  'closures.flash.not_a_date', 'closures.flash.to_missing', 'connect.flash.app_refused',
  'connect.flash.denied', 'connect.flash.expired', 'connect.flash.missing_scope',
  'connect.flash.no_address', 'connect.flash.no_refresh_token', 'connect.flash.not_configured',
  // G7 — the operator stopped new connections.
  'connect.flash.paused',
  // EXT — the closer reading found nothing more, could not run, or the allowance is used.
  'pageFacts.flash.noneTicked',
  'import.flash.extractNone', 'import.flash.extractFailed', 'import.flash.extractAllowance',
  // BILL — no card yet; the plan's seats or assistants used; Billing refused or unreachable.
  'connect.flash.card', 'people.flash.seat_limit', 'assistants.flash.assistant_limit',
  'billing.flash.notConfigured', 'billing.flash.failed', 'billing.flash.noPlan', 'billing.flash.notBilled',
  // KS6 — the first connection waits for the operator; an address that is not one; an ask that did not go.
  'connect.flash.approval', 'approval.flash.bad_page', 'approval.flash.failed',
  'connect.flash.rejected', 'connect.flash.unavailable', 'connect.meta.flash.no_pages',
  'connect.meta.flash.page_taken', 'connect.meta.flash.subscribe_failed', 'connect.meta.flash.unavailable',
  // WA — the own number did not connect, or WhatsApp is not live to open.
  'connect.wa.flash.no_account', 'connect.wa.flash.no_number', 'connect.wa.flash.number_taken',
  'connect.wa.flash.refused', 'connect.wa.flash.unavailable', 'pilot.flash.not_active',
  'channel.wa.template.flash.unavailable', 'channel.wa.template.flash.nothing',
  'contacts.flash.empty', 'contacts.flash.failed', 'contacts.flash.missing', 'contacts.flash.no_channel',
  'contacts.flash.notLive', 'contacts.flash.not_a_phone', 'contacts.flash.not_an_email',
  'contacts.lookup.flash.not_an_email', 'contacts.lookup.flash.not_found',
  'contacts.lookup.flash.personal', 'conv.assistant.flash.same', 'conv.flash.nameInvalid',
  'domain.flash.failed', 'domain.flash.invalid', 'employee.flash.confirm_order_blocked',
  'employee.flash.failed', 'forbidden.flash.duplicate', 'forbidden.flash.empty', 'forbidden.flash.failed',
  'inbox.flash.already_resolved', 'inbox.flash.not_found', 'inbox.flash.sentNotLive',
  'inbox.flash.unknown', 'inbox.flash.empty', 'knowledge.flash.invalid', 'order.flash.failed', 'order.flash.unknown_state',
  'outreach.flash.failed', 'people.flash.failed', 'people.flash.name_missing',
  // Not a failure of hers — the product is not ready to offer it yet. Still
  // a refusal in tone: she asked for something and did not get it.
  'autonomy.flash.notReleased',
  // G4 — a workspace that signed itself up has not earned sending alone yet.
  'autonomy.flash.notEarned',
  'people.flash.name_too_long', 'product.flash.refused', 'proof.owner.flash.failed',
  'prospects.flash.exists', 'prospects.flash.failed', 'prospects.flash.invalid',
  'prospects.flash.not_found', 'rate.flash.failed', 'rate.flash.missing', 'rate.flash.not_a_number',
  'rate.flash.not_positive', 'rate.flash.same_currency',
  // CUR — the workspace sells in its country's own currency: nothing to convert.
  'rate.flash.none', 'reach.inbound.flash.already',
  'reach.inbound.flash.notConfigured', 'reach.inbound.flash.taken', 'samples.flash.failed',
  'samples.flash.negative', 'samples.flash.not_a_number', 'samples.flash.price_missing',
  'seq.flash.already', 'seq.flash.changed', 'seq.flash.empty', 'seq.flash.failed', 'seq.flash.full',
  'seq.flash.invalid', 'seq.flash.notApproved', 'seq.flash.notDraft', 'seq.flash.notLive',
  'seq.flash.notWaiting', 'settings.flash.invalid', 'settings.flash.profileFix',
  'settings.flash.profileInvalid', 'spotcheck.flash.gone', 'takeover.flash.ai_owned',
  'takeover.flash.empty', 'takeover.flash.invalid_state', 'takeover.flash.must_take_over',
  'takeover.flash.no_channel', 'takeover.flash.not_found', 'takeover.flash.unknown_person',
  // 0070 — stopped on every channel: the owner asked for something Stop refuses.
  'takeover.flash.assistant_stopped', 'inbox.flash.assistant_stopped',
  'takeover.flash.assistant_silenced', 'inbox.flash.assistant_silenced',
  // G3 — the day's allowance is used: refused the same way.
  'takeover.flash.allowance_used', 'inbox.flash.allowance_used',
  // BILL — the payment lapsed: the same refusals, under their own name.
  'takeover.flash.billing_lapsed', 'inbox.flash.billing_lapsed',
  // G10 — a translation that did not happen.
  'inbox.flash.translate.gone', 'inbox.flash.translate.unavailable', 'inbox.flash.translate.allowance', 'inbox.flash.translate.failed',
  'terms.flash.failed', 'terms.flash.incoterm_invalid', 'terms.flash.payment_missing',
  'terms.flash.payment_too_long', 'unsure.flash.gone',
]);

/** It happened. The jade banner, announced as a passing status. */
export const FLASH_CONFIRMATIONS: ReadonlySet<string> = new Set<MessageKey>([
  // EXT — lines read more closely.
  'import.flash.extracted',
  'pageFacts.flash.written',
  // BILL — a plan saved.
  'billing.flash.plan',
  // KS6 — asked; asked before; or nothing to ask.
  'approval.flash.asked', 'approval.flash.already', 'approval.flash.not_needed',
  // R2 — a conversation marked as the owner testing, or as a real customer again.
  'conv.testing.flash.on', 'conv.testing.flash.off',
  // 0082 — a date of the owner's own, put on the calendar or taken off it.
  'calendar.flash.added', 'calendar.flash.removed',
  'order.flash.confirmed', 'order.flash.set_aside',
  'account.flash.changed', 'activation.flash.activated', 'activation.flash.deactivated',
  'allowlist.flash.added', 'allowlist.flash.removed', 'assistants.flash.added',
  'assistants.flash.archived', 'assistants.flash.saved', 'autonomy.flash.saved', 'channel.flash.connected',
  'channel.flash.disconnected', 'channel.flash.reconnected', 'channel.flash.test_degraded',
  'channel.flash.test_ok', 'closures.flash.added', 'closures.flash.removed', 'connect.flash.connected',
  'connect.flash.disconnected', 'connect.meta.flash.connected', 'connect.meta.flash.connectedNoIg',
  'connect.meta.flash.disconnected', 'contacts.flash.added', 'contacts.flash.archived',
  // WA — the own number connected or let go; pilot mode ended or back.
  'connect.wa.flash.connected', 'connect.wa.flash.connectedNamePending', 'connect.wa.flash.disconnected',
  'pilot.flash.ended', 'pilot.flash.resumed',
  // WA-S — asked of Meta, Meta's answers read, a reply reopening the window.
  'channel.wa.template.flash.submitted', 'channel.wa.template.flash.checked', 'inbox.flash.reopening',
  'data.flash.asked', 'data.flash.withdrawn',
  'conv.deletion.flash.asked',
  // 0076 — a noted request recorded, or set aside as not one: both happened.
  'conv.deletion.flash.recordedAsk', 'conv.deletion.flash.dismissed',
  'contacts.flash.attested', 'contacts.flash.queued', 'contacts.flash.suppressed',
  'contacts.lookup.flash.found', 'contacts.lookup.flash.reused', 'conv.assistant.flash.changed',
  'conv.flash.nameCleared', 'conv.flash.nameSaved', 'domain.flash.checked', 'domain.flash.saved',
  'employee.flash.promoted', 'employee.flash.revoked', 'forbidden.flash.added', 'forbidden.flash.removed',
  'inbox.flash.edited_sent', 'inbox.flash.revoked', 'inbox.flash.sent', 'inbox.flash.skipped',
  'knowledge.flash.archived', 'knowledge.flash.cert', 'knowledge.flash.corrected',
  'knowledge.flash.taught', 'order.flash.recorded', 'outreach.flash.cap', 'outreach.flash.off',
  'outreach.flash.on', 'people.flash.added', 'people.flash.removed', 'people.flash.renamed', 'pilot.flash.attested',
  'pilot.flash.validated', 'prices.flash.saved', 'prices.flash.savedActivated',
  'prices.flash.savedAndLive', 'prices.flash.unchanged', 'prices.flash.volumeAdded',
  'prices.flash.volumeRemoved', 'product.edit.flash.saved', 'product.edit.flash.unchanged',
  'product.flash.addedNeedPrice', 'product.flash.addedNeedRules', 'product.flash.addedReady',
  // K1/K2 — a list's floors written with it; a list set aside, as she asked.
  'import.flash.floorsSet', 'import.flash.dropped',
  // K5 — prices go to the owner, or back to the list: both what she asked.
  'product.pricesToMe.flash.on', 'product.pricesToMe.flash.off',
  // HS — an answer's ticked lines saved, or the question left for later.
  'hs.flash.saved', 'hs.flash.skipped',
  // G5b — alerts turned on, stopped, or a test sent.
  'alerts.flash.on', 'alerts.flash.removed', 'alerts.flash.tested',
  'product.flash.alreadyHere', 'product.flash.updated', 'proof.owner.flash.issued',
  'proof.owner.flash.revoked', 'prospects.flash.added', 'prospects.flash.removed', 'prospects.flash.saved',
  'rate.flash.set', 'reach.inbound.flash.connected', 'samples.flash.address', 'samples.flash.done',
  'samples.flash.saved', 'seq.flash.added', 'seq.flash.approved', 'seq.flash.archived',
  'seq.flash.confirmed', 'seq.flash.created', 'seq.flash.enrolled', 'seq.flash.saved', 'seq.flash.stopped',
  'settings.flash.cleared', 'settings.flash.profileSaved', 'settings.flash.saved', 'spotcheck.flash.fixed',
  // 0070 — the owner's own Stop and Start, and a second press of either.
  'assistant.stop.flash.stopped', 'assistant.stop.flash.started',
  'assistant.stop.flash.already', 'assistant.stop.flash.alreadyStarted',
  'spotcheck.flash.ok', 'spotcheck.flash.problem', 'takeover.flash.handed', 'takeover.flash.resumed',
  'takeover.flash.sent', 'takeover.flash.taken_over', 'terms.flash.saved', 'unsure.flash.again',
  'unsure.flash.left', 'voice.flash.answering', 'voice.flash.corrected',
  // Practice cleared, the old one archived: it happened. Outside the `.flash.`
  // family, so it went unclassified and was painted as a refusal — unseen at
  // the bottom of the page until CC-25 landed the owner on it after Reset.
  'sandbox.reset.done',
  // P3 — the practice message is on its way; the reply comes by the live line.
  'practice.sent',
  // P4 — Practice's two switches, done.
  'practice.flash.alone', 'practice.flash.levels', 'practice.flash.stopped', 'practice.flash.started',
  // TZ — the workspace's zone, saved.
  'settings.flash.zoneSaved',
  // CUR — the workspace's currency, saved.
  'settings.flash.currencySaved',
]);

/**
 * How a notice looks.
 *
 * A key in NEITHER list is drawn as a refusal, and that default is the whole
 * reason both lists are written out. Sentences reach this from outside the
 * `*.flash.*` family — `staff.notAllowed`, `activation.blocker.*`,
 * `refused.why.*`, `prospects.failure.*` — and every one of those is a refusal.
 * A new one that nobody classified is far likelier to be a refusal too, and the
 * cost of guessing wrong this way is a confirmation that looks stern, rather
 * than a refusal that looks like success. That is the trade D5 exists to make.
 */
export const flashTone = (key: MessageKey): 'ok' | 'bad' =>
  FLASH_REFUSALS.has(key) ? 'bad' : FLASH_CONFIRMATIONS.has(key) ? 'ok' : 'bad';
