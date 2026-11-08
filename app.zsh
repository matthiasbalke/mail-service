#!/usr/bin/env zsh

docker compose -p mail-service-dev --env-file local/.env -f docs/compose.yaml "$@"
