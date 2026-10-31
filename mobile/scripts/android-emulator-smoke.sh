#!/bin/bash
set -euo pipefail
mkdir -p mobile/emulator-results
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n me.hisunalan.sjtudownloader.beta/me.hisunalan.sjtudownloader.MainActivity
sleep 8
adb shell pidof me.hisunalan.sjtudownloader.beta
adb exec-out screencap -p > mobile/emulator-results/home.png
adb logcat -d -v brief > mobile/emulator-results/logcat.txt
echo "Emulator launch check finished"
