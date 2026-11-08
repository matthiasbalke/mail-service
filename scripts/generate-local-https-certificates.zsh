#!/usr/bin/env zsh
set -e

echo "generating/updating certificates ..."
mkdir -p local/certs

echo ""
echo "> dev environment ..."
cd local/certs
mkcert -key-file wildcard.key -cert-file wildcard.crt \*.dev.example.com dev.example.com
echo "> done."

echo ""
