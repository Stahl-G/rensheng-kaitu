#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export KAITU_APP_HOME="$root/profile"
export KAITU_DIR="$root/workspace"
export KAITU_LOCAL_STATE_DIR="$root/local-state"
export KAITU_APP_PORT=0
exec "$root/Kaitu.app/Contents/MacOS/Kaitu"
