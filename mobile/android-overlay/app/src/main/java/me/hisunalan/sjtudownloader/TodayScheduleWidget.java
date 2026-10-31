package me.hisunalan.sjtudownloader;

import me.hisunalan.sjtudownloader.beta.R;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * A real Android launcher widget. It works from locally cached, explicitly
 * synchronized course times (not a background login) and never stores tokens.
 * Android may defer inexact updates while sleeping; no exact-alarm permission.
 */
public final class TodayScheduleWidget extends AppWidgetProvider {
    private static final String PREFS = "sjtu-today-widget-v1";
    private static final String EVENTS = "events";
    private static final String ACTION_REFRESH =
        "me.hisunalan.sjtudownloader.WIDGET_REFRESH";
    private static final TimeZone ZONE = TimeZone.getTimeZone("Asia/Shanghai");

    private static final class Item {
        final long start;
        final long end;
        final String title;
        final String place;
        Item(long start, long end, String title, String place) {
            this.start = start;
            this.end = end;
            this.title = title;
            this.place = place;
        }
    }

    /** Called when app calendars or custom events change. Safe without widgets. */
    public static void persist(Context context, JSONArray incoming) {
        JSONArray safe = new JSONArray();
        int limit = Math.min(incoming.length(), 300);
        for (int i = 0; i < limit; i++) {
            JSONObject event = incoming.optJSONObject(i);
            if (event == null) continue;
            long start = event.optLong("startMs", 0);
            long end = event.optLong("endMs", 0);
            String title = event.optString("title", "").trim();
            if (start <= 0 || end <= start || title.isEmpty()) continue;
            // Store only non-sensitive display data and small bounded strings.
            JSONObject clean = new JSONObject();
            try {
                clean.put("startMs", start);
                clean.put("endMs", end);
                clean.put("title", title.substring(0, Math.min(title.length(), 100)));
                String place = event.optString("location", "");
                clean.put("location", place.substring(0, Math.min(place.length(), 85)));
                safe.put(clean);
            } catch (Exception ignored) {}
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(EVENTS, safe.toString()).apply();
        refresh(context);
    }

    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayScheduleWidget.class));
        if (ids.length == 0) {
            cancelScheduledRefresh(context);
            return;
        }
        render(context, manager, ids);
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context, manager, ids);
    }

    @Override public void onEnabled(Context context) {
        refresh(context);
    }

    @Override public void onDisabled(Context context) {
        cancelScheduledRefresh(context);
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent == null ? null : intent.getAction();
        if (ACTION_REFRESH.equals(action) ||
            Intent.ACTION_DATE_CHANGED.equals(action) ||
            Intent.ACTION_TIME_CHANGED.equals(action) ||
            Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            refresh(context);
        }
    }

    private static ArrayList<Item> loadToday(Context context, long todayStart, long tomorrowStart) {
        ArrayList<Item> result = new ArrayList<>();
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray saved = new JSONArray(preferences.getString(EVENTS, "[]"));
            for (int index = 0; index < saved.length(); index++) {
                JSONObject event = saved.optJSONObject(index);
                if (event == null) continue;
                long start = event.optLong("startMs", 0L);
                long end = event.optLong("endMs", 0L);
                if (start < todayStart || start >= tomorrowStart || end <= start) continue;
                String title = event.optString("title", "").trim();
                if (title.isEmpty()) continue;
                result.add(new Item(start, end, title, event.optString("location", "").trim()));
            }
        } catch (Exception ignored) {}
        result.sort(Comparator.comparingLong(item -> item.start));
        return result;
    }

    private static String clock(long value) {
        SimpleDateFormat format = new SimpleDateFormat("HH:mm", Locale.CHINA);
        format.setTimeZone(ZONE);
        return format.format(new Date(value));
    }

    private static String day(long now) {
        SimpleDateFormat format = new SimpleDateFormat("M月d日 E", Locale.CHINA);
        format.setTimeZone(ZONE);
        return format.format(new Date(now));
    }

    private static String remaining(long timeMillis) {
        long minutes = Math.max(1L, (timeMillis + 59_999L) / 60_000L);
        return minutes >= 60L
            ? (minutes / 60L) + "小时" + (minutes % 60L == 0 ? "" : (minutes % 60L) + "分")
            : minutes + "分钟";
    }

    private static PendingIntent refreshIntent(Context context) {
        Intent intent = new Intent(context, TodayScheduleWidget.class);
        intent.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 7001, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelScheduledRefresh(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(refreshIntent(context));
    }

    private static void scheduleRefresh(Context context, long millis) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent pending = refreshIntent(context);
        alarms.cancel(pending);
        // Inexact while-idle alarms need no special exact-alarm permission and
        // are allowed to run after the app is swiped away, but can be delayed.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, pending);
        } else {
            alarms.set(AlarmManager.RTC_WAKEUP, millis, pending);
        }
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        long now = System.currentTimeMillis();
        Calendar clock = Calendar.getInstance(ZONE);
        clock.setTimeInMillis(now);
        clock.set(Calendar.HOUR_OF_DAY, 0);
        clock.set(Calendar.MINUTE, 0);
        clock.set(Calendar.SECOND, 0);
        clock.set(Calendar.MILLISECOND, 0);
        long midnight = clock.getTimeInMillis();
        clock.add(Calendar.DAY_OF_YEAR, 1);
        long tomorrow = clock.getTimeInMillis();

        ArrayList<Item> events = loadToday(context, midnight, tomorrow);
        Item current = null;
        Item next = null;
        int completed = 0;
        for (Item item : events) {
            if (item.end <= now) {
                completed++;
            } else if (item.start <= now) {
                // Prefer the course with the closest start in rare overlaps.
                if (current == null || item.start > current.start) current = item;
            } else if (next == null) {
                next = item;
            }
        }

        String badge;
        String title;
        String detail;
        String footer;
        if (current != null) {
            badge = "● 正在上课  ·  距下课 " + remaining(current.end - now);
            title = current.title;
            detail = clock(current.start) + "–" + clock(current.end) +
                (current.place.isEmpty() ? "" : "  ·  " + current.place);
            footer = next != null ? "下一节  " + clock(next.start) + "  " + next.title
                : "今天最后一节  ·  专注当下";
        } else if (next != null) {
            badge = next.start - now <= 15L * 60_000L
                ? "● 即将上课  ·  还有 " + remaining(next.start - now)
                : "下一节课  ·  " + clock(next.start);
            title = next.title;
            detail = clock(next.start) + "–" + clock(next.end) +
                (next.place.isEmpty() ? "" : "  ·  " + next.place);
            footer = "今日 " + events.size() + " 节  ·  已完成 " + completed + " 节";
        } else {
            badge = events.isEmpty() ? "尚未同步今日课程" : "✓ 今天的课程已结束";
            title = events.isEmpty() ? "今天暂无课程" : "课程已完成";
            detail = events.isEmpty() ? "打开应用同步课表" : "今天辛苦啦";
            footer = events.isEmpty() ? "点击卡片进入 SJTU Downloader"
                : "共 " + events.size() + " 节课程  ·  明天见";
        }

        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openApp = PendingIntent.getActivity(context, 7002, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.today_schedule_widget);
            view.setTextViewText(R.id.widget_date, day(now));
            view.setTextViewText(R.id.widget_badge, badge);
            view.setTextViewText(R.id.widget_title, title);
            view.setTextViewText(R.id.widget_detail, detail);
            view.setTextViewText(R.id.widget_footer, footer);
            view.setOnClickPendingIntent(R.id.widget_root, openApp);
            manager.updateAppWidget(id, view);
        }

        // Midnight changes the selected day. Further updates are scheduled at
        // the class 15-minute reminder boundary, start and end, plus lightweight
        // countdown refreshes. OEM power management may delay delivery.
        long upcoming = tomorrow + 60_000L;
        for (Item item : events) {
            long[] moments = { item.start - 15L * 60_000L, item.start, item.end };
            for (long moment : moments) {
                if (moment > now + 60_000L) upcoming = Math.min(upcoming, moment);
            }
        }
        if (current != null || (next != null && next.start - now < 45L * 60_000L)) {
            upcoming = Math.min(upcoming, now + 10L * 60_000L);
        }
        scheduleRefresh(context, Math.max(now + 60_000L, upcoming));
    }
}
