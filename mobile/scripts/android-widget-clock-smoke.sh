#!/bin/bash
set -euo pipefail
OUT="mobile/emulator-results"
PKG="me.hisunalan.sjtudownloader.beta"
RUNNER="$PKG.test/androidx.test.runner.AndroidJUnitRunner"
PROBE_CLASS="me.hisunalan.sjtudownloader.WidgetClockColdStartProbeTest"
mkdir -p "$OUT"
test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1
# Gradle may remove instrumented APKs after its suite; install the standalone
# probe explicitly before invoking its separate instrumentation component.
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
TEST_APK="$(find mobile/android/app/build/outputs/apk/androidTest/debug -maxdepth 1 -name '*.apk' | head -1)"
test -s "$TEST_APK"
adb install -r "$TEST_APK"
adb shell pm list instrumentation | tee "$OUT/clock-instrumentation.txt"
grep -Fq "$RUNNER" "$OUT/clock-instrumentation.txt"
start_target() {
  adb shell am start -W -n "$PKG/me.hisunalan.sjtudownloader.MainActivity" > /dev/null
}
cleanup() {
  start_target || true
  adb shell am instrument --no-restart -r -w -e class "$PROBE_CLASS" -e clockProbeMode cleanup "$RUNNER" > "$OUT/clock-probe-cleanup.txt" 2>&1 || true
  # Permission revocation can kill the target process, so do it only after
  # the test runner has finished restoring data/removing its fixture.
  if grep -q 'exactOriginallyAllowed=false' "$OUT/clock-probe-cleanup.txt"; then
    adb shell appops set "$PKG" SCHEDULE_EXACT_ALARM default || true
  fi
  if ! grep -q 'clockProbe=clean' "$OUT/clock-probe-cleanup.txt"; then
    cat "$OUT/clock-probe-cleanup.txt"; return 1
  fi
}
trap 'cleanup || exit 1' EXIT
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard || true
# End any activity left by the regular WebView suite before creating the
# recovery fixture. No force-stop is used after its minute alarm is armed.
adb shell am force-stop "$PKG"
start_target
for attempt in $(seq 1 15); do
  if ! adb shell uiautomator dump /sdcard/sjtu-clock-home.xml > "$OUT/clock-ui-dump.txt" 2>&1; then sleep 1; continue; fi
  if ! adb pull /sdcard/sjtu-clock-home.xml "$OUT/clock-home.xml" >/dev/null 2>&1; then sleep 1; continue; fi
  if grep -Fq '你的校园工作台' "$OUT/clock-home.xml"; then break; fi
  sleep 1
done
if ! grep -Fq '你的校园工作台' "$OUT/clock-home.xml"; then
  cat "$OUT/clock-home.xml" || true
  adb logcat -d -t 150
  echo 'FAIL: application home did not become ready for the recovery probe'
  exit 1
fi
adb shell input keyevent KEYCODE_HOME
# --no-restart also prevents Instrumentation.finish from force-stopping the
# target and canceling its alarms. The following SIGKILL is the actual reclaim.
# Raw output retains custom result keys alongside AndroidJUnitRunner's stream.
if ! adb shell am instrument --no-restart -r -w -e class "$PROBE_CLASS" -e clockProbeMode setup "$RUNNER" > "$OUT/clock-probe-setup.txt" 2>&1; then
  cat "$OUT/clock-probe-setup.txt"; exit 1
fi
cat "$OUT/clock-probe-setup.txt"
grep -q 'clockProbe=ready' "$OUT/clock-probe-setup.txt"
SEED_PID="$(sed -n 's/.*seedPid=\([0-9][0-9]*\).*/\1/p' "$OUT/clock-probe-setup.txt" | head -1)"
test -n "$SEED_PID"
adb shell dumpsys alarm > "$OUT/clock-alarms.txt"
# A normal process reclaim, not force-stop (which intentionally cancels alarms).
adb shell run-as "$PKG" kill -9 "$SEED_PID" || true
for attempt in $(seq 1 75); do
  adb exec-out run-as "$PKG" cat shared_prefs/sjtu-today-widget-v1.xml > "$OUT/clock-after-process-death.xml" 2>/dev/null || true
  if python3 - "$OUT/clock-after-process-death.xml" "$SEED_PID" <<'PYCLOCK'
import sys, xml.etree.ElementTree as E
try:
    values={n.get('name'):n.get('value') for n in E.parse(sys.argv[1]).getroot()}
    assert int(values.get('lastMinuteAlarmPid',0)) not in (0,int(sys.argv[2]))
    assert int(values.get('lastMinuteAlarmAt',0))>0
    assert int(values.get('weeklyRenderedInstances',0))==1
    # A cached TIME_TICK may render just before the alarm in the recovered
    # process. Both triggers intentionally share one render per minute.
    assert int(values.get('lastRenderAt',0))//60000==int(values['lastMinuteAlarmAt'])//60000
except Exception:
    raise SystemExit(1)
PYCLOCK
  then
    echo 'PASS: OS minute alarm cold-started a reclaimed process and refreshed the widget'
    exit 0
  fi
  sleep 1
done
cat "$OUT/clock-after-process-death.xml"
echo 'FAIL: minute clock did not recover after process death'
exit 1
