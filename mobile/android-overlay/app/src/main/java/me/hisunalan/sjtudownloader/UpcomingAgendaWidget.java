package me.hisunalan.sjtudownloader;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/** Backwards-compatible 2x3 full-day card.
 * Existing widget IDs survive app updates. The independent 4x5 weekly
 * calendar is hosted by WeeklyScheduleWidget and shares the same cache.
 */
public final class UpcomingAgendaWidget extends AppWidgetProvider {
    static void refresh(Context context) {
        TodayScheduleWidget.refresh(context);
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids) {
        TodayScheduleWidget.refresh(context);
    }
    @Override public void onEnabled(Context context) { refresh(context); }
    @Override public void onDisabled(Context context) {
        // The weekly provider may still exist: refresh the shared alarm.
        TodayScheduleWidget.refresh(context);
    }
    @Override public void onDeleted(Context context,int[] ids) {
        TodayScheduleWidget.forgetOffsets(context,ids);
    }
    @Override public void onReceive(Context context,Intent intent) {
        super.onReceive(context,intent);
        if(intent==null)return;
        String action=intent.getAction();
        // Page arrows and midnight refresh are broadcast directly to this
        // remaining provider, not the now unregistered large widget.
        TodayScheduleWidget.handleWidgetBroadcast(context,intent);
    }
}
