#!/bin/sh
# Push new migrations to the linked hosted Supabase project.
# The database password is read from the macOS Keychain item "aicheckout-supabase-db", so it never appears in
# shell history, logs, or an agent transcript. Store it once with:
#   security add-generic-password -a "$USER" -s aicheckout-supabase-db -w
# Extra arguments are passed through (e.g. --dry-run to list pending migrations without applying them).
set -eu
cd "$(dirname "$0")/.."
SUPABASE_DB_PASSWORD=$(security find-generic-password -a "$USER" -s aicheckout-supabase-db -w)
export SUPABASE_DB_PASSWORD
exec npx supabase db push --linked --skip-vault "$@"
