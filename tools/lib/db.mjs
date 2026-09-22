/**
 * The database client every operator tool opens — the ones that can be pointed
 * at production: migrate, erase-workspace, prune-test-tenants, invite-factory,
 * provision-factory.
 *
 * WHY. `new pg.Client({ connectionString })` has no connect timeout and no read
 * timeout. On 2026-09-22 Railway's public proxy accepted a connection and then
 * never answered a single query — not even `begin` — and a tool built that way
 * waits forever, silently, with an operator watching a cursor. A hung tool is
 * worse than a failed one: nobody knows whether it is working, and a Ctrl-C in
 * the middle of an erase is a decision made blind.
 *
 * So there are three limits, and each one fails LOUDLY:
 *
 *   · connect — the server must accept the login within CONNECT_TIMEOUT_MS;
 *   · keepalive — TCP probes on an idle socket, so a peer that vanished is
 *     noticed by the operating system rather than never;
 *   · no reply — a query that gets NO answer within the tool's own limit closes
 *     the connection. Closing, not just giving up on the promise: pg keeps a
 *     timed-out query at the head of its queue, so the tool's `rollback` in its
 *     catch block would queue behind it and hang all over again. With the
 *     socket gone, the server rolls back any open transaction by itself.
 *
 * The limit on a reply is per tool, because "too long" is different for
 * issuing an invitation and for a migration. Each is overridable by env for the
 * day a legitimate run needs longer; the override is a number of seconds.
 *
 * Messages never carry the connection string.
 */
import pg from 'pg';

export const CONNECT_TIMEOUT_MS = 15_000;

const seconds = (ms) => `${Math.round(ms / 1000)} s`;

const envMs = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * 1000 : fallback;
};

/**
 * @param {string} url
 * @param {{ replyTimeoutMs: number, connectTimeoutMs?: number }} limits
 */
export function toolClient(url, limits) {
  const connectMs = limits.connectTimeoutMs ?? envMs('NOMI_DB_CONNECT_TIMEOUT_S', CONNECT_TIMEOUT_MS);
  const replyMs = envMs('NOMI_DB_REPLY_TIMEOUT_S', limits.replyTimeoutMs);
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: connectMs,
    query_timeout: replyMs,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  const connect = client.connect.bind(client);
  client.connect = async () => {
    try {
      await connect();
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new Error(/timeout/i.test(why)
        ? `could not reach the database within ${seconds(connectMs)}. Nothing was changed.`
        : why.replace(/postgres(ql)?:\/\/\S+/g, '<redacted-url>'));
    }
  };

  // A dropped socket with no query in flight is emitted as an 'error' EVENT, and
  // an EventEmitter with no listener throws it out of the process. The next
  // query fails on the dead client anyway, which is where the tool reports it.
  client.on('error', () => {});

  // Once the connection is closed, every later query — the tool's own
  // `rollback` in its catch block, above all — gets the SAME sentence, so the
  // reason the operator reads is the real one and not "Client was closed".
  let stopped = null;
  const query = client.query.bind(client);
  client.query = (...args) => {
    if (stopped) return Promise.reject(stopped);
    const p = query(...args);
    if (!p || typeof p.then !== 'function') return p;
    return p.catch((e) => {
      if (e instanceof Error && /Query read timeout/.test(e.message)) {
        stopped = new Error(`the database stopped answering: no reply within ${seconds(replyMs)}. `
          + 'The connection was closed; any open transaction is rolled back by the server.');
        client.connection?.stream?.destroy();
        throw stopped;
      }
      throw e;
    });
  };

  return client;
}
