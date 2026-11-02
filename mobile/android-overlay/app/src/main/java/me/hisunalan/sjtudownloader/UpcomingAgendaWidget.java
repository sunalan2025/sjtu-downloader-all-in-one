package me.hisunalan.sjtudownloader;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/** Backwards-compatible compact card.
 * The previously separate two-item "Upcoming" card now shows the same
 * scrollable full-day list as the larger widget. Existing installations keep
 * their widget IDs and both variants support date arrows without opening App.
 */
public final class UpcomingAgendaWidget extends AppWidgetProvider {
    static void refresh(Context context) {
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        int[] ids=manager.getAppWidgetIds(new ComponentName(context,
            UpcomingAgendaWidget.class));
        if(ids.length>0)TodayScheduleWidget.renderAgenda(context,manager,ids);
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids) {
        TodayScheduleWidget.renderAgenda(context,manager,ids);
    }
    @Override public void onEnabled(Context context) { refresh(context); }
    @Override public void onDeleted(Context context,int[] ids) {
        TodayScheduleWidget.forgetOffsets(context,ids);
    }
    @Override public void onReceive(Context context,Intent intent) {
        super.onReceive(context,intent);
        if(intent==null)return;
        String action=intent.getAction();
        if(Intent.ACTION_DATE_CHANGED.equals(action) ||
           Intent.ACTION_TIME_CHANGED.equals(action) ||
           Intent.ACTION_TIMEZONE_CHANGED.equals(action))
            refresh(context);
    }
}
