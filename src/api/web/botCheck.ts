/**
 * BOT (decision 36; KS1's second half) — A BOT CHECK BEFORE ANY CODE IS SENT.
 *
 * Every sign-up e-mails a code to the address typed, so a script that can post
 * the form can make Nomi mail any address it likes. MAIL's daily caps bound the
 * damage; this keeps scripts from posting at all. The check is a widget the
 * sign-up page draws (the provider's own script) and a token the route sends
 * back to the provider before anything else is spent.
 *
 * Two providers, chosen by the operator (BOT_CHECK_PROVIDER): Cloudflare
 * Turnstile and hCaptcha. Both take the same form-encoded request and answer
 * `{ "success": true|false }`. All three variables or none — a half-set check
 * is no check, and the boot says which part is missing. The secret is pasted
 * into Railway by the owner and travels only in the request's body.
 *
 * Without a check, open sign-up reads as invite (`signupModeInForce`): only a
 * stranger holding the operator's invitation can make Nomi send a code.
 *
 * FAILS CLOSED: a provider that does not answer within five seconds, answers
 * with an error, or answers anything but `success: true` is a refusal. The
 * page says to try again; nothing is sent.
 */
export const BOT_CHECK_PROVIDERS = ['turnstile', 'hcaptcha'] as const;
export type BotCheckProvider = (typeof BOT_CHECK_PROVIDERS)[number];
export type BotCheckConfig = { readonly provider: BotCheckProvider; readonly siteKey: string; readonly secret: string };

/** What the page needs to draw the widget, and the field its token arrives in. */
export const BOT_CHECK_WIDGET: Record<BotCheckProvider, { readonly script: string; readonly className: string; readonly field: string; readonly verifyUrl: string }> = {
  turnstile: {
    script: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
    className: 'cf-turnstile', field: 'cf-turnstile-response',
    verifyUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  },
  hcaptcha: {
    script: 'https://js.hcaptcha.com/1/api.js',
    className: 'h-captcha', field: 'h-captcha-response',
    verifyUrl: 'https://api.hcaptcha.com/siteverify',
  },
};

export function botCheckConfigFrom(env: Record<string, string | undefined>): BotCheckConfig | null {
  const provider = (env['BOT_CHECK_PROVIDER'] ?? '').trim().toLowerCase();
  const siteKey = (env['BOT_CHECK_SITE_KEY'] ?? '').trim();
  const secret = (env['BOT_CHECK_SECRET'] ?? '').trim();
  if (!provider && !siteKey && !secret) return null;
  const missing: string[] = [];
  if (!(BOT_CHECK_PROVIDERS as readonly string[]).includes(provider)) missing.push('BOT_CHECK_PROVIDER (turnstile or hcaptcha)');
  // The site key is printed into the page: only characters that need no escaping.
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(siteKey)) missing.push('BOT_CHECK_SITE_KEY');
  if (secret.length < 8) missing.push('BOT_CHECK_SECRET');
  if (missing.length) {
    console.warn(`Bot check: ${missing.join(', ')} missing or malformed. Without one, open sign-up reads as invite.`);
    return null;
  }
  return { provider: provider as BotCheckProvider, siteKey, secret };
}

export type BotCheck = {
  readonly provider: BotCheckProvider;
  readonly siteKey: string;
  /** True only when the provider said this token is a person's, just now. */
  verify(token: string, callerIp: string): Promise<boolean>;
};

export type BotCheckFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** The provider's request for one token: its address and a form-encoded body. Pure. */
export function botCheckRequest(config: BotCheckConfig, token: string, callerIp: string): { readonly url: string; readonly body: string } {
  const body = new URLSearchParams({ secret: config.secret, response: token });
  // The caller's address helps the provider judge; 'unknown' would only mislead it.
  if (callerIp && callerIp !== 'unknown') body.set('remoteip', callerIp);
  return { url: BOT_CHECK_WIDGET[config.provider].verifyUrl, body: body.toString() };
}

export const BOT_CHECK_TIMEOUT_MS = 5_000;

export function botCheckFrom(config: BotCheckConfig, fetchImpl: BotCheckFetch = fetch as unknown as BotCheckFetch): BotCheck {
  return {
    provider: config.provider,
    siteKey: config.siteKey,
    async verify(token, callerIp) {
      // A token is the provider's own string, never long; an empty one is no answer.
      if (!token || token.length > 4096) return false;
      const req = botCheckRequest(config, token, callerIp);
      try {
        const res = await fetchImpl(req.url, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: req.body,
          signal: AbortSignal.timeout(BOT_CHECK_TIMEOUT_MS),
        });
        if (!res.ok) return false;
        const answer = await res.json() as { success?: unknown } | null;
        return answer?.success === true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Public mail providers: one address there is one person, so a domain limit
 * would only cap honest sign-ups across the installation. The per-address
 * limits (0058, 0112) and the installation's daily cap still hold for them.
 * A company's own domain is limited (`SIGNUP_GUARD.codesPerDomain`), so a
 * script cannot walk through one organisation's addresses.
 */
export const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de',
  'mail.ru', 'yandex.ru', 'yandex.com', 'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net', 'sina.com',
  'sohu.com', 'aliyun.com', 'naver.com', 'daum.net', 'zoho.com', 'yahoo.co.jp', 'outlook.sa', 'hotmail.fr',
  'yahoo.fr', 'orange.fr', 'free.fr', 'laposte.net', 'libero.it', 'uol.com.br', 'bol.com.br', 'terra.com.br',
]);

/** The domain a code goes to, lower case; null when it is a public provider's (no domain limit). */
export function limitedDomainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain && !PUBLIC_MAIL_DOMAINS.has(domain) ? domain : null;
}

/**
 * BOT — the database's limits on the door, from the composition (main.ts).
 * Absent (a test's app), only the process's own limits hold, as before 0114.
 *
 *   attemptsPerCaller  sign-up forms per caller address an hour: the five the
 *                      process already allowed, now surviving a deploy and
 *                      shared by every process
 *   codesPerDomain     sign-up codes an hour to one company domain
 */
export type SignupGuard = { readonly attemptsPerCaller: number; readonly codesPerDomain: number };
export const SIGNUP_GUARD: SignupGuard = { attemptsPerCaller: 5, codesPerDomain: 10 };
