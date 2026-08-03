#!/bin/sh
# Create and install an Apple Distribution signing certificate without using
# the Keychain Access or Xcode GUIs.
#
#   ./distribution-cert.sh request    # 1. generate the private key + CSR
#   …upload the CSR at developer.apple.com, download the .cer…
#   ./distribution-cert.sh install    # 2. pair the .cer with the key, import
#
# Why this exists: `xcodebuild archive` with automatic signing demands an iOS
# App *Development* profile (which embeds device UDIDs), so a team with no
# registered device can only archive by signing the Release configuration
# manually — which needs an Apple Distribution certificate. See TESTFLIGHT.md.
set -e

WORK="$HOME/Desktop"
KEY="$WORK/efrog_distribution.key"
CSR="$WORK/efrog_distribution.certSigningRequest"
P12="$WORK/efrog_distribution.p12"
P12_PASS="efrog"

# Identity baked into the CSR. Apple ignores these beyond record-keeping, but
# they must be present and well-formed.
EMAIL="lmansf96@gmail.com"
NAME="Logan Mansfield"

case "$1" in
request)
  echo "▸ Generating private key and certificate signing request…"
  openssl req -new -newkey rsa:2048 -nodes \
    -keyout "$KEY" \
    -out "$CSR" \
    -subj "/emailAddress=$EMAIL/CN=$NAME/C=US"
  chmod 600 "$KEY"
  echo
  echo "✓ Created:"
  echo "    $CSR   ← upload this to Apple"
  echo "    $KEY   ← keep, needed by the install step"
  echo
  echo "Next: open https://developer.apple.com/account/resources/certificates/add"
  echo "  Software → Apple Distribution → Continue → Choose File → the .certSigningRequest"
  echo "  above → Continue → Download. Then run:  $0 install"
  ;;

install)
  [ -f "$KEY" ] || { echo "✗ $KEY missing — run '$0 request' first."; exit 1; }

  # Apple's download is named distribution.cer / ios_distribution.cer depending
  # on the portal path; take the newest .cer in Downloads.
  CER=$(ls -t "$HOME/Downloads"/*.cer 2>/dev/null | head -1)
  [ -n "$CER" ] || { echo "✗ No .cer found in ~/Downloads — download it from Apple first."; exit 1; }
  echo "▸ Using certificate: $CER"

  # Apple ships DER; openssl needs PEM to bundle it with the key.
  PEM="$WORK/efrog_distribution.pem"
  openssl x509 -inform DER -in "$CER" -out "$PEM"

  echo "▸ Bundling certificate + private key…"
  openssl pkcs12 -export -legacy \
    -inkey "$KEY" -in "$PEM" \
    -out "$P12" -passout "pass:$P12_PASS" 2>/dev/null \
  || openssl pkcs12 -export \
    -inkey "$KEY" -in "$PEM" \
    -out "$P12" -passout "pass:$P12_PASS"

  echo "▸ Importing into the login keychain…"
  security import "$P12" \
    -k "$HOME/Library/Keychains/login.keychain-db" \
    -P "$P12_PASS" \
    -T /usr/bin/codesign \
    -T /usr/bin/security

  echo
  echo "▸ Signing identities now available:"
  security find-identity -v -p codesigning
  echo
  echo "If an 'Apple Distribution' line appears above, signing is ready."
  echo "Next: create the App Store provisioning profile, then archive —"
  echo "see ios/TESTFLIGHT.md ('No registered devices')."
  ;;

*)
  echo "usage: $0 request | install"
  exit 64
  ;;
esac
