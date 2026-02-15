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

echo "==> Publishing..."
npx changeset publish

echo "==> Done."
