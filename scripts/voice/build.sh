#!/bin/sh
# Generates the Danish speech clips into public/voice/ (git-ignored) for the dev server.
# The production image does this itself (Dockerfile, voice stage); both share Docker's build cache.
set -e
cd "$(dirname "$0")/../.."
rm -rf public/voice
docker build --target voice-files --output type=local,dest=public/voice .
