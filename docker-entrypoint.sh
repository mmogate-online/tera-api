#!/bin/sh
set -e

# Extract bundled asset archives into bind-mounted data dirs on first boot.
# Targets are considered "empty" when they contain only the upstream placeholder
# `!Unpack ... .txt` marker files (or nothing at all).
unpack_if_empty() {
    target="$1"
    archive="$2"

    if [ ! -f "$archive" ]; then
        echo "[entrypoint] archive missing, skipping: $archive"
        return 0
    fi

    mkdir -p "$target"

    # List entries that aren't the upstream placeholder text files.
    real_entries=$(ls -A "$target" 2>/dev/null | grep -v '^!.*\.txt$' || true)
    if [ -n "$real_entries" ]; then
        return 0
    fi

    echo "[entrypoint] populating $target from $(basename "$archive")"
    unzip -oq "$archive" -d "$target"
}

unpack_if_empty /app/data/shop-slides-bg /app/share/data/shop-slides-bg.zip
unpack_if_empty /app/data/tera-icons    /app/share/data/tera-icons.zip

# Warn (but don't fail) if datasheets are missing — they come from the game client.
if [ -z "$(ls -A /app/data/datasheets 2>/dev/null | grep -i 'DataCenter_Final.*\.dat$' || true)" ] \
   && [ -z "$(ls -A /app/data/datasheets 2>/dev/null | grep -v '^!.*\.txt$' || true)" ]; then
    echo "[entrypoint] WARNING: no DataCenter_Final_*.dat files in /app/data/datasheets — see README step 6."
fi

exec "$@"
