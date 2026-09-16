import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

/**
 * Sending through her own mail provider, over a REAL SMTP conversation.
 *
 * A local server on 127.0.0.1 plays her host: it speaks the protocol, records
 * every command and keeps the message it was handed. What is proved here is
 * what no scripted double can prove — that a server which has never heard of
 * this product accepts what we send, and that the message it ends up holding is
 * the one she wrote, with the way out in its headers.
 *
 * (The password would never travel in the clear to a real host: TLS is required
 * for everything but a relay on this machine, which is what this is.)
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd520000-0000-4000-8000-${RUN}0001`;
const DOMAIN = `smtp-${RUN}.test`;
const FROM = `lily@${DOMAIN}`;

type Delivered = { readonly commands: string[]; readonly data: string };

/** A minimal SMTP submission server: EHLO, AUTH PLAIN, MAIL, RCPT, DATA. */
function localSmtp(o: { readonly reject?: string } = {}): {
  readonly start: () => Promise<number>;
  readonly stop: () => Promise<void>;
  readonly delivered: Delivered[];
} {
  const delivered: Delivered[] = [];
  let server: Server | null = null;
  return {
    delivered,
    start: () => new Promise<number>((resolve) => {
      server = createServer((socket: Socket) => {
        const commands: string[] = [];
        let inData = false;
        let body = '';
        socket.setEncoding('utf8');
        socket.write('220 local ESMTP\r\n');
        socket.on('data', (chunk: string) => {
          for (const line of String(chunk).split('\r\n')) {
            if (inData) {
              if (line === '.') {
                inData = false;
                delivered.push({ commands: [...commands], data: body });
                socket.write('250 2.0.0 Ok: queued\r\n');
              } else {
                body += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
              }
              continue;
            }
            if (line === '') continue;
            commands.push(line);
            const verb = line.split(' ')[0]!.toUpperCase();
            if (verb === 'EHLO') socket.write('250-local\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10240000\r\n');
            else if (verb === 'AUTH') socket.write('235 2.7.0 Authentication successful\r\n');
            else if (verb === 'MAIL') socket.write('250 2.1.0 Ok\r\n');
            else if (verb === 'RCPT') socket.write(o.reject ? `${o.reject}\r\n` : '250 2.1.5 Ok\r\n');
            else if (verb === 'DATA') { inData = true; body = ''; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
            else if (verb === 'QUIT') { socket.write('221 2.0.0 Bye\r\n'); socket.end(); }
            else socket.write('250 2.0.0 Ok\r\n');
          }
        });
        socket.on('error', () => undefined);
      });
      server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
    }),
    stop: () => new Promise<void>((resolve) => { server ? server.close(() => resolve()) : resolve(); }),
  };
}

d('C7 · her own mail provider (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let port = 0;
  const server = localSmtp();

  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bid(), fn);
  };
  const transport = async (over: { from?: string; port?: number; password?: string } = {}) => {
    const { smtpMailTransport } = await import('../../src/channels/email/smtpTransport.js');
    return smtpMailTransport({
      db, businessId: await bid(),
      config: {
        host: '127.0.0.1', port: over.port ?? port, user: 'lily',
        password: over.password ?? 'secret', from: over.from ?? FROM,
      },
      smtp: { timeoutMs: 5000 },
    });
  };
  const mail = {
    to: 'ahmed@gulf.test', subject: 'Canvas totes from Yiwu', text: 'We make canvas totes.\n.\nTen years.',
    headers: {
      'List-Unsubscribe': '<https://nomi.test/u?t=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tag: 'signed-tag',
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    port = await server.start();
    await tx(async (x) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'SMTP Factory') on conflict (id) do nothing`.execute(x);
    });
  }, 60_000);

  afterAll(async () => { await server.stop(); await db?.destroy().catch(() => undefined); });

  it('REFUSES BEFORE IT CONNECTS when the domain is not verified — an unsigned mail damages her address', async () => {
    const r = await (await transport()).send(mail);
    expect(r).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining('verified sending domain') });
    expect(server.delivered).toHaveLength(0);
  });

  it('SENDS WHAT SHE WROTE: the subject, the body, her address, and the way out', async () => {
    const { setSendingDomain, recordDomainCheck } = await import('../../src/db/sendingDomain.js');
    const b = await bid();
    await tx(async (x) => {
      await setSendingDomain(x, b, { domain: DOMAIN, dkimSelector: 'k1', by: 'owner' });
      await recordDomainCheck(x, b, { spf: 'ok', dkim: 'ok', dmarc: 'ok' }, new Date());
    });

    const r = await (await transport()).send(mail);
    expect(r.ok, 'the local server refused the message').toBe(true);
    expect(server.delivered).toHaveLength(1);
    const sent = server.delivered[0]!;

    // The envelope: her address, his address.
    expect(sent.commands).toContain(`MAIL FROM:<${FROM}>`);
    expect(sent.commands).toContain('RCPT TO:<ahmed@gulf.test>');
    // The password went as PLAIN over this loopback hop, and as nothing else.
    const auth = sent.commands.find((c) => c.startsWith('AUTH PLAIN '))!;
    expect(Buffer.from(auth.slice('AUTH PLAIN '.length), 'base64').toString('utf8')).toBe('\0lily\0secret');

    // The message: her words, and the headers a first mail may not go without.
    expect(sent.data).toContain(`From: ${FROM}`);
    expect(sent.data).toContain('To: ahmed@gulf.test');
    expect(sent.data).toContain('Subject: Canvas totes from Yiwu');
    expect(sent.data).toContain('List-Unsubscribe: <https://nomi.test/u?t=abc>');
    expect(sent.data).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    const body = Buffer.from(
      sent.data.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n/g, ''), 'base64',
    ).toString('utf8');
    expect(body, 'a line of her text was eaten by the protocol').toBe('We make canvas totes.\n.\nTen years.');

    // C4.c — the id a reply will quote is the Message-ID in the message itself.
    expect(r.ok && r.providerMessageId).toBeTruthy();
    expect(sent.data).toContain(`Message-ID: <${r.ok ? r.providerMessageId : ''}>`);
    expect(r.ok && r.providerMessageId.endsWith(`@${DOMAIN}`)).toBe(true);
  }, 30_000);

  it('an address her domain does not own is refused, whatever the server would have said', async () => {
    const r = await (await transport({ from: 'lily@someone-elses.test' })).send(mail);
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(server.delivered, 'it connected anyway').toHaveLength(1);
  });

  it('A REJECTED RECIPIENT IS PERMANENT, and a server that is not there is worth retrying', async () => {
    const rejecting = localSmtp({ reject: '550 5.1.1 no such user' });
    const rejectingPort = await rejecting.start();
    try {
      const r = await (await transport({ port: rejectingPort })).send(mail);
      expect(r).toEqual({ ok: false, retryable: false, error: 'smtp recipient 550' });
    } finally {
      await rejecting.stop();
    }
    // Nothing listening: the network, not the message.
    const dead = await (await transport({ port: 1 })).send(mail);
    expect(dead).toMatchObject({ ok: false, retryable: true });
  }, 30_000);

  it('THE WORKER SENDS THROUGH IT like any other channel — one adapter, one gate, one row', async () => {
    const { emailAdapter } = await import('../../src/channels/email/adapter.js');
    const adapter = emailAdapter({ transport: await transport() });
    expect(adapter.kind).toBe('email');
    const before = server.delivered.length;
    const r = await adapter.sendMail!({ ...mail, subject: 'Following up' });
    expect(r.ok).toBe(true);
    expect(server.delivered).toHaveLength(before + 1);
    expect(server.delivered.at(-1)!.data).toContain('Subject: Following up');
  }, 30_000);
});
