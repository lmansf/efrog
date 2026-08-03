#!/bin/bash
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
set -o pipefail

# The paid Developer Program team that owns the Apple Distribution certificate
# and the com.efrog.ios App ID. Note this is NOT the team on the Apple
# Development certificate (BM93GAWCJD) — both display as "Logan Mansfield" in
# Xcode, and signing against that one is what produces the misleading
# "your team has no devices" error.
TEAM_ID="MRT4QD3Z77"
PROFILE="eFrog App Store"
ARCHIVE="$HOME/Desktop/eFrog.xcarchive"
LOG="$HOME/Desktop/efrog-archive.log"

cd "$(dirname "$0")/.."

# ── Preflight: catch the common failures in seconds, not after a 15-minute build

echo "▸ Checking for a distribution identity…"
if ! security find-identity -v -p codesigning | grep -q "Apple Distribution"; then
  echo "✗ No 'Apple Distribution' certificate in the keychain."
  echo "  Run ./scripts/distribution-cert.sh request   (see TESTFLIGHT.md)"
  exit 1
fi

echo "▸ Checking for the '$PROFILE' provisioning profile…"
profile_found=0
while IFS= read -r p; do
  if security cms -D -i "$p" 2>/dev/null | grep -q "<string>$PROFILE</string>"; then
    profile_found=1
    break
  fi
done < <(find "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" \
              "$HOME/Library/MobileDevice/Provisioning Profiles" \
              -name '*.mobileprovision' 2>/dev/null)

if [ "$profile_found" -eq 0 ]; then
  echo "✗ No installed profile named '$PROFILE'."
  echo "  Create it at https://developer.apple.com/account/resources/profiles/add"
  echo "    Distribution → App Store Connect → App ID com.efrog.ios →"
  echo "    Apple Distribution certificate → name it exactly: $PROFILE"
  echo "  Then double-click the downloaded .mobileprovision and re-run this script."
  exit 1
fi

# ── Build

echo "▸ Regenerating the Xcode project…"
xcodegen generate

echo "▸ Archiving (expect 10-20 minutes on older hardware)…"
echo "  Full log: $LOG"
set +e
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
  DEVELOPMENT_TEAM="$TEAM_ID" 2>&1 | tee "$LOG"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo
  echo "✗ Archive failed. Errors from the log:"
  echo "─────────────────────────────────────────────────────────────"
  grep -E "error:|Provisioning|provisioning profile|Code Sign|codesign" "$LOG" | sort -u | head -20
  echo "─────────────────────────────────────────────────────────────"
  echo "Full log: $LOG"
  exit "$status"
fi

echo
echo "✓ Archive written to $ARCHIVE"
echo
echo "Next — upload it:"
echo "    open \"$ARCHIVE\""
echo "  Xcode's Organizer opens → Distribute App → TestFlight & App Store → Upload."
