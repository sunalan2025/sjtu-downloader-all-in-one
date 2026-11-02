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
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;
import com.getcapacitor.JSObject;
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
 * Minimal, vertically scrollable full-day calendar widget. All cached
 * courses, homework deadlines, exams and personal events remain accessible
 * within the launcher. Day arrows navigate each instance independently;
 * no calendar row or container opens the application.
 *
 * Shares this renderer with the smaller legacy UpcomingAgendaWidget.
 * Never runs background school authentication or requires storage permission.
 */
public final class TodayScheduleWidget extends AppWidgetProvider {
    static final String PREFS = "sjtu-today-widget-v1";
    private static final String EVENTS = "events";
    private static final String UPDATED = "updated";
    private static final String OFFSET = "day-offset-";
    private static final String ACTION_REFRESH =
        "me.hisunalan.sjtudownloader.WIDGET_REFRESH";
    private static final String ACTION_PAGE =
        "me.hisunalan.sjtudownloader.WIDGET_DAY_PAGE";
    static final TimeZone ZONE = TimeZone.getTimeZone("Asia/Shanghai");
    static final long MINUTE = 60_000L;
    static final long DAY = 24L * 60L * MINUTE;
    static final long DEADLINE_HORIZON = 14 * DAY;

    static final class Item {
        final long start;
        final long end;
        final String title;
        final String place;
        final boolean deadline;
        final String category;
        final boolean allDay;
        Item(long start, long end, String title, String place,
             boolean deadline, String category, boolean allDay) {
            this.start = start;
            this.end = end;
            this.title = title;
            this.place = place;
            this.deadline = deadline;
            this.category = category;
            this.allDay = allDay;
        }
    }

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Called on explicit login/logout and calendar changes. A loading screen
     * must not replace previously synchronized data with an empty snapshot. */
    public static void persist(Context context, JSONArray incoming, boolean clear) {
        JSONArray safe = new JSONArray();
        for (int i = 0; i < Math.min(incoming.length(), 350); i++) {
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
                String location = event.optString("location", "");
                clean.put("location", location.substring(0, Math.min(location.length(), 85)));
                clean.put("kind", "deadline".equals(event.optString("kind", ""))
                    ? "deadline" : "course");
                clean.put("allDay", event.optBoolean("allDay", false));
                String category = event.optString("category", "");
                clean.put("category", "exam".equals(category) ? "exam"
                    : "homework".equals(category) ? "homework"
                    : "event".equals(category) ? "event" : "course");
                safe.put(clean);
            } catch (Exception ignored) {}
        }
        if (safe.length() > 0 || clear) {
            preferences(context).edit()
                .putString(EVENTS, safe.toString())
                .putLong(UPDATED, System.currentTimeMillis()).apply();
        }
        refresh(context);
    }

    static ArrayList<Item> load(Context context) {
        ArrayList<Item> items = new ArrayList<>();
        try {
            JSONArray data = new JSONArray(preferences(context).getString(EVENTS, "[]"));
            for (int i = 0; i < data.length(); i++) {
                JSONObject item = data.optJSONObject(i);
                if (item == null) continue;
                long start = item.optLong("startMs", 0);
                long end = item.optLong("endMs", 0);
                String title = item.optString("title", "").trim();
                if (start <= 0 || end < start || title.isEmpty()) continue;
                items.add(new Item(start, end, title,
                    item.optString("location", "").trim(),
                    "deadline".equals(item.optString("kind", "")),
                    item.optString("category", ""),
                    item.optBoolean("allDay",false)));
            }
        } catch (Exception ignored) {}
        items.sort(Comparator.comparingLong(item -> item.start));
        return items;
    }

    static String format(long millis, String pattern) {
        SimpleDateFormat date = new SimpleDateFormat(pattern, Locale.CHINA);
        date.setTimeZone(ZONE);
        return date.format(new Date(millis));
    }

    static long midnight(long now, int offset) {
        Calendar calendar = Calendar.getInstance(ZONE);
        calendar.setTimeInMillis(now);
        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        calendar.add(Calendar.DAY_OF_YEAR, offset);
        return calendar.getTimeInMillis();
    }

    private static PendingIntent pageIntent(Context context, int id, int direction) {
        Intent intent = new Intent(context, TodayScheduleWidget.class);
        intent.setAction(ACTION_PAGE);
        intent.setData(Uri.parse("sjtu-widget://page/" + id + "/" + direction));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        intent.putExtra("step", direction);
        return PendingIntent.getBroadcast(context, id * 4 + (direction > 0 ? 1 : 2),
            intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayScheduleWidget.class));
        if (ids.length > 0) render(context, manager, ids);
        else cancelAlarm(context);
        // Both cards consume the same locally synchronized event snapshot.
        UpcomingAgendaWidget.refresh(context);
    }

    public static JSObject status(Context context) {
        JSObject status = new JSObject();
        int classes = 0, deadlines = 0;
        for (Item event : load(context)) {
            if (event.deadline) deadlines++; else classes++;
        }
        int count = 0;
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            count = manager.getAppWidgetIds(new ComponentName(context, TodayScheduleWidget.class)).length
                + manager.getAppWidgetIds(new ComponentName(context, UpcomingAgendaWidget.class)).length;
        } catch (Exception ignored) {}
        SharedPreferences prefs = preferences(context);
        status.put("instances", count);
        status.put("courses", classes);
        status.put("deadlines", deadlines);
        status.put("updatedAt", prefs.getLong(UPDATED, 0));
        status.put("lastRenderAt", prefs.getLong("lastRenderAt", 0));
        status.put("lastRenderedInstances", prefs.getInt("lastRenderedInstances", 0)
            + prefs.getInt("agendaRenderedInstances", 0));
        status.put("lastRenderError", prefs.getString("lastRenderError", "")
            + prefs.getString("agendaRenderError", ""));
        status.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        android.os.PowerManager power = (android.os.PowerManager)
            context.getSystemService(Context.POWER_SERVICE);
        status.put("ignoringBatteryOptimizations", power != null &&
            power.isIgnoringBatteryOptimizations(context.getPackageName()));
        return status;
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context, manager, ids);
    }
    @Override public void onEnabled(Context context) { refresh(context); }
    @Override public void onDisabled(Context context) { refresh(context); }
    static void forgetOffsets(Context context,int[] ids) {
        SharedPreferences.Editor editor = preferences(context).edit();
        for (int id : ids) editor.remove(OFFSET + id);
        editor.apply();
    }
    @Override public void onDeleted(Context context, int[] ids) {
        forgetOffsets(context,ids);
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PAGE.equals(action)) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            int step = intent.getIntExtra("step", 0);
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            boolean mainWidget = false, compactWidget = false;
            for (int live : manager.getAppWidgetIds(new ComponentName(context,
                    TodayScheduleWidget.class))) if (live == id) mainWidget = true;
            for (int live : manager.getAppWidgetIds(new ComponentName(context,
                    UpcomingAgendaWidget.class))) if (live == id) compactWidget = true;
            if ((!mainWidget && !compactWidget) || (step != -1 && step != 1)) return;
            SharedPreferences prefs = preferences(context);
            int next = Math.max(-7, Math.min(21, prefs.getInt(OFFSET + id, 0) + step));
            prefs.edit().putInt(OFFSET + id, next).apply();
            if (compactWidget) renderAgenda(context, manager, new int[]{id});
            else render(context,manager,new int[]{id});
        } else if (ACTION_REFRESH.equals(action) ||
            Intent.ACTION_DATE_CHANGED.equals(action) ||
            Intent.ACTION_TIME_CHANGED.equals(action) ||
            Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            refresh(context);
        }
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, TodayScheduleWidget.class);
        intent.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 7290, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelAlarm(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm != null) alarm.cancel(alarmIntent(context));
    }

    private static void schedule(Context context, long at) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        PendingIntent intent = alarmIntent(context);
        alarm.cancel(intent);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
        else alarm.set(AlarmManager.RTC_WAKEUP, at, intent);
    }

    /** This is one complete day's cached schedule, not just the first 3
     * lessons: includes ordinary classes, personal events, homework and exams. */
    static ArrayList<Item> itemsForDay(Context context, int id) {
        int offset = Math.max(-7, Math.min(21,
            preferences(context).getInt(OFFSET + id, 0)));
        long now = System.currentTimeMillis();
        long start = midnight(now, offset);
        long finish = midnight(now, offset + 1);
        ArrayList<Item> found = new ArrayList<>();
        for (Item item : load(context)) {
            if (item.start >= start && item.start < finish) found.add(item);
        }
        found.sort(Comparator.comparingLong(item -> item.start));
        return found;
    }

    static RemoteViews rowView(Context context, Item item) {
        RemoteViews view = new RemoteViews(context.getPackageName(),
            R.layout.today_schedule_widget_row);
        String kind = "exam".equals(item.category) ? "考试"
            : "homework".equals(item.category) ? "作业"
            : "event".equals(item.category) ? "日程" : "课程";
        String time;
        if (item.allDay) {
            time = item.deadline ? "当天截止" : "全天";
        } else if (item.deadline) {
            time = format(item.start,"HH:mm") +
                ("exam".equals(item.category) ? " 考试" : " 截止");
        } else {
            time = format(item.start,"HH:mm");
            if (item.end > item.start && item.end-item.start <= DAY)
                time += "–" + format(item.end,"HH:mm");
        }
        view.setTextViewText(R.id.widget_row_time, time + " · " + kind);
        view.setTextViewText(R.id.widget_row_title, item.title);
        if (item.place.isEmpty()) {
            view.setViewVisibility(R.id.widget_row_place,View.GONE);
        } else {
            view.setTextViewText(R.id.widget_row_place,item.place);
            view.setViewVisibility(R.id.widget_row_place,View.VISIBLE);
        }
        int color = "exam".equals(item.category)
            ? android.graphics.Color.rgb(135,83,153)
            : "homework".equals(item.category)
                ? android.graphics.Color.rgb(152,104,48)
                : android.graphics.Color.rgb(66,111,163);
        view.setTextColor(R.id.widget_row_time,color);
        return view;
    }

    // API 31+ offers an in-process collection adapter: no cold-start latency
    // for a separate RemoteViewsService and no onDataSetChanged race.
    // The service fallback supports devices running Android 11 and earlier.
    private static void attachList(Context context, RemoteViews view, int id,
                                   ArrayList<Item> items) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            RemoteViews.RemoteCollectionItems.Builder collection =
                new RemoteViews.RemoteCollectionItems.Builder()
                    .setHasStableIds(true).setViewTypeCount(1);
            for (int i=0;i<items.size();i++) {
                collection.addItem(i,rowView(context,items.get(i)));
            }
            view.setRemoteAdapter(R.id.widget_list,collection.build());
        } else {
            Intent intent = new Intent(context,TodayScheduleWidgetService.class);
            intent.setData(Uri.parse("sjtu-widget://list/"+id));
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);
            view.setRemoteAdapter(R.id.widget_list,intent);
        }
        view.setEmptyView(R.id.widget_list,R.id.widget_empty);
    }

    static void renderAgenda(Context context, AppWidgetManager manager, int[] ids) {
        render(context,manager,ids,true);
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        render(context,manager,ids,false);
    }

    private static void render(Context context, AppWidgetManager manager,
                               int[] ids,boolean compact) {
        long now = System.currentTimeMillis();
        ArrayList<Item> all = load(context);
        SharedPreferences prefs = preferences(context);
        int success = 0;
        String failure = "";
        for (int id : ids) {
            int offset = Math.max(-7, Math.min(21, prefs.getInt(OFFSET + id, 0)));
            long day = midnight(now, offset);
            ArrayList<Item> items = itemsForDay(context,id);
            try {
                RemoteViews view = new RemoteViews(context.getPackageName(),
                    R.layout.today_schedule_widget);
                view.setTextViewText(R.id.widget_date,format(day,"M/d E"));
                view.setTextViewText(R.id.widget_badge,items.size()+" 项");
                view.setTextViewText(R.id.widget_empty,
                    all.isEmpty() ? "暂无已同步安排" : "这一天暂无安排");
                attachList(context,view,id,items);
                // A new date starts at the top of the scrollable day's list.
                // Updating school data keeps the actual rows intact; no row
                // clicks or collection PendingIntent templates are installed.
                // Only these arrows navigate. No app-launch PendingIntent on
                // the root or list rows, so scrolling never opens the app.
                view.setOnClickPendingIntent(R.id.widget_prev,pageIntent(context,id,-1));
                view.setOnClickPendingIntent(R.id.widget_next,pageIntent(context,id,1));
                manager.updateAppWidget(id,view);
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                    manager.notifyAppWidgetViewDataChanged(new int[]{id},R.id.widget_list);
                }
                success++;
            } catch (Exception error) {
                failure = error.getClass().getSimpleName();
                try {
                    RemoteViews fallback = new RemoteViews(context.getPackageName(),
                        R.layout.today_schedule_widget_fallback);
                    fallback.setTextViewText(R.id.widget_fallback_message,
                        "组件暂时无法显示日程，打开应用同步后会重试");
                    manager.updateAppWidget(id,fallback);
                    success++;
                } catch (Exception fallbackError) {
                    failure += "/" + fallbackError.getClass().getSimpleName();
                }
            }
        }
        SharedPreferences.Editor report = prefs.edit();
        if (compact) report.putInt("agendaRenderedInstances",success)
            .putString("agendaRenderError",failure.isEmpty()?"":"agenda:"+failure);
        else report.putLong("lastRenderAt",now)
            .putInt("lastRenderedInstances",success)
            .putString("lastRenderError",failure);
        report.apply();
        // No countdown badge or live minute-by-minute text remains. Refresh
        // after midnight (and whenever the app synchronizes its cache) rather
        // than waking the phone every 30 minutes and resetting list scrolling.
        long next=midnight(now,1)+MINUTE;
        if (ids.length>0)schedule(context,Math.max(now+MINUTE,next));
    }
}
