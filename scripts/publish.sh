#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building..."
npm run build

echo "==> Testing..."
npm run test

echo "==> Versioning..."
npx changeset version

if [ -n "${SONDE_PACK_SIGNING_KEY:-}" ]; then
  echo "==> Signing packs..."
  npx tsx scripts/sign-packs.ts
else
  echo "==> Skipping pack signing (SONDE_PACK_SIGNING_KEY not set)"
fi

echo "==> Publishing..."
npx changeset publish

echo "==> Done."
