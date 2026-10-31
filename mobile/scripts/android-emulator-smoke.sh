#!/bin/bash
set -euo pipefail
OUT="mobile/emulator-results"
APK="mobile/android/app/build/outputs/apk/debug/app-debug.apk"
PKG="me.hisunalan.sjtudownloader.beta"
ACT="me.hisunalan.sjtudownloader.MainActivity"
mkdir -p "$OUT"
adb install -r "$APK"
adb shell am start -W -n "$PKG/$ACT"
sleep 7
test -n "$(adb shell pidof "$PKG")"
adb exec-out screencap -p > "$OUT/glass-home.png"
adb shell uiautomator dump /sdcard/sjtu.xml || true
adb pull /sdcard/sjtu.xml "$OUT/home-hierarchy.xml" >/dev/null 2>&1 || true
# Pixel 5 emulator: the bottom bar remains above Android's navigation inset.
adb shell input tap 660 2210
sleep 3
adb exec-out screencap -p > "$OUT/glass-calendar.png"
adb shell uiautomator dump /sdcard/sjtu.xml || true
adb pull /sdcard/sjtu.xml "$OUT/calendar-hierarchy.xml" >/dev/null 2>&1 || true
# Real system Back event. Capacitor App must navigate from Calendar -> Home.
adb shell input keyevent KEYCODE_BACK
sleep 3
adb exec-out screencap -p > "$OUT/back-to-home.png"
adb shell uiautomator dump /sdcard/sjtu.xml || true
adb pull /sdcard/sjtu.xml "$OUT/back-hierarchy.xml" >/dev/null 2>&1 || true
if ! grep -q '学习，轻盈一点' "$OUT/back-hierarchy.xml"; then
  echo "Android system back did not navigate to the Home screen"
  exit 1
fi
adb shell am force-stop "$PKG"
sleep 1
adb shell am start -W -n "$PKG/$ACT"
sleep 4
test -n "$(adb shell pidof "$PKG")"
adb exec-out screencap -p > "$OUT/reopened.png"
adb logcat -d -v brief > "$OUT/logcat.txt"
if grep -E 'FATAL EXCEPTION|Process: me.hisunalan.sjtudownloader.beta' "$OUT/logcat.txt" | grep -q 'FATAL EXCEPTION'; then
  echo "App crash found"
  exit 1
fi
echo "PASS: glass UI, native back navigation and process relaunch"
