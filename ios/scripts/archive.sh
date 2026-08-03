#!/bin/sh
# Archive eFrog for App Store / TestFlight distribution.
#
#   ./archive.sh
#
# Signs the Release configuration manually with the Apple Distribution identity
# and the "eFrog App Store" provisioning profile. The overrides are passed on
# the command line rather than committed to project.yml so Xcode Cloud's
# managed signing keeps working unchanged.
#
# Why manual: `xcodebuild archive` under automatic signing requests an iOS App
# *Development* profile even for Release, and those embed device UDIDs — so a
# team with no registered device cannot archive any other way. See TESTFLIGHT.md.
set -e

TEAM_ID="BM93GAWCJD"
PROFILE="eFrog App Store"
ARCHIVE="$HOME/Desktop/eFrog.xcarchive"

cd "$(dirname "$0")/.."

echo "▸ Regenerating the Xcode project…"
xcodegen generate

echo "▸ Checking for a distribution identity…"
security find-identity -v -p codesigning | grep -q "Apple Distribution" || {
  echo "✗ No 'Apple Distribution' certificate in the keychain."
  echo "  Run ./scripts/distribution-cert.sh request  (see TESTFLIGHT.md)."
  exit 1
}

echo "▸ Archiving (expect 10-20 minutes on older hardware)…"
xcodebuild \
  -project eFrog.xcodeproj \
  -scheme eFrog \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  archive \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="Apple Distribution" \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE" \
  DEVELOPMENT_TEAM="$TEAM_ID"

echo
echo "✓ Archive written to $ARCHIVE"
echo
echo "Next — upload it:"
echo "    open \"$ARCHIVE\""
echo "  Xcode's Organizer opens → Distribute App → TestFlight & App Store → Upload."
