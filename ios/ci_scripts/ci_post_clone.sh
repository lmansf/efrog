#!/bin/sh
# Xcode Cloud post-clone hook.
#
# eFrog.xcodeproj is generated (gitignored) — ios/project.yml is the source of
# truth — so a fresh clone on Apple's build machine has no project to build.
# This regenerates it before Xcode Cloud looks for the scheme.
#
# Runs automatically after the repository is cloned; must stay executable
# (mode 755) or Xcode Cloud silently skips it.
set -e

echo "▸ Installing XcodeGen…"
brew install xcodegen

echo "▸ Generating eFrog.xcodeproj from project.yml…"
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
xcodegen generate

# Xcode Cloud builds with -disableAutomaticPackageResolution and expects a
# committed Package.resolved. Ours can't be committed: it lives inside the
# generated (gitignored) .xcodeproj. Resolving here writes it to exactly the
# path the build step looks for.
echo "▸ Resolving Swift package dependencies…"
xcodebuild -resolvePackageDependencies -project eFrog.xcodeproj

echo "▸ Done:"
ls -d eFrog.xcodeproj
ls -l eFrog.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
