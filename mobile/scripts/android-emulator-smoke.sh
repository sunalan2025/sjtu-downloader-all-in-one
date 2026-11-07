#!/bin/bash
set -euo pipefail
OUT="mobile/emulator-results"
APK="mobile/android/app/build/outputs/apk/debug/app-debug.apk"
PKG="me.hisunalan.sjtudownloader.beta"
ACT="me.hisunalan.sjtudownloader.MainActivity"
mkdir -p "$OUT"
adb shell wm size > "$OUT/display-size.txt"
adb exec-out run-as "$PKG" cat files/weekly-native-text.png > "$OUT/weekly-native-text.png" || true
adb exec-out run-as "$PKG" cat files/widget-theme-light.png > "$OUT/widget-theme-light.png" || true
adb exec-out run-as "$PKG" cat files/widget-theme-dark.png > "$OUT/widget-theme-dark.png" || true
adb install -r "$APK"
adb shell am start -W -n "$PKG/$ACT"
# Wait for accessible content rather than assuming a cold WebView always
# initializes within a fixed sleep, especially on shared emulator runners.
capture_hierarchy() {
  adb shell uiautomator dump /sdcard/sjtu.xml >/dev/null
  adb pull /sdcard/sjtu.xml "$OUT/$1" >/dev/null 2>&1
}
wait_for_copy() {
  local copy="$1" target="$2"
  for attempt in $(seq 1 10); do
    capture_hierarchy "$target" || true
    if grep -Fq "$copy" "$OUT/$target"; then return 0; fi
    sleep 1
  done
  echo "Expected app content did not appear: $copy"
  cat "$OUT/$target" || true
  adb shell dumpsys activity activities | tail -35
  return 1
}
wait_for_copy '学习，轻盈一点' home-hierarchy.xml
test -n "$(adb shell pidof "$PKG")"
adb exec-out screencap -p > "$OUT/material-home.png"
# The navigation label is stable across DPI, insets and emulator profiles.
NAV_POINT="$(python3 - "$OUT/home-hierarchy.xml" <<'PYPOINT'
import re, sys, xml.etree.ElementTree as ET
for node in ET.parse(sys.argv[1]).iter('node'):
    if node.get('text') == '日历' or node.get('content-desc') == '日历':
        bounds=list(map(int,re.findall(r'\d+',node.get('bounds',''))))
        if len(bounds)==4 and bounds[2]>bounds[0] and bounds[3]>bounds[1]:
            print((bounds[0]+bounds[2])//2,(bounds[1]+bounds[3])//2)
            break
else:
    raise SystemExit('Calendar navigation button missing from accessible home')
PYPOINT
)"
read -r NAV_X NAV_Y <<< "$NAV_POINT"
adb shell input tap "$NAV_X" "$NAV_Y"
wait_for_copy '课程、考试与作业' calendar-hierarchy.xml
adb exec-out screencap -p > "$OUT/material-calendar.png"
# Real system Back event. Capacitor App must navigate from Calendar -> Home.
adb shell input keyevent KEYCODE_BACK
wait_for_copy '学习，轻盈一点' back-hierarchy.xml
adb exec-out screencap -p > "$OUT/back-to-home.png"
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
echo "PASS: Material You UI, native back navigation and process relaunch"
