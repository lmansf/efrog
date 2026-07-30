#!/bin/sh
# Xcode Cloud post-clone hook.
#
# eFrog.xcodeproj is generated (gitignored) — ios/project.yml is the source of
# truth — so a fresh clone on Apple's build machine has no project to build.
# This regenerates it and installs the package pins before Xcode Cloud's build
# step runs.
#
# Runs automatically after the repository is cloned; must stay executable
# (mode 755) or Xcode Cloud silently skips it.
set -e

echo "▸ Installing XcodeGen…"
brew install xcodegen

echo "▸ Generating eFrog.xcodeproj from project.yml…"
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
xcodegen generate

# Xcode Cloud builds with -disableAutomaticPackageResolution: it will not run
# the SwiftPM resolver and demands a pre-existing Package.resolved. Even an
# explicit `xcodebuild -resolvePackageDependencies` is refused there (exit 74),
# so the pins are committed as ios/Package.resolved and copied into the
# generated project at the path the build step reads.
#
# To refresh the pins after changing a package version in project.yml:
#   cd ios && xcodegen generate && open eFrog.xcodeproj   # let Xcode resolve
#   cp eFrog.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved \
#      Package.resolved && git commit -am "build(ios): refresh package pins"
SWIFTPM_DIR="eFrog.xcodeproj/project.xcworkspace/xcshareddata/swiftpm"
mkdir -p "$SWIFTPM_DIR"

if [ -f Package.resolved ]; then
  echo "▸ Installing committed package pins…"
  cp Package.resolved "$SWIFTPM_DIR/Package.resolved"
else
  echo "▸ No committed ios/Package.resolved — trying live resolution…"
  xcodebuild -resolvePackageDependencies -project eFrog.xcodeproj \
    || echo "⚠︎ resolution unavailable in CI — commit ios/Package.resolved (see ios/TESTFLIGHT.md)"
fi

echo "▸ Done:"
ls -d eFrog.xcodeproj
ls -l "$SWIFTPM_DIR/Package.resolved" 2>/dev/null || echo "⚠︎ no Package.resolved in place"
