import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';

/**
 * SMTP submission — handing a finished message to her own mail server.
 *
 * WHY THIS EXISTS BESIDE C6's MAILBOX PATH. Gmail and Outlook are one answer to
 * "send as her", and they cost a seat per factory. Every other mail host on
 * earth speaks SMTP submission, so this is the answer for a factory whose mail
 * lives anywhere else — Zoho, Fastmail, a host's own server. The product gains a
 * provider, not a second send path: this is a `MailTransport` like the others,
 * behind the same gate, the same unsubscribe headers and the same one worker.
 *
 * ── HAND-ROLLED, LIKE EVERY OTHER WIRE IN THIS REPOSITORY ─────────────────
 *
 * The DNS check, the MIME message, OAuth and every webhook signature are built
 * on node's own primitives here; SMTP submission is a small, forty-year-stable
 * protocol and follows that line rather than adding a dependency to the one
 * process that holds her buyers' data.
 *
 * ── IT WILL NOT SEND HER PASSWORD IN THE CLEAR ────────────────────────────
 *
 * TLS is required before AUTH: port 465 connects wrapped, anything else must
 * offer STARTTLS, and a server that does not is refused rather than downgraded.
 * The single exception is a relay on this machine (localhost), where there is no
 * network to overhear — which is also what makes this testable end to end.
 *
 * ── SMTP'S CODES MEAN THE OPPOSITE OF HTTP'S ──────────────────────────────
 *
 * 4xx is TEMPORARY (greylisting, a full mailbox, a rate limit) and must be
 * retried; 5xx is permanent (no such address) and must not be. Getting this
 * backwards would either lose mail or hammer a server with a message it has
 * already refused for good.
 */

export type SmtpConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** The address every mail leaves as, and the envelope sender bounces return to. */
  readonly from: string;
};

/** What a delivery attempt became. `retryable` follows SMTP's own 4xx/5xx meaning. */
export type SmtpOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

export type SmtpDeps = {
  /** Injected so a test can hand in a socket to a server it started itself. */
  readonly connect?: (o: { host: string; port: number; secure: boolean }) => Promise<Duplex>;
  readonly timeoutMs?: number;
};

const CRLF = '\r\n';
const DEFAULT_TIMEOUT_MS = 20_000;

/** A relay on this machine has no network to be overheard on; everything else must be encrypted. */
export const isLocalHost = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1';

/**
 * RFC 5321 §4.5.2 — a line of the message that starts with a dot would end it.
 * Also normalises to CRLF, because a bare LF ends nothing and the server would
 * wait for a terminator that never comes.
 */
export function dotStuff(message: string): string {
  return message.replace(/\r\n|\r|\n/g, CRLF).replace(/^\./gm, '..');
}

/** RFC 4616 — the PLAIN mechanism, which is why the connection must already be TLS. */
export const authPlain = (user: string, password: string): string =>
  Buffer.from(`\0${user}\0${password}`, 'utf8').toString('base64');

/** One SMTP reply: its code, and the lines the server sent with it. */
export type SmtpReply = { readonly code: number; readonly lines: readonly string[] };

/**
 * A reply is COMPLETE at its final line, which separates code from text with a
 * space; `250-PIPELINING` is a continuation and more is coming.
 */
export function completeReply(text: string): SmtpReply | null {
  const lines = text.split(CRLF).filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  if (!last || !/^\d{3} /.test(last)) return null;
  return { code: Number(last.slice(0, 3)), lines: lines.map((l) => l.slice(4)) };
}

class Session {
  private buffer = '';
  private waiting: { resolve: (r: SmtpReply) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Duplex, private readonly timeoutMs: number) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.received(String(chunk)));
    socket.on('error', (e: Error) => this.broke(e));
    socket.on('close', () => this.broke(new Error('connection closed')));
  }

  private broke(e: Error): void {
    this.failure = e;
    const w = this.waiting; this.waiting = null;
    w?.reject(e);
  }

  private received(chunk: string): void {
    this.buffer += chunk;
    this.deliver();
  }

  private deliver(): void {
    if (!this.waiting) return;
    const reply = completeReply(this.buffer);
    if (!reply) return;
    this.buffer = '';
    const w = this.waiting; this.waiting = null;
    w.resolve(reply);
  }

  read(): Promise<SmtpReply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => this.broke(new Error('timed out')), this.timeoutMs);
      this.waiting = {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      this.deliver();
    });
  }

  /** Send a command and read its reply. A command never carries a line break. */
  async say(command: string): Promise<SmtpReply> {
    this.socket.write(`${command.replace(/[\r\n]+/g, ' ')}${CRLF}`);
    return this.read();
  }

  write(raw: string): void { this.socket.write(raw); }

  end(): void { try { this.socket.end(); } catch { /* closing is best-effort */ } }

  /** Hand the raw socket over for the TLS upgrade after STARTTLS. */
  detach(): Duplex {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
    return this.socket;
  }
}

const openSocket = async (o: { host: string; port: number; secure: boolean }): Promise<Duplex> =>
  new Promise((resolve, reject) => {
    const socket = o.secure
      ? tlsConnect({ host: o.host, port: o.port, servername: o.host }, () => resolve(socket))
      : netConnect({ host: o.host, port: o.port }, () => resolve(socket));
    socket.once('error', reject);
  });

const upgrade = async (socket: Duplex, host: string): Promise<Duplex> =>
  new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket: socket as never, servername: host }, () => resolve(secure));
    secure.once('error', reject);
  });

/** 4xx is temporary and retried; 5xx is permanent. Nothing the server SAID leaves as text. */
const refuse = (stage: string, reply: SmtpReply): SmtpOutcome =>
  ({ ok: false, retryable: reply.code >= 400 && reply.code < 500, error: `smtp ${stage} ${reply.code}` });

/**
 * One message, one connection. No pooling: a factory sends tens of mails a day,
 * and a pooled connection that dies between two of them is a class of bug this
 * does not need to have.
 */
export async function smtpDeliver(
  config: SmtpConfig, message: { readonly to: string; readonly data: string }, deps: SmtpDeps = {},
): Promise<SmtpOutcome> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const secure = config.port === 465;
  let session: Session | null = null;
  try {
    const socket = await (deps.connect ?? openSocket)({ host: config.host, port: config.port, secure });
    session = new Session(socket, timeoutMs);
    const greeting = await session.read();
    if (greeting.code !== 220) return refuse('greeting', greeting);

    const domain = config.from.slice(config.from.lastIndexOf('@') + 1) || 'localhost';
    let hello = await session.say(`EHLO ${domain}`);
    if (hello.code !== 250) return refuse('ehlo', hello);
    const offered = (what: string): boolean => hello.lines.some((l) => l.toUpperCase().startsWith(what));

    if (!secure) {
      if (offered('STARTTLS')) {
        const started = await session.say('STARTTLS');
        if (started.code !== 220) return refuse('starttls', started);
        session = new Session(await upgrade(session.detach(), config.host), timeoutMs);
        hello = await session.say(`EHLO ${domain}`);
        if (hello.code !== 250) return refuse('ehlo', hello);
      } else if (!isLocalHost(config.host)) {
        // FAIL CLOSED: her password is not worth a plaintext hop.
        return { ok: false, retryable: false, error: 'smtp server offers no STARTTLS' };
      }
    }

    if (config.password !== '') {
      const mechanisms = hello.lines.find((l) => l.toUpperCase().startsWith('AUTH'))?.toUpperCase() ?? '';
      const current = session;
      const auth = mechanisms === '' || mechanisms.includes('PLAIN')
        ? await current.say(`AUTH PLAIN ${authPlain(config.user, config.password)}`)
        : await (async (): Promise<SmtpReply> => {
          const start = await current.say('AUTH LOGIN');
          if (start.code !== 334) return start;
          const user = await current.say(Buffer.from(config.user, 'utf8').toString('base64'));
          if (user.code !== 334) return user;
          return current.say(Buffer.from(config.password, 'utf8').toString('base64'));
        })();
      // 535 and its neighbours are permanent: retrying a wrong password locks accounts.
      if (auth.code !== 235) return refuse('auth', auth);
    }

    const from = await session.say(`MAIL FROM:<${config.from}>`);
    if (from.code !== 250) return refuse('from', from);
    const to = await session.say(`RCPT TO:<${message.to}>`);
    if (to.code !== 250 && to.code !== 251) return refuse('recipient', to);
    const data = await session.say('DATA');
    if (data.code !== 354) return refuse('data', data);
    session.write(`${dotStuff(message.data)}${CRLF}.${CRLF}`);
    const accepted = await session.read();
    if (accepted.code !== 250) return refuse('body', accepted);
    await session.say('QUIT').catch(() => undefined);
    return { ok: true };
  } catch (e) {
    // A dropped connection or a timeout is the network, not the message.
    return { ok: false, retryable: true, error: e instanceof Error ? `smtp ${e.message}` : 'smtp failed' };
  } finally {
    session?.end();
  }
}

/**
 * The installation's own mail server, from the environment — all of it or none.
 *
 * A half-configured sender would boot green and fail at her first mail, which is
 * the failure mode `oauthClientsFrom` exists to avoid for Google and Microsoft.
 */
export function smtpConfigFrom(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env['SMTP_HOST']?.trim() ?? '';
  const user = env['SMTP_USER']?.trim() ?? '';
  const password = env['SMTP_PASSWORD'] ?? '';
  const from = (env['SMTP_FROM']?.trim() ?? '').toLowerCase();
  const port = Number(env['SMTP_PORT'] ?? 587);
  if (!host && !user && !from && !password) return null;
  const missing: string[] = [];
  if (!host) missing.push('SMTP_HOST');
  if (!user) missing.push('SMTP_USER');
  if (!password) missing.push('SMTP_PASSWORD');
  if (!/^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(from)) missing.push('SMTP_FROM');
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push('SMTP_PORT');
  if (missing.length) {
    console.warn(`SMTP sending: ${missing.join(', ')} missing or malformed. Not configured.`);
    return null;
  }
  return { host, port, user, password, from };
}
