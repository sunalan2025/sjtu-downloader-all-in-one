import { execFileSync } from 'node:child_process'
import { existsSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobile = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(mobile)
function run(...args) {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit' })
}
if (!existsSync('android')) run('cap', 'add', 'android')
run('cap', 'sync', 'android')
cpSync('android-overlay', 'android', { recursive: true, force: true })
// Capacitor's stock Android test hardcodes com.getcapacitor.app. It is a
// generated template, not a real project test, and fails for our Beta ID.
// Keep all actual overlay instrumentation tests intact.
const stockTest = 'android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java'
if (existsSync(stockTest)) rmSync(stockTest)
// Keep the installed application ID so existing users can upgrade. The native plugin
// currently lives in the stable desktop-derived package, so use the fully qualified
// registered BridgeActivity name in the generated AndroidManifest.
const manifestPath = 'android/app/src/main/AndroidManifest.xml'
let manifest = readFileSync(manifestPath, 'utf8')
if (manifest.includes('android:name=".MainActivity"')) {
  manifest = manifest.replace('android:name=".MainActivity"', 'android:name="me.hisunalan.sjtudownloader.MainActivity"')
}
if (!manifest.includes('android:enableOnBackInvokedCallback')) {
  // Enable Android 13/14 system predictive-back dispatch while Capacitor
  // backButton handles nested in-app navigation.
  manifest = manifest.replace('<application', '<application android:enableOnBackInvokedCallback="true"')
}
// Register the native Home screen widget in Capacitor's generated manifest.
// Never overwrite the generated manifest (its activities/providers can change).
if (!manifest.includes('android.permission.RECEIVE_BOOT_COMPLETED')) {
  // Normal install-time permission allows recovery of cached widgets on reboot.
  manifest = manifest.replace('<application',
    '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />\n  <application')
}
if (!manifest.includes('android.permission.SCHEDULE_EXACT_ALARM')) {
  // Optional alarms & reminders access. Android 14+ defaults to denied;
  // the user can opt in from widget settings, never at login.
  manifest = manifest.replace('<application',
    '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />\n  <application')
}
for (const permission of ['POST_NOTIFICATIONS', 'ACCESS_NETWORK_STATE']) {
  if (!manifest.includes('android.permission.' + permission)) {
    manifest = manifest.replace('<application',
      '<uses-permission android:name="android.permission.' + permission + '" />\n  <application')
  }
}
if(!manifest.includes('me.hisunalan.sjtudownloader.WidgetMinuteReceiver')){
  manifest=manifest.replace('</application>',`<receiver android:name="me.hisunalan.sjtudownloader.WidgetMinuteReceiver" android:exported="false" />\n</application>`)
}
if (!manifest.includes('me.hisunalan.sjtudownloader.AgendaSyncService')) {
  manifest = manifest.replace('</application>', `
    <service android:name="me.hisunalan.sjtudownloader.AgendaSyncService"
        android:permission="android.permission.BIND_JOB_SERVICE" android:exported="true" />
    <receiver android:name="me.hisunalan.sjtudownloader.AgendaReminderReceiver" android:exported="false">
      <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
        <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
        <action android:name="android.intent.action.TIME_SET" />
        <action android:name="android.intent.action.TIMEZONE_CHANGED" />
        <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" />
      </intent-filter>
    </receiver>
  </application>`)
}
if (!manifest.includes('UpcomingAgendaWidget')) {
  if (!manifest.includes('</application>')) throw new Error('Android application tag missing')
  manifest = manifest.replace('</application>', `
    <receiver android:name="me.hisunalan.sjtudownloader.UpcomingAgendaWidget"
        android:label="SJTU 今日安排 · 2×3" android:exported="true">
      <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
        <action android:name="android.intent.action.DATE_CHANGED"/>
        <action android:name="android.intent.action.TIME_SET"/>
        <action android:name="android.intent.action.TIMEZONE_CHANGED"/>
        <action android:name="android.intent.action.BOOT_COMPLETED"/>
        <action android:name="android.intent.action.MY_PACKAGE_REPLACED"/>
        <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"/>
      </intent-filter>
      <meta-data android:name="android.appwidget.provider"
          android:resource="@xml/upcoming_agenda_widget_info"/>
    </receiver>
  ` + '\n</application>')
}
if (!manifest.includes('TodayScheduleWidgetService')) {
  if (!manifest.includes('</application>')) throw new Error('Android <application> missing')
  manifest = manifest.replace('</application>', `
    <service android:name="me.hisunalan.sjtudownloader.TodayScheduleWidgetService"
        android:exported="false"
        android:permission="android.permission.BIND_REMOTEVIEWS"/>
  ` + '\n</application>')
}

if (!manifest.includes('me.hisunalan.sjtudownloader.WeeklyScheduleWidget')) {
  if (!manifest.includes('</application>')) throw new Error('Android application tag missing')
  manifest = manifest.replace('</application>', `
    <receiver android:name="me.hisunalan.sjtudownloader.WeeklyScheduleWidget"
        android:label="SJTU 本周课表 · 4×6" android:exported="true">
      <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
        <action android:name="android.intent.action.DATE_CHANGED"/>
        <action android:name="android.intent.action.TIME_SET"/>
        <action android:name="android.intent.action.TIMEZONE_CHANGED"/>
        <action android:name="android.intent.action.BOOT_COMPLETED"/>
        <action android:name="android.intent.action.MY_PACKAGE_REPLACED"/>
        <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"/>
      </intent-filter>
      <meta-data android:name="android.appwidget.provider"
          android:resource="@xml/weekly_schedule_widget_info"/>
    </receiver>
    <service android:name="me.hisunalan.sjtudownloader.WeeklyScheduleWidgetService"
        android:exported="false"
        android:permission="android.permission.BIND_REMOTEVIEWS"/>
  ` + '\n</application>')
}
// The obsolete extra provider remains unregistered.
// The larger TodayScheduleWidget remains a shared Java implementation, but
// is intentionally NOT registered as an AppWidgetProvider.
if (manifest.includes('android:name="me.hisunalan.sjtudownloader.TodayScheduleWidget"')) {
  throw new Error('Removed large widget must not appear as an Android receiver')
}
manifest=manifest.replace(/\\n(?=\s*<)/g,'\n')
writeFileSync(manifestPath, manifest)
if (!manifest.includes('android:name="me.hisunalan.sjtudownloader.MainActivity"')) {
  throw new Error('Expected Android launcher activity override is missing')
}
const gradlePath = 'android/app/build.gradle'
let gradle = readFileSync(gradlePath, 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)
const versionCode = major * 10000 + minor * 100 + patch
if (!Number.isInteger(versionCode) || versionCode <= 0) throw new Error('Invalid Android package version')
gradle = gradle.replace(/versionCode\s+\d+/, 'versionCode ' + versionCode)
gradle = gradle.replace(/versionName\s+"[^"]+"/, 'versionName "' + pkg.version + '"')
// One managed block keeps repeated prepare/signing passes deterministic.
// Retain complete native libraries for runtime/instrumentation compatibility.
const managedMarker='// SJTU managed Android build'
const managedAt=[gradle.indexOf(managedMarker),gradle.indexOf('// SJTU optimized Beta')].filter(at=>at>=0).sort((a,b)=>a-b)[0]??-1
if(managedAt>=0)gradle=gradle.slice(0,managedAt)
// Migrate the standalone signing block generated by older prepare versions.
gradle=gradle.replace(/\nandroid \{\n  signingConfigs \{\n    debug \{[\s\S]*?debug \{ signingConfig signingConfigs\.debug \}\n  \}\n\}\n/g,'')
const canonicalDebugStore=join(mobile,'android','app','sjtu-upgrade.keystore')
const hasCanonicalKey=existsSync(canonicalDebugStore)
if(!hasCanonicalKey)console.warn('Upgrade signing key missing; release APK will remain unsigned.')
gradle=gradle.trimEnd()
gradle+=`\n${managedMarker}
android {
  ${hasCanonicalKey?`signingConfigs {
    upgrade {
      storeFile file('sjtu-upgrade.keystore')
      storePassword 'android'
      keyAlias 'androiddebugkey'
      keyPassword 'android'
    }
  }`:''}
  buildTypes {
    release {
      ${hasCanonicalKey?'signingConfig signingConfigs.upgrade':''}
      debuggable false
      jniDebuggable false
      minifyEnabled false
      shrinkResources false
    }
    debug {
      ${hasCanonicalKey?'signingConfig signingConfigs.upgrade':''}
      minifyEnabled false
      shrinkResources false
    }
  }
}
`
writeFileSync(gradlePath, gradle)
const stringsPath='android/app/src/main/res/values/strings.xml'
let strings=readFileSync(stringsPath,'utf8')
strings=strings.replace(/(<string name="(?:app_name|title_activity_main)">)[^<]*(<\/string>)/g,'$1SJTU Downloader$2')
writeFileSync(stringsPath,strings)
// The wrapper's 10s default can expire on a healthy but busy download mirror.
const wrapperPath='android/gradle/wrapper/gradle-wrapper.properties'
let wrapper=readFileSync(wrapperPath,'utf8')
wrapper=/^networkTimeout=/m.test(wrapper)?wrapper.replace(/^networkTimeout=.*$/m,'networkTimeout=30000'):
  wrapper.trimEnd()+'\nnetworkTimeout=30000\n'
writeFileSync(wrapperPath,wrapper)
console.log('Android native sources synchronized, launcher registered, version ' + pkg.version)
