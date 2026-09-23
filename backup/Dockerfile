# The scheduled backup, as a Railway cron service (docs/BACKUP-RESTORE.md,
# "Scheduled backups"). Built from the repository root with
# RAILWAY_DOCKERFILE_PATH=backup/Dockerfile, so it can carry the SAME restore
# drill the laptop runs (tools/verify-restore.sh) and prove every dump before
# it is encrypted.
#
# postgres:18 — pg_dump must not be older than the server (18.6), and the
# image carries a server too, which the drill needs for its throwaway cluster.
# pgvector is installed because production has it: without the extension the
# products table fails to restore and three tables come back with RLS and no
# policies (see the warning block in BACKUP-RESTORE.md).
FROM postgres:18-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends age rclone curl ca-certificates postgresql-18-pgvector \
 && rm -rf /var/lib/apt/lists/*

COPY backup/run.sh /app/run.sh
COPY tools/verify-restore.sh /app/verify-restore.sh
RUN chmod 0755 /app/run.sh /app/verify-restore.sh

# initdb refuses to run as root; the image's postgres user owns nothing else here.
USER postgres
ENV PGBIN=/usr/lib/postgresql/18/bin
CMD ["bash", "/app/run.sh"]
