#!/bin/sh
# Starts as root only to make the data directories writable, then runs the app
# as PUID:PGID (default 1000, the image's "bun" user). Bind mounts that Docker
# created (owned by root) or that belong to another user work this way too.
set -e

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  for dir in "$(dirname "${DATABASE_PATH:-/data/sammelband.db}")" "${UPLOADS_PATH:-/uploads}"; do
    mkdir -p "$dir"
    # Only when the owner is wrong: chown -R on a big photo library takes a while.
    if [ "$(stat -c %u:%g "$dir")" != "$PUID:$PGID" ]; then
      echo "[entrypoint] $dir: owner -> $PUID:$PGID"
      chown -R "$PUID:$PGID" "$dir"
    fi
  done
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi

exec "$@"
