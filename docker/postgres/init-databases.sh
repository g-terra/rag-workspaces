#!/bin/sh
# Runs once, on the first start of an empty Postgres volume. The app database
# ($POSTGRES_DB) is created by the image; Langflow and Keycloak get their own.
set -eu
for db in langflow keycloak; do
  echo "creating database $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "CREATE DATABASE $db OWNER \"$POSTGRES_USER\";"
done
