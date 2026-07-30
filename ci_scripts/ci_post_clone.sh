#!/bin/sh
# Repo-root copy of the Xcode Cloud post-clone hook.
#
# Xcode Cloud looks for ci_scripts/ next to the Xcode project in some versions
# and at the repository root in others. The real script lives in
# ios/ci_scripts/ci_post_clone.sh; this forwards to it so the hook is found
# either way and there is only one implementation to maintain.
set -e
exec "$(dirname "$0")/../ios/ci_scripts/ci_post_clone.sh" "$@"
