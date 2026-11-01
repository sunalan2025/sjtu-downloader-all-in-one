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
 * Compact, independent 2x3 daily timetable widget. Its left/right controls
 * navigate each instance separately and never launch the full app.
 * Reads cached course metadata only; no background school login or storage
 * permission. A second, separate UpcomingAgendaWidget renders the deadlines.
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
        Item(long start, long end, String title, String place,
             boolean deadline, String category) {
            this.start = start;
            this.end = end;
            this.title = title;
            this.place = place;
            this.deadline = deadline;
            this.category = category;
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
                    item.optString("category", "")));
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

    static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 7202, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
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
    @Override public void onDisabled(Context context) { cancelAlarm(context); }
    @Override public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor editor = preferences(context).edit();
        for (int id : ids) editor.remove(OFFSET + id);
        editor.apply();
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PAGE.equals(action)) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            int step = intent.getIntExtra("step", 0);
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            boolean exists = false;
            for (int live : manager.getAppWidgetIds(new ComponentName(context,
                    TodayScheduleWidget.class))) if (live == id) exists = true;
            if (!exists || (step != -1 && step != 1)) return;
            SharedPreferences prefs = preferences(context);
            int next = Math.max(-7, Math.min(21, prefs.getInt(OFFSET + id, 0) + step));
            prefs.edit().putInt(OFFSET + id, next).apply();
            render(context, manager, new int[]{id});
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

    private static String itemText(Item item, long now, boolean today) {
        String label = format(item.start,"HH:mm") + "  " + item.title;
        if (today && item.start <= now && item.end > now) label = "● " + label;
        return label + (item.place.isEmpty() ? "" : "\n" + item.place);
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        long now = System.currentTimeMillis();
        ArrayList<Item> all = load(context);
        SharedPreferences prefs = preferences(context);
        int success = 0;
        String failure = "";
        for (int id : ids) {
            int offset = Math.max(-7, Math.min(21, prefs.getInt(OFFSET+id, 0)));
            long start = midnight(now, offset);
            long end = midnight(now, offset + 1);
            ArrayList<Item> classes = new ArrayList<>();
            for (Item item : all) if (!item.deadline && !"event".equals(item.category)
                    && item.start >= start && item.start < end)
                classes.add(item);
            try {
                RemoteViews view = new RemoteViews(context.getPackageName(),
                    R.layout.today_schedule_widget);
                view.setTextViewText(R.id.widget_date, format(start,"M/d E"));
                String badge = offset == 0 ? "今日 " + classes.size() + " 节课" :
                    offset > 0 ? "未来 · " + classes.size() + " 节课" :
                    "已过去 · " + classes.size() + " 节课";
                if (offset == 0) {
                    for(Item item:classes){
                        if(item.start<=now && item.end>now) {
                            long minutes=Math.max(1L,(item.end-now+MINUTE-1)/MINUTE);
                            badge="● 正在上课 · " + minutes + " 分后下课";
                            break;
                        }
                        if(item.start>now){
                            long minutes=Math.max(1L,(item.start-now+MINUTE-1)/MINUTE);
                            badge=minutes<60 ? "下节还有 " + minutes + " 分钟" :
                                "下一节 " + format(item.start,"HH:mm");
                            break;
                        }
                    }
                }
                view.setTextViewText(R.id.widget_badge,badge);
                int[] rowIds = {R.id.widget_class_one,R.id.widget_class_two,
                    R.id.widget_class_three};
                if (classes.isEmpty()) {
                    view.setTextViewText(rowIds[0],all.isEmpty() ?
                        "暂无已同步课程\n打开 App 获取课表" : "这一天没有课程");
                    view.setViewVisibility(rowIds[0],View.VISIBLE);
                } else {
                    view.setTextViewText(rowIds[0],itemText(classes.get(0),now,offset==0));
                    view.setViewVisibility(rowIds[0],View.VISIBLE);
                }
                for (int row=1;row<rowIds.length;row++) {
                    boolean visible = classes.size()>row;
                    view.setViewVisibility(rowIds[row],visible?View.VISIBLE:View.GONE);
                    if (visible)view.setTextViewText(rowIds[row],
                        itemText(classes.get(row),now,offset==0));
                }
                view.setTextViewText(R.id.widget_more,classes.size()>3
                    ? "还有 " + (classes.size()-3) + " 项 · 点击查看"
                    : offset==0 ? "‹  前一天       后一天  ›" : "切换日期查看课表");
                view.setOnClickPendingIntent(R.id.widget_root,openApp(context));
                view.setOnClickPendingIntent(R.id.widget_prev,pageIntent(context,id,-1));
                view.setOnClickPendingIntent(R.id.widget_next,pageIntent(context,id,1));
                manager.updateAppWidget(id,view);
                success++;
            } catch (Exception error) {
                failure = error.getClass().getSimpleName();
                try {
                    RemoteViews fallback = new RemoteViews(context.getPackageName(),
                        R.layout.today_schedule_widget_fallback);
                    fallback.setTextViewText(R.id.widget_fallback_message,
                        "点击进入应用，重新同步课表");
                    fallback.setOnClickPendingIntent(R.id.widget_fallback_root,openApp(context));
                    manager.updateAppWidget(id,fallback);
                    success++;
                } catch(Exception fallbackError) {
                    failure += "/" + fallbackError.getClass().getSimpleName();
                }
            }
        }
        prefs.edit().putLong("lastRenderAt",now)
            .putInt("lastRenderedInstances",success)
            .putString("lastRenderError",failure).apply();

        // Refresh the "currently in class" state, midnight date change and
        // the 15-minute start reminder; Doze may delay these inexact alarms.
        long next = Math.min(midnight(now,1)+MINUTE,now+15*MINUTE);
        for (Item item : all) {
            if (item.deadline)continue;
            long[] moments = {item.start-15*MINUTE,item.start,item.end};
            for(long moment:moments)
                if(moment>now+MINUTE)next=Math.min(next,moment);
        }
        if (ids.length > 0)schedule(context,Math.max(now+MINUTE,next));
    }
}
