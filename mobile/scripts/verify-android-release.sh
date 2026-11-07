#!/usr/bin/env bash
set -euo pipefail
APK="${1:?Pass the signed release APK}"
AAPT="$ANDROID_HOME/build-tools/35.0.0/aapt"
SIGNER="$ANDROID_HOME/build-tools/35.0.0/apksigner"
VERSION="$(node -p "require('./mobile/package.json').version")"
CODE="$(node -p "const v=require('./mobile/package.json').version.split('.').map(Number);v[0]*10000+v[1]*100+v[2]")"
META="$(mktemp)"
MANIFEST="$(mktemp)"
RESOURCES="$(mktemp)"
trap 'rm -f "$META" "$MANIFEST" "$RESOURCES"' EXIT
unzip -t "$APK" >/dev/null
"$AAPT" dump badging "$APK" > "$META"
grep -Fq "name='me.hisunalan.sjtudownloader.beta'" "$META"
grep -Fq "versionName='$VERSION'" "$META"
grep -Fq "versionCode='$CODE'" "$META"
grep -Fq "application-label:'SJTU Downloader'" "$META"
grep -Fq "launchable-activity: name='me.hisunalan.sjtudownloader.MainActivity'" "$META"
if grep -q 'application-debuggable' "$META"; then
  echo 'Release APK must not be debuggable'; exit 1
fi
"$AAPT" dump xmltree "$APK" AndroidManifest.xml > "$MANIFEST"
"$AAPT" dump resources "$APK" > "$RESOURCES"
grep -Fq 'layout/weekly_schedule_native_card' "$RESOURCES"
for item in UpcomingAgendaWidget WeeklyScheduleWidget AgendaSyncService AgendaReminderReceiver WidgetMinuteReceiver android.permission.POST_NOTIFICATIONS; do
  grep -Fq "$item" "$MANIFEST"
done
CERT="$("$SIGNER" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)"
test "$CERT" = fc55e26ae499cfb8790fc9185f65d641da06b842199fb84126899bbdf86a0c24
python3 - "$APK" <<'CHECK'
import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as apk:
 names=apk.namelist()
 dex=b''.join(apk.read(n) for n in names if n.endswith('.dex'))
 assert b'testAgendaNotification' not in dex
 for component in (b'WebViewOptionsMotionTest',b'WidgetThemeTest',b'WeekendPreviewTest'):
  assert component not in dex
 assert not any(n.endswith(('.gif','.md')) or 'ui-results/' in n or 'harmonyos-form-kit/' in n for n in names)
CHECK
printf 'PASS: release identity, non-debuggable package, upgrade certificate and clean application contents (%s)\n' "$VERSION"
