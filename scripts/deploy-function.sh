#!/usr/bin/env bash
# Deploy one Edge Function from supabase/functions/<name> to the hosted project.
#
#   ./scripts/deploy-function.sh sync-zendesk
#
# Reads SUPABASE_ACCESS_TOKEN from .env. Generate one at
# https://supabase.com/dashboard/account/tokens
set -euo pipefail

PROJECT_REF=vantaufqxthqmlakaxbi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ $# -ne 1 ]; then
  echo "usage: $0 <function-name>" >&2
  exit 1
fi

FN="$1"
if [ ! -d "$ROOT/supabase/functions/$FN" ]; then
  echo "no such function: supabase/functions/$FN" >&2
  exit 1
fi

# Read the one value we need rather than sourcing the file. Sourcing executes whatever is
# in there, and a stray space around a value is enough to break it.
SUPABASE_ACCESS_TOKEN="$(
  grep -m1 '^SUPABASE_ACCESS_TOKEN=' "$ROOT/.env" | cut -d= -f2- | tr -d ' \r'
)"
export SUPABASE_ACCESS_TOKEN

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_ACCESS_TOKEN missing from .env" >&2
  exit 1
fi

cd "$ROOT"
npx --yes supabase@latest functions deploy "$FN" --project-ref "$PROJECT_REF"
