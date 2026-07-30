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

echo "▸ Done:"
ls -d eFrog.xcodeproj
