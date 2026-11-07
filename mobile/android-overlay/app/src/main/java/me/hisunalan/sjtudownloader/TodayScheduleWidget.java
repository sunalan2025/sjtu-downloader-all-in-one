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
    private static final String SHOWN_DAY = "last-shown-day-";
    private static final String TODAY_ANCHOR = "today-anchor";
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
        final String courseName;
        final boolean assignment;
        final JSONObject metadata;
        Item(long start, long end, String title, String place,
             boolean deadline, String category, boolean allDay,
             String courseName) {
            this(start,end,title,place,deadline,category,allDay,courseName,false);
        }
        Item(long start, long end, String title, String place,
             boolean deadline, String category, boolean allDay,
             String courseName, boolean assignment) {
            this(start,end,title,place,deadline,category,allDay,courseName,assignment,new JSONObject());
        }
        Item(long start,long end,String title,String place,boolean deadline,String category,boolean allDay,String courseName,boolean assignment,JSONObject metadata){
            this.metadata=metadata;
            this.assignment = assignment;
            this.start = start;
            this.end = end;
            this.title = title;
            this.place = place;
            this.deadline = deadline;
            this.category = category;
            this.allDay = allDay;
            this.courseName = courseName;
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
                clean.put("id", event.optString("id", ""));
                clean.put("source", "personal".equals(event.optString("source")) ? "personal" : "school");
                clean.put("startMs", start);
                clean.put("endMs", end);
                clean.put("title", title.substring(0, Math.min(title.length(), 100)));
                String location = event.optString("location", "");
                clean.put("location", location.substring(0, Math.min(location.length(), 85)));
                String course = event.optString("courseName", "").trim();
                clean.put("courseName",course.substring(0,Math.min(course.length(),110)));
                clean.put("kind", "deadline".equals(event.optString("kind", ""))
                    ? "deadline" : "course");
                clean.put("allDay", event.optBoolean("allDay", false));
                // The Canvas assignment type is authoritative even when
                // its title contains "考试" and ScheduleKind labels it exam.
                clean.put("assignment",event.optBoolean("assignment",false));
                String category = event.optString("category", "");
                clean.put("category", "exam".equals(category) ? "exam"
                    : "homework".equals(category) ? "homework"
                    : "event".equals(category) ? "event" : "course");
                AssignmentStatus.copy(event,clean);
                safe.put(clean);
            } catch (Exception ignored) {}
        }
        // A no-op sync should not rewrite SharedPreferences or wake the
        // launcher. Time-boundary alarms refresh the live/next state separately.
        if (safe.length() == 0 && !clear) return;
        String snapshot = safe.toString();
        SharedPreferences prefs = preferences(context);
        if (snapshot.equals(prefs.getString(EVENTS, "[]"))) return;
        prefs.edit().putString(EVENTS, snapshot)
            .putLong(UPDATED, System.currentTimeMillis()).apply();
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
                    item.optBoolean("allDay",false),
                    item.optString("courseName",""),
                    item.optBoolean("assignment",false),item));
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
        Intent intent = new Intent(context, UpcomingAgendaWidget.class);
        intent.setAction(ACTION_PAGE);
        intent.setData(Uri.parse("sjtu-widget://page/" + id + "/" + direction));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        intent.putExtra("step", direction);
        return PendingIntent.getBroadcast(context, id * 4 + (direction > 0 ? 1 : 2),
            intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Both providers use the same offline agenda and one alarm schedule. */
    static synchronized void refresh(Context context) {
        context=AppAppearance.widgetContext(context);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] daily = manager.getAppWidgetIds(new ComponentName(context,UpcomingAgendaWidget.class));
        int[] weekly = manager.getAppWidgetIds(new ComponentName(context,WeeklyScheduleWidget.class));
        long now=System.currentTimeMillis();
        ArrayList<Item> all=load(context);
        if(daily.length>0) render(context,manager,daily,true,false,all,now);
        if(weekly.length>0) WeeklyScheduleWidget.render(context,manager,weekly,all,now);
        WidgetClock.configure(context,weekly.length>0);
        WidgetClock.schedule(context,weekly.length>0,now);
        if(daily.length+weekly.length>0) schedule(context,nextRefreshTime(all,now));
        else cancelAlarm(context);
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
            int small=manager.getAppWidgetIds(new ComponentName(context,UpcomingAgendaWidget.class)).length;
            int large=manager.getAppWidgetIds(new ComponentName(context,WeeklyScheduleWidget.class)).length;
            count=small+large;
            status.put("dailyInstances",small);
            status.put("weeklyInstances",large);
        } catch (Exception ignored) {}
        SharedPreferences prefs = preferences(context);
        status.put("instances", count);
        status.put("courses", classes);
        status.put("deadlines", deadlines);
        status.put("updatedAt", prefs.getLong(UPDATED, 0));
        status.put("lastRenderAt", prefs.getLong("lastRenderAt", 0));
        status.put("nextRefreshAt", prefs.getLong("nextRefreshAt", 0));
        status.put("lastAlarmFiredAt", prefs.getLong("lastAlarmFiredAt", 0));
        status.put("exactAlarmAllowed", canScheduleExact(context));
        status.put("lastRenderedInstances", prefs.getInt("agendaRenderedInstances", 0));
        status.put("lastRenderError", prefs.getString("agendaRenderError", ""));
        status.put("weeklyRenderedInstances",prefs.getInt("weeklyRenderedInstances",0));
        status.put("weeklyRenderError",prefs.getString("weeklyRenderError",""));
        status.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        status.put("brand", Build.BRAND == null ? "" : Build.BRAND);
        status.put("androidApi", Build.VERSION.SDK_INT);
        boolean canPin = false;
        try {
            canPin = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported();
        } catch (Exception ignored) { }
        status.put("pinSupported",canPin);
        android.os.PowerManager power = (android.os.PowerManager)
            context.getSystemService(Context.POWER_SERVICE);
        status.put("ignoringBatteryOptimizations", power != null &&
            power.isIgnoringBatteryOptimizations(context.getPackageName()));
        return status;
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        renderAgenda(context, manager, ids);
    }
    @Override public void onEnabled(Context context) { refresh(context); }
    @Override public void onDisabled(Context context) { refresh(context); }
    static void forgetOffsets(Context context,int[] ids) {
        SharedPreferences.Editor editor = preferences(context).edit();
        for (int id : ids) editor.remove(OFFSET + id).remove(SHOWN_DAY + id);
        editor.apply();
    }
    @Override public void onDeleted(Context context, int[] ids) {
        forgetOffsets(context,ids);
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        handleWidgetBroadcast(context,intent);
    }

    static void handleWidgetBroadcast(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PAGE.equals(action)) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            int step = intent.getIntExtra("step", 0);
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            boolean exists = false;
            for (int live : manager.getAppWidgetIds(new ComponentName(context,
                    UpcomingAgendaWidget.class))) if (live == id) exists = true;
            if (!exists || (step != -1 && step != 1)) return;
            SharedPreferences prefs = preferences(context);
            int next = Math.max(-7, Math.min(21, prefs.getInt(OFFSET + id, 0) + step));
            prefs.edit().putInt(OFFSET + id, next).apply();
            render(context,manager,new int[]{id},true,true,
                load(context),System.currentTimeMillis());
        } else if (ACTION_REFRESH.equals(action) ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
             AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) ||
            Intent.ACTION_DATE_CHANGED.equals(action) ||
            Intent.ACTION_TIME_CHANGED.equals(action) ||
            Intent.ACTION_TIMEZONE_CHANGED.equals(action) ||
            Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            if(ACTION_REFRESH.equals(action))
                preferences(context).edit().putLong("lastAlarmFiredAt",
                    System.currentTimeMillis()).apply();
            refresh(context);
        }
    }

    /** On Android 12+, exact alarm updates are optional user-granted access. */
    static boolean canScheduleExact(Context context) {
        if(Build.VERSION.SDK_INT < Build.VERSION_CODES.S)return true;
        AlarmManager alarm=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        return alarm!=null && alarm.canScheduleExactAlarms();
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, UpcomingAgendaWidget.class);
        intent.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 7290, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelAlarm(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm != null) alarm.cancel(alarmIntent(context));
        preferences(context).edit().putLong("nextRefreshAt", 0L).apply();
    }

    private static void schedule(Context context, long at) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        PendingIntent intent = alarmIntent(context);
        alarm.cancel(intent);
        // Classes and exam state changes should be punctual when Android
        // grants alarm/reminder access. In its absence keep the OS-safe
        // inexact path and a separate half-hour AppWidgetManager pulse.
        try {
            if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.M && canScheduleExact(context))
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
            else if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.M)
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
            else alarm.set(AlarmManager.RTC_WAKEUP,at,intent);
        }catch(SecurityException denied){
            if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.M)
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
            else alarm.set(AlarmManager.RTC_WAKEUP,at,intent);
        }
        preferences(context).edit().putLong("nextRefreshAt", at).apply();
    }

    /** After midnight, return all instances to today; paging stays independent
     * during the day. No application process needs to stay in the foreground. */
    private static void ensureToday(Context context, int[] ids, long now) {
        SharedPreferences prefs = preferences(context);
        long today = midnight(now, 0);
        long previous = prefs.getLong(TODAY_ANCHOR, 0);
        if (previous == today) return;
        SharedPreferences.Editor edit = prefs.edit().putLong(TODAY_ANCHOR, today);
        // Also migrate v0.4.20 widgets with offsets but no anchor key.
        for (int id : ids) edit.remove(OFFSET + id).remove(SHOWN_DAY + id);
        edit.apply();
    }

    /** Homework is a deadline instant, not an ongoing class. Exams can have
     * durations. All-day events remain active through local midnight. */
    static boolean ongoing(Item item, long now) {
        if (item.assignment || item.deadline && !"exam".equals(item.category)) return false;
        if (item.start > now) return false;
        if (item.allDay) return now < midnight(item.start, 1);
        return item.end > now;
    }

    static int firstRelevantIndex(ArrayList<Item> items, long now) {
        // An all-day personal event should not hide an active lecture, nor
        // should it hide a future timed class when nothing timed is running.
        for (int i = 0; i < items.size(); i++)
            if (!items.get(i).allDay && ongoing(items.get(i), now)) return i;
        for (int i = 0; i < items.size(); i++)
            if (!items.get(i).allDay && items.get(i).start >= now) return i;
        for (int i = 0; i < items.size(); i++)
            if (ongoing(items.get(i), now)) return i;
        for (int i = 0; i < items.size(); i++)
            if (items.get(i).start >= now) return i;
        return -1;
    }

    static String focusText(ArrayList<Item> items, long now) {
        int index = firstRelevantIndex(items, now);
        if (index < 0)
            return items.isEmpty() ? "今天暂无安排" : "今天的安排已结束";
        Item focus = items.get(index);
        if (ongoing(focus, now)) {
            if (focus.allDay) return "全天进行中 · " + SchedulePresentation.title(focus);
            int running = 0;
            for (Item item : items)
                if (!item.allDay && ongoing(item, now)) running++;
            return "进行中 · " + SchedulePresentation.title(focus) + " · " + format(focus.end, "HH:mm") +
                "结束" + (running > 1 ? " 等" + running + "项" : "");
        }
        String prefix = "homework".equals(focus.category) ? "即将截止" : "下一项";
        return prefix + " · " + format(focus.start, "HH:mm") + " " + SchedulePresentation.title(focus);
    }

    /** One alarm for the next actual state change or Shanghai midnight.
     * Inexact Android alarms can be delivered late during device idle. */
    static long nextRefreshTime(ArrayList<Item> items, long now) {
        long next = midnight(now, 1) + MINUTE;
        for (Item item : items) {
            if (item.start > now && item.start < next)
                next = Math.min(next, item.start + 1000L);
            if (ongoing(item, now) && !item.allDay && item.end > now)
                next = Math.min(next, item.end + 1000L);
        }
        return Math.max(now + 5000L, next);
    }

    /** This is one complete day's cached schedule, not just the first 3
     * lessons: includes ordinary classes, personal events, homework and exams. */
    static ArrayList<Item> itemsForDay(Context context, int id) {
        return itemsForDay(context,id,load(context));
    }

    private static ArrayList<Item> itemsForDay(Context context,int id,ArrayList<Item> all) {
        int offset = Math.max(-7, Math.min(21,
            preferences(context).getInt(OFFSET + id, 0)));
        long now = System.currentTimeMillis();
        long start = midnight(now, offset);
        long finish = midnight(now, offset + 1);
        ArrayList<Item> found = new ArrayList<>();
        for (Item item : all) {
            if ((item.start >= start && item.start < finish) ||
                (!item.deadline && item.start < start && item.end > start)) found.add(item);
        }
        found.sort(Comparator.comparingLong(item -> item.start));
        return found;
    }

    static RemoteViews rowView(Context context, Item item) {
        context=AppAppearance.widgetContext(context);
        RemoteViews view = new RemoteViews(context.getPackageName(),
            R.layout.today_schedule_widget_row);
        String kind = "exam".equals(item.category) ? "考试"
            : "homework".equals(item.category) ? "作业"
            : "event".equals(item.category) ? "日程" : "课程";
        String time;
        if (item.allDay) {
            time = item.deadline ? "当天截止" : "全天";
        } else if (item.deadline) {
            time = format(item.start,"HH:mm");
            if ("exam".equals(item.category) && !item.assignment) {
                if(item.end>item.start && item.end-item.start<=DAY)
                    time += "–" + format(item.end,"HH:mm");
            } else time += " 截止";
        } else {
            time = format(item.start,"HH:mm");
            if (item.end > item.start && item.end-item.start <= DAY)
                time += "–" + format(item.end,"HH:mm");
        }
        long now = System.currentTimeMillis();
        boolean live = item.start < midnight(now, 1) &&
            item.end >= midnight(now, 0) && ongoing(item, now);
        view.setTextViewText(R.id.widget_row_time,
            (live ? "进行中 · " : "") + time + " · " + kind);
        view.setTextViewText(R.id.widget_row_title, SchedulePresentation.title(item));
        String details = "";
        if ("homework".equals(item.category) && !item.courseName.isEmpty())
            details="所属课程 · " + item.courseName;
        if (!item.place.isEmpty()) {
            if (!details.isEmpty()) details += "\n";
            details += item.place;
        }
        String status=AssignmentStatus.label(item.metadata,item.start,now);
        if(!status.isEmpty())details+=(details.isEmpty()?"":"\n")+status;
        if (details.isEmpty()) view.setViewVisibility(R.id.widget_row_place,View.GONE);
        else {
            view.setTextViewText(R.id.widget_row_place,details);
            view.setViewVisibility(R.id.widget_row_place,View.VISIBLE);
        }
        view.setInt(R.id.widget_row_surface, "setBackgroundResource", AppAppearance.isDark(context)
            ? R.drawable.material_widget_row_dark : R.drawable.material_widget_row_light);
        view.setTextColor(R.id.widget_row_title, AppAppearance.color(context, "onSurface"));
        view.setTextColor(R.id.widget_row_place, AppAppearance.color(context, "onSurfaceVariant"));
        boolean past=WeeklyScheduleWidget.stage(item,now)<0;
        view.setColorStateList(R.id.widget_row_surface,"setBackgroundTintList",android.content.res.ColorStateList.valueOf(
            past?ScheduleColors.widgetPaint(context,item,now)[0]:AppAppearance.color(context,"surfaceContainerLow")));
        if(past){
            view.setTextColor(R.id.widget_row_title,ScheduleColors.widgetPaint(context,item,now)[1]);
        }
        view.setTextColor(R.id.widget_row_time,AppAppearance.color(context,past?"onSurfaceVariant":"primary"));
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
                collection.addItem(AppAppearance.widgetItemId(context,i),rowView(context,items.get(i)));
            }
            view.setRemoteAdapter(R.id.widget_list,collection.build());
        } else {
            Intent intent = new Intent(context,TodayScheduleWidgetService.class);
            intent.setData(Uri.parse("sjtu-widget://list/"+id+"?theme="+AppAppearance.widgetItemId(context,0)));
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);
            view.setRemoteAdapter(R.id.widget_list,AppAppearance.widgetIntent(context,intent));
        }
        view.setEmptyView(R.id.widget_list,R.id.widget_empty);
    }

    static void renderAgenda(Context context, AppWidgetManager manager, int[] ids) {
        render(context,manager,ids,true,false,
            load(context),System.currentTimeMillis());
    }

    private static void render(Context context, AppWidgetManager manager,
                               int[] ids,boolean compact,boolean resetScroll,
                               ArrayList<Item> all,long now) {
        context=AppAppearance.widgetContext(context);
        ensureToday(context, ids, now);
        SharedPreferences prefs = preferences(context);
        int success = 0;
        String failure = "";
        for (int id : ids) {
            int offset = Math.max(-7, Math.min(21, prefs.getInt(OFFSET + id, 0)));
            long day = midnight(now, offset);
            ArrayList<Item> items = itemsForDay(context,id,all);
            try {
                RemoteViews view = new RemoteViews(context.getPackageName(),
                    R.layout.today_schedule_widget);
                view.setInt(R.id.widget_root, "setBackgroundResource", AppAppearance.isDark(context)
                    ? R.drawable.material_widget_surface_dark : R.drawable.material_widget_surface_light);
                view.setColorStateList(R.id.widget_root,"setBackgroundTintList",android.content.res.ColorStateList.valueOf(AppAppearance.color(context,"surfaceContainer")));
                view.setTextColor(R.id.widget_date, AppAppearance.color(context, "onSurface"));
                view.setTextColor(R.id.widget_prev, AppAppearance.color(context, "primary"));
                view.setTextColor(R.id.widget_next, AppAppearance.color(context, "primary"));
                view.setTextColor(R.id.widget_empty, AppAppearance.color(context, "onSurfaceVariant"));
                view.setTextViewText(R.id.widget_date,
                    format(day,"M/d E") + " · " + items.size() + "项");
                boolean today = offset == 0;
                view.setTextViewText(R.id.widget_badge,
                    today ? focusText(items, now) : "已切换日期 · 上下滑动查看全部安排");
                view.setTextColor(R.id.widget_badge, AppAppearance.color(context, "onSurfaceVariant"));
                view.setTextViewText(R.id.widget_empty,
                    all.isEmpty() ? "暂无已同步安排" : "这一天暂无安排");
                attachList(context,view,id,items);
                // On first render or new date, show the current/next event.
                // Routine time and cache refreshes preserve manual scrolling.
                boolean dayChanged = prefs.getLong(SHOWN_DAY + id, 0) != day;
                if (resetScroll || dayChanged) {
                    int focused = today ? firstRelevantIndex(items, now) : -1;
                    view.setScrollPosition(R.id.widget_list, Math.max(0, focused));
                }
                // Only these arrows navigate. No app-launch PendingIntent on
                // the root or list rows, so scrolling never opens the app.
                view.setOnClickPendingIntent(R.id.widget_prev,pageIntent(context,id,-1));
                view.setOnClickPendingIntent(R.id.widget_next,pageIntent(context,id,1));
                manager.updateAppWidget(id,view);
                prefs.edit().putLong(SHOWN_DAY + id, day).apply();
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
        SharedPreferences.Editor report = prefs.edit().putLong("lastRenderAt",now);
        if (compact) report.putInt("agendaRenderedInstances",success)
            .putString("agendaRenderError",failure.isEmpty()?"":"agenda:"+failure);
        else report.putInt("lastRenderedInstances",success)
            .putString("lastRenderError",failure);
        report.apply();
        // The shared refresh schedules one alarm for both providers.
    }
}
