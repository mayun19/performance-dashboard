#!/bin/bash
set -e
TARGET=$1

if [ "$TARGET" != "local" ] && [ "$TARGET" != "remote" ]; then
  echo "Usage: ./scripts/use-env.sh [local|remote]"
  exit 1
fi

cp ".env.$TARGET" .env
echo "✅ Now using .env.$TARGET → apps/api/.env"
grep DATABASE_URL .env
