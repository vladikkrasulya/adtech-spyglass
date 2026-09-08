#!/usr/bin/env bash
#
# npm-pack-smoke.sh — simulate a clean npm install from packed tarballs.
# Verifies @ortbtools/core and @ortbtools/cli ship installable artifacts
# before registry publish (Phase 3 gate).
#
# Usage: scripts/npm-pack-smoke.sh
# Exit 0 iff pack + install + ortbtools --help succeed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d -t ortbtools-npm-smoke-XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> npm pack smoke (workdir=$WORKDIR)"

cd "$ROOT/packages/core"
CORE_PACK="$(npm pack --pack-destination "$WORKDIR" --silent)"
echo "    core: $CORE_PACK"

cd "$ROOT/packages/cli"
cp package.json package.json.smoke-bak
# Point CLI at the packed core tarball so `npm install cli.tgz` does not hit registry.
npm pkg set "dependencies.@ortbtools/core=file:${WORKDIR}/${CORE_PACK}"
CLI_PACK="$(npm pack --pack-destination "$WORKDIR" --silent)"
mv package.json.smoke-bak package.json
echo "    cli:  $CLI_PACK"

INSTALL_DIR="${WORKDIR}/install"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
npm init -y >/dev/null 2>&1
npm install "${WORKDIR}/${CORE_PACK}" "${WORKDIR}/${CLI_PACK}" --omit=dev --silent

echo "==> ortbtools --help"
npx ortbtools --help | head -5

REQ="${INSTALL_DIR}/req.json"
# The sizeless banner is a genuine error (imp.banner.size_required); the
# missing site/app and device are only warnings since 021 (ADR-016), so the
# request must carry a real error to exercise the exit-1 path.
printf '%s\n' '{"id":"1","imp":[{"id":"1","banner":{}}],"at":1}' >"$REQ"
echo "==> ortbtools validate (expect error findings, exit 1)"
set +e
npx ortbtools validate "$REQ" >/dev/null
CODE=$?
set -e
if [[ "$CODE" -ne 1 ]]; then
  echo "ABORT: expected exit 1 (findings), got $CODE" >&2
  exit 1
fi

echo "NPM PACK SMOKE OK"
