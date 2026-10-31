#!/bin/bash
set -euo pipefail
mkdir -p mobile/emulator-results
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n me.hisunalan.sjtudownloader.beta/me.hisunalan.sjtudownloader.MainActivity
sleep 8
adb shell pidof me.hisunalan.sjtudownloader.beta
adb exec-out screencap -p > mobile/emulator-results/home.png
adb shell uiautomator dump /sdcard/window.xml || true
adb pull /sdcard/window.xml mobile/emulator-results/home-hierarchy.xml || true
# Exercise the four-tab navigation on the emulator.
adb shell input tap 645 2200
sleep 3
adb exec-out screencap -p > mobile/emulator-results/calendar.png
adb shell uiautomator dump /sdcard/window.xml || true
adb pull /sdcard/window.xml mobile/emulator-results/calendar-hierarchy.xml || true
adb shell input tap 540 1350
sleep 12
adb exec-out screencap -p > mobile/emulator-results/login-attempt.png
adb shell uiautomator dump /sdcard/window.xml || true
adb pull /sdcard/window.xml mobile/emulator-results/login-hierarchy.xml || true
adb logcat -d -v brief > mobile/emulator-results/logcat.txt
if grep -q 'FATAL EXCEPTION.*' mobile/emulator-results/logcat.txt; then
  echo "Android app has a fatal exception"
  exit 1
fi
# Force-stop simulates a fully closed application, then verify Android relaunch.
adb shell am force-stop me.hisunalan.sjtudownloader.beta
sleep 2
adb shell am start -W -n me.hisunalan.sjtudownloader.beta/me.hisunalan.sjtudownloader.MainActivity
sleep 5
adb shell pidof me.hisunalan.sjtudownloader.beta
adb exec-out screencap -p > mobile/emulator-results/reopened.png
echo "Emulator fresh-start and process-restart checks finished"
