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
 * Native Android home widget with two independent feeds: today classes and
 * upcoming deadlines. The app periodically sends a local-only snapshot; the
 * widget does not request credentials or contact school servers by itself.
 */
public final class TodayScheduleWidget extends AppWidgetProvider {
    private static final String PREFS = "sjtu-today-widget-v1";
    private static final String EVENTS = "events";
    private static final String UPDATED = "updated";
    private static final String ACTION_REFRESH =
        "me.hisunalan.sjtudownloader.WIDGET_REFRESH";
    private static final TimeZone ZONE = TimeZone.getTimeZone("Asia/Shanghai");
    private static final long MINUTE = 60_000L;
    private static final long DAY = 24L * 60L * MINUTE;
    private static final long DEADLINE_HORIZON = 14 * DAY;

    private static final class Item {
        final long start;
        final long end;
        final String title;
        final String place;
        final boolean deadline;
        Item(long start, long end, String title, String place, boolean deadline) {
            this.start = start;
            this.end = end;
            this.title = title;
            this.place = place;
            this.deadline = deadline;
        }
    }

    /** Do not replace a valid saved school timetable with a transient empty
     * React render while the asynchronous session/calendar is still loading. */
    public static void persist(Context context, JSONArray incoming, boolean clear) {
        JSONArray safe = new JSONArray();
        int limit = Math.min(incoming.length(), 350);
        for (int i = 0; i < limit; i++) {
            JSONObject event = incoming.optJSONObject(i);
            if (event == null) continue;
            long start = event.optLong("startMs", 0);
            long end = event.optLong("endMs", 0);
            String title = event.optString("title", "").trim();
            if (start <= 0 || end < start || title.isEmpty()) continue;
            JSONObject clean = new JSONObject();
            try {
                clean.put("startMs", start);
                clean.put("endMs", end);
                clean.put("title", title.substring(0, Math.min(title.length(), 100)));
                String place = event.optString("location", "");
                clean.put("location", place.substring(0, Math.min(place.length(), 85)));
                clean.put("kind", "deadline".equals(event.optString("kind", "")) ?
                    "deadline" : "course");
                safe.put(clean);
            } catch (Exception ignored) {}
        }
        if (safe.length() > 0 || clear) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(EVENTS, safe.toString())
                .putLong(UPDATED, System.currentTimeMillis()).apply();
        }
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

    private static ArrayList<Item> load(Context context) {
        ArrayList<Item> events = new ArrayList<>();
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray saved = new JSONArray(preferences.getString(EVENTS, "[]"));
            for (int index = 0; index < saved.length(); index++) {
                JSONObject event = saved.optJSONObject(index);
                if (event == null) continue;
                long start = event.optLong("startMs", 0L);
                long end = event.optLong("endMs", 0L);
                String title = event.optString("title", "").trim();
                if (start <= 0 || end < start || title.isEmpty()) continue;
                events.add(new Item(start, end, title,
                    event.optString("location", "").trim(),
                    "deadline".equals(event.optString("kind", "course"))));
            }
        } catch (Exception ignored) {}
        events.sort(Comparator.comparingLong(item -> item.start));
        return events;
    }

    private static String format(long value, String pattern) {
        SimpleDateFormat formatter = new SimpleDateFormat(pattern, Locale.CHINA);
        formatter.setTimeZone(ZONE);
        return formatter.format(new Date(value));
    }

    private static String remaining(long millis) {
        long minutes = Math.max(1L, (millis + MINUTE - 1L) / MINUTE);
        if (minutes >= 60L) {
            return (minutes / 60L) + "小时" +
                (minutes % 60L == 0 ? "" : (minutes % 60L) + "分");
        }
        return minutes + "分钟";
    }

    private static String deadlineDescription(Item item, long midnight, long tomorrow) {
        String prefix = item.start < tomorrow ? "今天" :
            item.start < tomorrow + DAY ? "明天" : format(item.start, "M/d");
        return prefix + " " + format(item.start, "HH:mm") + "  ·  " + item.title;
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
        // Android 12+ restricts exact alarms; approximate countdowns use a
        // normal while-idle alarm and may be delayed by battery-saving policy.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, pending);
        } else {
            alarms.set(AlarmManager.RTC_WAKEUP, millis, pending);
        }
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        long now = System.currentTimeMillis();
        Calendar dayClock = Calendar.getInstance(ZONE);
        dayClock.setTimeInMillis(now);
        dayClock.set(Calendar.HOUR_OF_DAY, 0);
        dayClock.set(Calendar.MINUTE, 0);
        dayClock.set(Calendar.SECOND, 0);
        dayClock.set(Calendar.MILLISECOND, 0);
        long midnight = dayClock.getTimeInMillis();
        dayClock.add(Calendar.DAY_OF_YEAR, 1);
        long tomorrow = dayClock.getTimeInMillis();

        ArrayList<Item> saved = load(context);
        ArrayList<Item> classes = new ArrayList<>();
        ArrayList<Item> deadlines = new ArrayList<>();
        for (Item item : saved) {
            if (item.deadline) {
                if (item.start >= now && item.start <= now + DEADLINE_HORIZON) {
                    deadlines.add(item);
                }
            } else if (item.start >= midnight && item.start < tomorrow) {
                classes.add(item);
            }
        }
        // load() sorted all events chronologically; retain that order in each
        // independent feed rather than mixing deadlines into class slots.
        Item current = null;
        Item next = null;
        int completed = 0;
        for (Item item : classes) {
            if (item.end <= now) {
                completed++;
            } else if (item.start <= now) {
                if (current == null || item.start > current.start) current = item;
            } else if (next == null) {
                next = item;
            }
        }

        String badge;
        String title;
        String detail;
        String nextLine;
        if (current != null) {
            badge = "● 正在上课 · 距下课 " + remaining(current.end - now);
            title = current.title;
            detail = format(current.start, "HH:mm") + "–" + format(current.end, "HH:mm") +
                (current.place.isEmpty() ? "" : "  ·  " + current.place);
            nextLine = next == null ? "今天最后一节 · 专注当下" :
                "下一节 " + format(next.start, "HH:mm") + "  " + next.title;
        } else if (next != null) {
            badge = next.start - now <= 15L * MINUTE
                ? "● 即将上课 · 还有 " + remaining(next.start - now)
                : "下一节课 · " + format(next.start, "HH:mm");
            title = next.title;
            detail = format(next.start, "HH:mm") + "–" + format(next.end, "HH:mm") +
                (next.place.isEmpty() ? "" : "  ·  " + next.place);
            nextLine = "今日 " + classes.size() + " 节 · 已完成 " + completed + " 节";
        } else {
            badge = saved.isEmpty() ? "打开应用同步课表" :
                classes.isEmpty() ? "今日暂无课程" : "✓ 今天的课程已结束";
            title = classes.isEmpty() ? "今天没有安排课程" : "今日课程已完成";
            detail = classes.isEmpty() ? "点击组件打开应用获取最新课表" : "好好休息，准备下一程";
            nextLine = classes.isEmpty() ? "同步后自动显示当前与下一节课" :
                "今天共 " + classes.size() + " 节课";
        }

        String deadlineLabel = "近期 DEADLINE  ·  " + deadlines.size() + " 项";
        String firstDeadline = deadlines.size() > 0
            ? deadlineDescription(deadlines.get(0), midnight, tomorrow)
            : "近期暂无待截止作业";
        String secondDeadline = deadlines.size() > 1
            ? deadlineDescription(deadlines.get(1), midnight, tomorrow) : "";

        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openApp = PendingIntent.getActivity(context, 7002, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.today_schedule_widget);
            view.setTextViewText(R.id.widget_date, format(now, "M月d日 E"));
            view.setTextViewText(R.id.widget_badge, badge);
            view.setTextViewText(R.id.widget_title, title);
            view.setTextViewText(R.id.widget_detail, detail);
            view.setTextViewText(R.id.widget_next, nextLine);
            view.setTextViewText(R.id.widget_deadline_label, deadlineLabel);
            view.setTextViewText(R.id.widget_deadline_one, firstDeadline);
            view.setTextViewText(R.id.widget_deadline_two, secondDeadline);
            view.setViewVisibility(R.id.widget_deadline_two, secondDeadline.isEmpty() ?
                android.view.View.GONE : android.view.View.VISIBLE);
            view.setOnClickPendingIntent(R.id.widget_root, openApp);
            manager.updateAppWidget(id, view);
        }

        long upcoming = tomorrow + MINUTE;
        for (Item item : classes) {
            long[] moments = {item.start - 15L * MINUTE, item.start, item.end};
            for (long moment : moments) {
                if (moment > now + MINUTE) upcoming = Math.min(upcoming, moment);
            }
        }
        for (Item item : deadlines) {
            long[] moments = {item.start - DAY, item.start - 3L * 60L * MINUTE, item.start};
            for (long moment : moments) {
                if (moment > now + MINUTE) upcoming = Math.min(upcoming, moment);
            }
        }
        if (current != null || (next != null && next.start - now < 45L * MINUTE)) {
            upcoming = Math.min(upcoming, now + 10L * MINUTE);
        }
        scheduleRefresh(context, Math.max(now + MINUTE, upcoming));
    }
}
