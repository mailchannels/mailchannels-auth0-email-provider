#!/bin/sh
set -eu
cert_dir=$(mktemp -d)
trap 'rm -rf "$cert_dir"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$cert_dir/ca.key" -out "$cert_dir/ca.pem" -days 1 -subj '/CN=Offline Auth0 Test CA' >/dev/null 2>&1
for kind in valid wrong; do
  hostname=api.mailchannels.net
  if [ "$kind" = wrong ]; then hostname=wrong.invalid; fi
  openssl req -newkey rsa:2048 -nodes -keyout "$cert_dir/$kind.key" -out "$cert_dir/$kind.csr" -subj "/CN=$hostname" >/dev/null 2>&1
  printf 'subjectAltName=DNS:%s\n' "$hostname" > "$cert_dir/extensions"
  openssl x509 -req -in "$cert_dir/$kind.csr" -CA "$cert_dir/ca.pem" -CAkey "$cert_dir/ca.key" -CAcreateserial -out "$cert_dir/$kind.pem" -days 1 -extfile "$cert_dir/extensions" >/dev/null 2>&1
done
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$cert_dir/untrusted.key" -out "$cert_dir/untrusted.pem" -days 1 -subj "/CN=api.mailchannels.net" -addext "subjectAltName=DNS:api.mailchannels.net" >/dev/null 2>&1
CERT_DIR="$cert_dir" NODE_EXTRA_CA_CERTS="$cert_dir/ca.pem" node --test native/transport.cjs
