#!/bin/bash
# Android builds: the Google Play bundle (.aab) and the sideload APK. The room videos are NOT packed in:
# the app streams them from https://app.atriumcoach.com (VITE_MEDIA_ORIGIN), so the download stays small.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=~/Library/Android/sdk
npm run build:android
rm -rf android/app/src/main/assets/public/video
(cd android && ./gradlew bundleRelease assembleRelease -q -Porg.gradle.java.installations.paths="$JAVA_HOME")
ls -la android/app/build/outputs/bundle/release/app-release.aab android/app/build/outputs/apk/release/app-release.apk
