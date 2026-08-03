#!/bin/bash
# Archive eFrog for App Store / TestFlight distribution.
#
#   ./archive.sh
#
# Signs the Release configuration manually with the Apple Distribution identity
# and an App Store provisioning profile for com.efrog.ios. The overrides are
# passed on the command line rather than committed to project.yml so Xcode
# Cloud's managed signing keeps working unchanged.
#
# Why manual: `xcodebuild archive` under automatic signing requests an iOS App
# *Development* profile even for Release, and those embed device UDIDs — so a
# team with no registered device cannot archive any other way. See TESTFLIGHT.md.
#
# NOTE: the resulting .ipa is only uploadable if this Mac's Xcode meets App
# Store Connect's current SDK floor (iOS 26 SDK / Xcode 26 as of 2026, which
# needs Apple Silicon). On an older toolchain the upload fails validation with
# a 409 "SDK version issue" — build via Xcode Cloud instead. The archive is
# still useful for local inspection and for `xcrun simctl` installs.
set -e
set -o pipefail

# The paid Developer Program team that owns the Apple Distribution certificate
# and the com.efrog.ios App ID. NOT the team on the Apple Development
# certificate (BM93GAWCJD) — both display as "Logan Mansfield" in Xcode, and
# signing against that one produces the misleading "team has no devices" error.
TEAM_ID="MRT4QD3Z77"
BUNDLE_ID="com.efrog.ios"
ARCHIVE="$HOME/Desktop/eFrog.xcarchive"
LOG="$HOME/Desktop/efrog-archive.log"

# Xcode 16 reads profiles from UserData; older Xcodes used MobileDevice.
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
LEGACY_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"

cd "$(dirname "$0")/.."

# ── Preflight: catch signing problems in seconds, not after a 15-minute build

echo "▸ Checking for a distribution identity…"
if ! security find-identity -v -p codesigning | grep -q "Apple Distribution"; then
  echo "✗ No 'Apple Distribution' certificate in the keychain."
  echo "  Run ./scripts/distribution-cert.sh request   (see TESTFLIGHT.md)"
  exit 1
fi

# Find an App Store profile for this bundle id. Matched on the entitlement
# rather than the profile's name, so whatever you called it in the portal
# works. Development/ad-hoc profiles list ProvisionedDevices and are skipped —
# only a device-less (App Store) profile can sign this archive.
echo "▸ Looking for an App Store provisioning profile for $BUNDLE_ID…"
FOUND_NAME=""
FOUND_UUID=""
FOUND_PATH=""
SEEN=""

while IFS= read -r p; do
  [ -f "$p" ] || continue
  tmp=$(mktemp)
  if ! security cms -D -i "$p" >"$tmp" 2>/dev/null; then rm -f "$tmp"; continue; fi

  name=$(/usr/libexec/PlistBuddy -c "Print :Name" "$tmp" 2>/dev/null || echo "")
  uuid=$(/usr/libexec/PlistBuddy -c "Print :UUID" "$tmp" 2>/dev/null || echo "")
  appid=$(/usr/libexec/PlistBuddy -c "Print :Entitlements:application-identifier" "$tmp" 2>/dev/null || echo "")
  if /usr/libexec/PlistBuddy -c "Print :ProvisionedDevices" "$tmp" >/dev/null 2>&1; then
    has_devices=yes
  else
    has_devices=no
  fi
  rm -f "$tmp"

  [ -n "$name" ] && SEEN="$SEEN
    • $name  ($appid)"

  case "$appid" in
    *".$BUNDLE_ID")
      if [ "$has_devices" = "no" ] && [ -n "$uuid" ]; then
        FOUND_NAME="$name"; FOUND_UUID="$uuid"; FOUND_PATH="$p"
        break
      fi
      ;;
  esac
done < <(find "$PROFILE_DIR" "$LEGACY_DIR" "$HOME/Downloads" \
              -maxdepth 1 -name '*.mobileprovision' 2>/dev/null)

if [ -z "$FOUND_NAME" ]; then
  echo "✗ No App Store provisioning profile for $BUNDLE_ID found."
  if [ -n "$SEEN" ]; then
    echo "  Profiles inspected (installed + ~/Downloads):$SEEN"
    echo "  None of these is an App Store profile for $BUNDLE_ID."
  else
    echo "  No provisioning profiles found at all."
  fi
  echo
  echo "  Create one at https://developer.apple.com/account/resources/profiles/add"
  echo "    → team must be the one holding your Apple Distribution certificate"
  echo "    → Distribution → App Store Connect → App ID $BUNDLE_ID"
  echo "    → download it (leaving it in ~/Downloads is fine) and re-run this script."
  exit 1
fi

# Downloading is enough — install it ourselves. Double-clicking a
# .mobileprovision no longer installs it in Xcode 16.
case "$FOUND_PATH" in
  "$HOME/Downloads"/*)
    mkdir -p "$PROFILE_DIR"
    cp "$FOUND_PATH" "$PROFILE_DIR/$FOUND_UUID.mobileprovision"
    echo "▸ Installed profile '$FOUND_NAME' from Downloads."
    ;;
  *)
    echo "▸ Using installed profile '$FOUND_NAME'."
    ;;
esac

# ── Build

echo "▸ Regenerating the Xcode project…"
xcodegen generate

# Archive WITHOUT signing, then sign during export.
#
# Command-line build settings apply to every target in the build, and Swift
# package resource bundles (Auth0_Auth0, swift-crypto_Crypto, …) reject a
# provisioning profile outright: "does not support provisioning profiles".
# Signing has to be scoped to the app target, which the command line cannot do
# — so the archive is produced unsigned and `-exportArchive` signs the app
# (and only the app) with the profile below.
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
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee "$LOG"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo
  echo "✗ Archive failed. Errors from the log:"
  echo "─────────────────────────────────────────────────────────────"
  grep -E "error:" "$LOG" | sort -u | head -20
  echo "─────────────────────────────────────────────────────────────"
  echo "Full log: $LOG"
  exit "$status"
fi

echo "✓ Archive written to $ARCHIVE"

# ── Export a signed .ipa

EXPORT_DIR="$HOME/Desktop/eFrogExport"
OPTS="$HOME/Desktop/eFrogExportOptions.plist"
rm -rf "$EXPORT_DIR"

cat > "$OPTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>$BUNDLE_ID</key><string>$FOUND_NAME</string>
  </dict>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

echo "▸ Exporting a signed .ipa…"
set +e
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$OPTS" 2>&1 | tee -a "$LOG"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo
  echo "✗ Export failed. Errors from the log:"
  echo "─────────────────────────────────────────────────────────────"
  grep -E "error:|Provisioning|provisioning profile|Code Sign|codesign" "$LOG" | sort -u | head -20
  echo "─────────────────────────────────────────────────────────────"
  echo "Full log: $LOG"
  exit "$status"
fi

IPA=$(find "$EXPORT_DIR" -name '*.ipa' | head -1)
echo
echo "✓ Signed app ready: $IPA"
echo
echo "Next — upload to TestFlight:"
echo "  1. Install 'Transporter' (free) from the Mac App Store, if you haven't:"
echo "       open \"macappstore://apps.apple.com/app/transporter/id1450874784\""
echo "  2. Open Transporter, sign in with your Apple ID, and drag this file in:"
echo "       $IPA"
echo "  3. Click Deliver. The build appears in App Store Connect → TestFlight"
echo "     after 5-15 minutes of processing."
