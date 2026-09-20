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
  'account.flash.failed', 'account.flash.short', 'account.flash.wrong', 'allowlist.flash.invalid',
  'data.export.flash.tooMany', 'data.flash.already_open', 'data.flash.failed',
  'data.flash.name_wrong', 'data.flash.not_open',
  'assistants.flash.channel_taken', 'assistants.flash.is_default', 'assistants.flash.name_long',
  'assistants.flash.name_missing', 'channel.flash.already_connected', 'channel.flash.failed',
  'channel.flash.no_credential', 'channel.flash.not_configured', 'channel.flash.nothing_to_connect',
  'channel.flash.number_taken', 'channel.flash.test_not_connected', 'closures.flash.ends_before_starts',
  'closures.flash.failed', 'closures.flash.from_missing', 'closures.flash.label_missing',
  'closures.flash.not_a_date', 'closures.flash.to_missing', 'connect.flash.app_refused',
  'connect.flash.denied', 'connect.flash.expired', 'connect.flash.missing_scope',
  'connect.flash.no_address', 'connect.flash.no_refresh_token', 'connect.flash.not_configured',
  'connect.flash.rejected', 'connect.flash.unavailable', 'connect.meta.flash.no_pages',
  'connect.meta.flash.page_taken', 'connect.meta.flash.subscribe_failed', 'connect.meta.flash.unavailable',
  'contacts.flash.empty', 'contacts.flash.failed', 'contacts.flash.missing', 'contacts.flash.no_channel',
  'contacts.flash.notLive', 'contacts.flash.not_a_phone', 'contacts.flash.not_an_email',
  'contacts.lookup.flash.not_an_email', 'contacts.lookup.flash.not_found',
  'contacts.lookup.flash.personal', 'conv.assistant.flash.same', 'conv.flash.nameInvalid',
  'domain.flash.failed', 'domain.flash.invalid', 'employee.flash.confirm_order_blocked',
  'employee.flash.failed', 'forbidden.flash.duplicate', 'forbidden.flash.empty', 'forbidden.flash.failed',
  'inbox.flash.already_resolved', 'inbox.flash.not_found', 'inbox.flash.sentNotLive',
  'inbox.flash.unknown', 'knowledge.flash.invalid', 'order.flash.failed', 'order.flash.unknown_state',
  'outreach.flash.failed', 'people.flash.failed', 'people.flash.name_missing',
  'people.flash.name_too_long', 'product.flash.refused', 'proof.owner.flash.failed',
  'prospects.flash.exists', 'prospects.flash.failed', 'prospects.flash.invalid',
  'prospects.flash.not_found', 'rate.flash.failed', 'rate.flash.missing', 'rate.flash.not_a_number',
  'rate.flash.not_positive', 'rate.flash.same_currency', 'reach.inbound.flash.already',
  'reach.inbound.flash.notConfigured', 'reach.inbound.flash.taken', 'samples.flash.failed',
  'samples.flash.negative', 'samples.flash.not_a_number', 'samples.flash.price_missing',
  'seq.flash.already', 'seq.flash.changed', 'seq.flash.empty', 'seq.flash.failed', 'seq.flash.full',
  'seq.flash.invalid', 'seq.flash.notApproved', 'seq.flash.notDraft', 'seq.flash.notLive',
  'seq.flash.notWaiting', 'settings.flash.invalid', 'settings.flash.profileFix',
  'settings.flash.profileInvalid', 'spotcheck.flash.gone', 'takeover.flash.ai_owned',
  'takeover.flash.empty', 'takeover.flash.invalid_state', 'takeover.flash.must_take_over',
  'takeover.flash.no_channel', 'takeover.flash.not_found', 'takeover.flash.unknown_person',
  'terms.flash.failed', 'terms.flash.incoterm_invalid', 'terms.flash.payment_missing',
  'terms.flash.payment_too_long', 'unsure.flash.gone',
]);

/** It happened. The jade banner, announced as a passing status. */
export const FLASH_CONFIRMATIONS: ReadonlySet<string> = new Set<MessageKey>([
  'account.flash.changed', 'activation.flash.activated', 'activation.flash.deactivated',
  'allowlist.flash.added', 'allowlist.flash.removed', 'assistants.flash.added',
  'assistants.flash.archived', 'assistants.flash.saved', 'autonomy.flash.saved', 'channel.flash.connected',
  'channel.flash.disconnected', 'channel.flash.reconnected', 'channel.flash.test_degraded',
  'channel.flash.test_ok', 'closures.flash.added', 'closures.flash.removed', 'connect.flash.connected',
  'connect.flash.disconnected', 'connect.meta.flash.connected', 'connect.meta.flash.connectedNoIg',
  'connect.meta.flash.disconnected', 'contacts.flash.added', 'contacts.flash.archived',
  'data.flash.asked', 'data.flash.withdrawn',
  'contacts.flash.attested', 'contacts.flash.queued', 'contacts.flash.suppressed',
  'contacts.lookup.flash.found', 'contacts.lookup.flash.reused', 'conv.assistant.flash.changed',
  'conv.flash.nameCleared', 'conv.flash.nameSaved', 'domain.flash.checked', 'domain.flash.saved',
  'employee.flash.promoted', 'employee.flash.revoked', 'forbidden.flash.added', 'forbidden.flash.removed',
  'inbox.flash.edited_sent', 'inbox.flash.revoked', 'inbox.flash.sent', 'inbox.flash.skipped',
  'knowledge.flash.archived', 'knowledge.flash.cert', 'knowledge.flash.corrected',
  'knowledge.flash.taught', 'order.flash.recorded', 'outreach.flash.cap', 'outreach.flash.off',
  'outreach.flash.on', 'people.flash.added', 'people.flash.removed', 'pilot.flash.attested',
  'pilot.flash.validated', 'prices.flash.saved', 'prices.flash.savedActivated',
  'prices.flash.savedAndLive', 'prices.flash.unchanged', 'prices.flash.volumeAdded',
  'prices.flash.volumeRemoved', 'product.edit.flash.saved', 'product.edit.flash.unchanged',
  'product.flash.addedNeedPrice', 'product.flash.addedNeedRules', 'product.flash.addedReady',
  'product.flash.alreadyHere', 'product.flash.updated', 'proof.owner.flash.issued',
  'proof.owner.flash.revoked', 'prospects.flash.added', 'prospects.flash.removed', 'prospects.flash.saved',
  'rate.flash.set', 'reach.inbound.flash.connected', 'samples.flash.address', 'samples.flash.done',
  'samples.flash.saved', 'seq.flash.added', 'seq.flash.approved', 'seq.flash.archived',
  'seq.flash.confirmed', 'seq.flash.created', 'seq.flash.enrolled', 'seq.flash.saved', 'seq.flash.stopped',
  'settings.flash.cleared', 'settings.flash.profileSaved', 'settings.flash.saved', 'spotcheck.flash.fixed',
  'spotcheck.flash.ok', 'spotcheck.flash.problem', 'takeover.flash.handed', 'takeover.flash.resumed',
  'takeover.flash.sent', 'takeover.flash.taken_over', 'terms.flash.saved', 'unsure.flash.again',
  'unsure.flash.left', 'voice.flash.answering', 'voice.flash.corrected',
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
