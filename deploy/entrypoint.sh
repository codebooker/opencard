#!/bin/sh
# Runtime entrypoint (CQ-11: run the app as a non-root user).
#
# The image starts as root only long enough to make the mounted writable dirs
# owned by the unprivileged `opencard` user (named volumes / bind mounts are
# created root-owned by Docker), then drops privileges with gosu and execs the
# real command. If we're already non-root (e.g. run with --user), just exec.
set -e

APP_USER=opencard

if [ "$(id -u)" = "0" ]; then
  for dir in /app/uploads /app/backups; do
    [ -d "$dir" ] && chown -R "$APP_USER":"$APP_USER" "$dir" 2>/dev/null || true
  done
  exec gosu "$APP_USER" "$@"
fi

exec "$@"
