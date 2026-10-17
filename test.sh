#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
node_home="$(dirname -- "$(dirname -- "$(realpath -- "$(command -v node)")")")"
pi_root="$(dirname -- "$(realpath -- "$(command -v pi)")")"
while [[ ! -f "$pi_root/package.json" ]]; do
  [[ "$pi_root" != / ]] || { echo "Cannot locate installed Pi package" >&2; exit 1; }
  pi_root="$(dirname -- "$pi_root")"
done
typescript_root="${PI_RIVER_TYPESCRIPT_DIR:-$HOME/.pi-lens/tools/node_modules/typescript}"
[[ -f "$typescript_root/lib/tsc.js" ]] || { echo "Existing TypeScript compiler not found; set PI_RIVER_TYPESCRIPT_DIR" >&2; exit 1; }
# Writable mountpoints are private; source, installed packages and host home stay protected.
exec bwrap --unshare-all --die-with-parent --new-session --clearenv \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --ro-bind /etc/alternatives /etc/alternatives \
  --ro-bind "$node_home" /node \
  --ro-bind "$typescript_root" /typescript \
  --tmpfs /home --tmpfs /tmp --tmpfs /workspace --proc /proc --dev /dev \
  --ro-bind "$PWD/index.ts" /workspace/index.ts \
  --ro-bind "$PWD/index.test.ts" /workspace/index.test.ts \
  --ro-bind "$PWD/tsconfig.json" /workspace/tsconfig.json \
  --ro-bind "$pi_root" /workspace/node_modules/@earendil-works/pi-coding-agent \
  --setenv HOME /tmp --setenv PATH /node/bin:/usr/bin:/bin \
  --setenv PI_CODING_AGENT_DIR /tmp/agent --setenv PI_OFFLINE 1 \
  --setenv RIVER_API_KEY fake-test-key --chdir /workspace \
  /bin/bash -c '/node/bin/node /typescript/lib/tsc.js --project tsconfig.json && echo "TypeScript check passed" && exec /node/bin/node --experimental-strip-types --test index.test.ts'
