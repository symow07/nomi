/**
 * Phase 1 (the owner's roadmap, 2026-10-13) — THROWAWAY MAILBOXES: services that hand anyone a fresh address for
 * minutes or days, with no account. An address there says nothing about a business, and it is the easiest way to
 * take a second free trial. Bundled, so the check asks no outside service. A sign-up from one is not refused: it
 * counts towards the score (core/owner/signupRisk.ts), and alone it asks for a card.
 *
 * A subdomain of a listed domain counts as the domain (`x.mailinator.com`).
 */
export const THROWAWAY_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com', '10minutemail.net', '10minmail.com', '20minutemail.com', '33mail.com',
  'anonbox.net', 'anonymbox.com', 'armyspy.com', 'binkmail.com', 'bobmail.info', 'burnermail.io',
  'byom.de', 'chammy.info', 'cuvox.de', 'dayrep.com', 'deadaddress.com', 'despam.it', 'discard.email',
  'discardmail.com', 'discardmail.de', 'dispostable.com', 'dodgit.com', 'dropmail.me', 'einrot.com',
  'emailondeck.com', 'emailfake.com', 'emailtemporanea.com', 'emailtemporanea.net', 'emltmp.com',
  'fakeinbox.com', 'fakemail.net', 'fleckens.hu', 'getairmail.com', 'getnada.com', 'gishpuppy.com',
  'grr.la', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'gustr.com', 'harakirimail.com',
  'incognitomail.com', 'incognitomail.org', 'inboxbear.com', 'inboxkitten.com', 'jetable.org',
  'jourrapide.com', 'kasmail.com', 'kurzepost.de', 'letthemeatspam.com', 'mail-temp.com', 'mail.tm',
  'mailcatch.com', 'maildrop.cc', 'mailforspam.com', 'mailinator.com', 'mailinator.net', 'mailinator2.com',
  'mailnesia.com', 'mailnull.com', 'mailpoof.com', 'mailsac.com', 'mailtemp.net', 'meltmail.com',
  'mintemail.com', 'moakt.com', 'moakt.cc', 'mohmal.com', 'mt2015.com', 'mytemp.email', 'mytrashmail.com',
  'nada.email', 'nospam.ze.tc', 'nowmymail.com', 'objectmail.com', 'onewaymail.com', 'owlymail.com',
  'pokemail.net', 'rcpt.at', 'rhyta.com', 'rmqkr.net', 'sharklasers.com', 'shitmail.me', 'sogetthis.com',
  'spam4.me', 'spambog.com', 'spambox.us', 'spamgourmet.com', 'spamherelots.com', 'spamex.com',
  'spaml.de', 'spammotel.com', 'superrito.com', 'suremail.info', 'teleworm.us', 'temp-mail.io',
  'temp-mail.org', 'temp-mail.ru', 'tempail.com', 'tempemail.net', 'tempinbox.com', 'tempmail.com',
  'tempmail.net', 'tempmail.plus', 'tempmailo.com', 'tempmailaddress.com', 'tempr.email', 'tempsky.com',
  'thankyou2010.com', 'throwam.com', 'throwawaymail.com', 'tmail.ws', 'tmailinator.com', 'tmpmail.net',
  'tmpmail.org', 'trash-mail.com', 'trashmail.com', 'trashmail.de', 'trashmail.io', 'trashmail.me',
  'trashmail.net', 'trbvm.com', 'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org', 'yopmail.com',
  'yopmail.fr', 'yopmail.net', 'zetmail.com', '1secmail.com', '1secmail.net', '1secmail.org',
  'mailto.plus', 'fexpost.com', 'fexbox.org', 'rover.info', 'chitthi.in', 'mailbox.in.ua',
]);
