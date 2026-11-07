package me.hisunalan.sjtudownloader;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Calendar;
import java.util.Map;

/** One next-event alarm, on-device reminders and a bounded deduplication ledger.
 * This class never connects to the network or starts a foreground service. */
final class AgendaNotifications {
    static final String ACTION = "me.hisunalan.sjtudownloader.AGENDA_REMINDER";
    static final String CHANNEL = "sjtu-agenda-reminders-v1";
    static final String QUIET_CHANNEL = "sjtu-agenda-quiet-v1";
    static final long GRACE = 15 * 60_000L;
    private static final int ALARM_ID = 7360;
    static String category(TodayScheduleWidget.Item item) {
        if (item.assignment) return "homework";
        String kind = item.category;
        return "exam".equals(kind) || "homework".equals(kind) || "event".equals(kind)
            ? kind : "course";
    }
    static String label(String kind) {
        return "exam".equals(kind) ? "考试" : "homework".equals(kind) ? "作业截止"
            : "event".equals(kind) ? "日程" : "课程";
    }
    static boolean permitted(Context context) {
        return (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context,
            Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && NotificationManagerCompat.from(context).areNotificationsEnabled();
    }
    static void channels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel main = new NotificationChannel(CHANNEL, "课程与日程提醒",
            NotificationManager.IMPORTANCE_DEFAULT);
        main.setDescription("课程、个人日程、考试与作业的本地提醒");
        main.enableVibration(true);
        manager.createNotificationChannel(main);
        NotificationChannel quiet = new NotificationChannel(QUIET_CHANNEL, "免打扰静默提醒",
            NotificationManager.IMPORTANCE_LOW);
        quiet.setDescription("免打扰时段仅在通知栏显示，不请求提示音或振动");
        quiet.setSound(null, null); quiet.enableVibration(false);
        manager.createNotificationChannel(quiet);
        manager.deleteNotificationChannel("sjtu-agenda-test-v1");
    }
    static boolean channelAllowed(Context context) {
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel channel = context.getSystemService(NotificationManager.class)
            .getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    static boolean canEnable(Context context) {
        return permitted(context) && channelAllowed(context);
    }
    /** Clear a stale enabled flag without discarding timing or sync choices.
     * Granting OS permission alone must never re-enable reminders. */
    static synchronized JSObject validatedSettings(Context context, boolean allowed) {
        JSObject settings=AgendaPreferences.read(context);
        if(settings.optBoolean("enabled")&&!allowed){
            AgendaPreferences.store(context).edit().putBoolean("enabled",false).putLong("nextReminderAt",0).commit();
            ((AlarmManager)context.getSystemService(Context.ALARM_SERVICE)).cancel(alarmIntent(context));
            settings.put("enabled",false);
        }
        return settings;
    }
    static boolean quietAt(long time, JSONObject settings) {
        if (!settings.optBoolean("quietEnabled", true)) return false;
        int start = settings.optInt("quietStart", 1320), end = settings.optInt("quietEnd", 480);
        if (start == end) return false;
        Calendar c = Calendar.getInstance(TodayScheduleWidget.ZONE);
        c.setTimeInMillis(time);
        int minute = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        return start < end ? minute >= start && minute < end : minute >= start || minute < end;
    }
    static long eventTime(TodayScheduleWidget.Item item, JSONObject settings) {
        if (!item.allDay) return item.start;
        Calendar c = Calendar.getInstance(TodayScheduleWidget.ZONE);
        c.setTimeInMillis(item.start);
        c.set(Calendar.HOUR_OF_DAY, settings.optInt("allDayHour", 9));
        c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }
    static long reminderTime(TodayScheduleWidget.Item item, JSONObject settings) {
        String kind = category(item);
        if (!settings.optBoolean(kind + "Enabled", true)) return -1;
        return eventTime(item, settings) - settings.optInt(kind + "Minutes", 10) * 60_000L;
    }
    static boolean due(TodayScheduleWidget.Item item, JSONObject settings, long now) {
        long at = reminderTime(item, settings);
        return at > 0 && now >= at && now - at <= GRACE
            && eventTime(item, settings) + GRACE >= now
            && (!"skip".equals(settings.optString("quietMode", "silent"))
                || !quietAt(at, settings) && !quietAt(now, settings));
    }
    static String key(TodayScheduleWidget.Item item) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                (category(item) + "|" + item.title + "|" + item.start + "|" + item.courseName).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte value : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            return hex.toString();
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, AgendaReminderReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(context, ALARM_ID, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static synchronized void refresh(Context context, boolean deliver) {
        channels(context);
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        alarm.cancel(alarmIntent(context));
        android.content.SharedPreferences prefs = AgendaPreferences.store(context);
        prefs.edit().putLong("nextReminderAt", 0).apply();
        JSONObject settings = validatedSettings(context,canEnable(context));
        if (!settings.optBoolean("enabled")) return;
        long now = System.currentTimeMillis(), next = Long.MAX_VALUE;
        android.content.SharedPreferences.Editor ledger = prefs.edit();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet())
            if (entry.getKey().startsWith("sent.") && entry.getValue() instanceof Long
                && now - (Long) entry.getValue() > 30 * TodayScheduleWidget.DAY)
                ledger.remove(entry.getKey());
        int count = 0;
        for (TodayScheduleWidget.Item item : TodayScheduleWidget.load(context)) {
            long at = reminderTime(item, settings);
            String id = key(item);
            if (at < 0 || "skip".equals(settings.optString("quietMode", "silent")) && quietAt(at, settings)
                    || prefs.contains("sent." + id)) continue;
            if (at > now) next = Math.min(next, at);
            else if (deliver && due(item, settings, now) && count < 20) {
                if (post(context, item, settings)) {
                    ledger.putLong("sent." + id, now); count++;
                }
            }
        }
        ledger.commit();
        if (next == Long.MAX_VALUE) return;
        try {
            if (TodayScheduleWidget.canScheduleExact(context))
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarmIntent(context));
            else alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarmIntent(context));
        } catch (SecurityException denied) {
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarmIntent(context));
        }
        prefs.edit().putLong("nextReminderAt", next).apply();
    }
    static boolean post(Context context, TodayScheduleWidget.Item item, JSONObject settings) {
        if (!permitted(context)) return false;
        channels(context);
        String kind = category(item);
        boolean show = settings.optBoolean("showContent", true);
        String title = show ? SchedulePresentation.title(item) : "你有一项" + label(kind) + "提醒";
        String text = show ? label(kind) + " · " + TodayScheduleWidget.format(item.start, item.allDay ? "M月d日 全天" : "M月d日 HH:mm")
                + (item.place.isEmpty() ? "" : " · " + item.place) : "打开应用查看日程详情";
        Intent open = new Intent(context, MainActivity.class)
            .setData(Uri.parse("sjtu-agenda://notification/" + key(item)))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, key(item).hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean quiet = (quietAt(System.currentTimeMillis(), settings) || quietAt(reminderTime(item, settings), settings));
        String channel = quiet ? QUIET_CHANNEL : CHANNEL;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(me.hisunalan.sjtudownloader.beta.R.drawable.ic_agenda_notification)
            .setColor(0xff356ac3).setContentTitle(title).setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(true).setSilent(quiet)
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setVisibility(settings.optBoolean("lockScreenDetails", false)
                ? NotificationCompat.VISIBILITY_PUBLIC : NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(context, channel)
                .setSmallIcon(me.hisunalan.sjtudownloader.beta.R.drawable.ic_agenda_notification)
                .setContentTitle("SJTU 日程提醒").setContentText("解锁后查看详情").build());
        try {
            NotificationManagerCompat.from(context).notify(key(item), 7361, builder.build());
            return true;
        } catch (SecurityException denied) { return false; }
    }
    static JSObject status(Context context) {
        channels(context);
        JSObject out = new JSObject();
        out.put("settings", validatedSettings(context,canEnable(context)));
        out.put("permissionGranted", permitted(context));
        out.put("channelEnabled", channelAllowed(context));
        out.put("exactAlarmAllowed", TodayScheduleWidget.canScheduleExact(context));
        out.put("nextReminderAt", AgendaPreferences.store(context).getLong("nextReminderAt", 0));
        out.put("cachedEvents", TodayScheduleWidget.load(context).size());
        out.put("lastSyncAt", AgendaPreferences.store(context).getLong("lastSyncAt", 0));
        out.put("lastSyncSuccessAt", AgendaPreferences.store(context).getLong("lastSyncSuccessAt", 0));
        out.put("syncState", AgendaPreferences.store(context).getString("syncState", "idle"));
        out.put("jobScheduled", AgendaSyncService.scheduled(context));
        return out;
    }
}
