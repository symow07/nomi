#!/usr/bin/env python3
"""The password of a Postgres URL goes into the ENVIRONMENT, never into argv.

    eval "$(python3 tools/lib/pgenv.py MIGRATE_DATABASE_URL)"
    psql "$PG_URL_NOPASS" …        # libpq reads PGPASSWORD by itself

Prints two shell lines: `export PGPASSWORD=<decoded password>` and
`PG_URL_NOPASS=<the same URL with the password removed>`. Everything else in
the URL — user, host, port, database, ?sslmode=… — is kept exactly, so the
tools connect as before; only the secret moves.

WHY. `pg_dump -d "$URL"` puts the whole credential in the process list for the
length of the dump, readable by any local user and by any `ps` a session runs
(found 2026-09-23). Environment variables are not shown by `ps`.

The password is printed ONLY inside the export line that `eval` consumes; it is
never echoed by this script otherwise, and a URL that is not a Postgres URL is
refused rather than half-parsed. Exit 2 on any refusal.
"""
import os
import shlex
import sys
from urllib.parse import unquote, urlsplit, urlunsplit

name = sys.argv[1] if len(sys.argv) > 1 else 'MIGRATE_DATABASE_URL'
url = os.environ.get(name, '')
if not url:
    print(f'pgenv: {name} is not set', file=sys.stderr)
    sys.exit(2)

u = urlsplit(url)
if u.scheme not in ('postgres', 'postgresql'):
    print(f'pgenv: {name} is not a postgres:// url', file=sys.stderr)
    sys.exit(2)

# The user part stays as written (percent-encoded if it was); the password is
# decoded, because PGPASSWORD is the literal password and not a URL fragment.
user = u.username or ''
host = u.hostname or ''
if ':' in host:                     # a bare IPv6 address goes back into brackets
    host = f'[{host}]'
netloc = (f'{user}@' if user else '') + host + (f':{u.port}' if u.port else '')
clean = urlunsplit((u.scheme, netloc, u.path, u.query, u.fragment))


def q(s: str) -> str:
    """Always single-quoted, so the output has one shape whatever the password holds."""
    return "'" + s.replace("'", "'\"'\"'") + "'"


print(f'export PGPASSWORD={q(unquote(u.password) if u.password else "")}')
print(f'PG_URL_NOPASS={q(clean)}')
