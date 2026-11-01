package me.hisunalan.sjtudownloader;

import me.hisunalan.sjtudownloader.beta.R;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import java.util.ArrayList;
import java.util.Locale;

/** Independently addable 2x2 upcoming-agenda widget. Course, homework and exam
 * items are merged chronologically but labeled by type. This class reuses the
 * validated local cache, and never needs privileged background permissions. */
public final class UpcomingAgendaWidget extends AppWidgetProvider {
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context,
            UpcomingAgendaWidget.class));
        if (ids.length > 0) render(context,manager,ids);
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context,manager,ids);
    }
    @Override public void onEnabled(Context context) { refresh(context); }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context,intent);
        if (intent == null)return;
        String action=intent.getAction();
        if (Intent.ACTION_TIME_CHANGED.equals(action) ||
            Intent.ACTION_TIMEZONE_CHANGED.equals(action) ||
            Intent.ACTION_DATE_CHANGED.equals(action))
            refresh(context);
    }

    private static String row(TodayScheduleWidget.Item item,long now) {
        String when=TodayScheduleWidget.format(item.start,
            "M/d HH:mm");
        String tag="course".equals(item.category) ? "课程"
            : "exam".equals(item.category) ? "考试" : "作业";
        if (item.deadline && item.start < now + 3*60*60_000L)
            tag="exam".equals(item.category) ? "即将考试" : "即将截止";
        return when + "  · " + tag + "\n" + item.title;
    }

    private static void render(Context context,AppWidgetManager manager,int[] ids) {
        long now=System.currentTimeMillis();
        ArrayList<TodayScheduleWidget.Item> upcoming=new ArrayList<>();
        for(TodayScheduleWidget.Item item:TodayScheduleWidget.load(context)) {
            if((item.deadline && item.start < now) ||
               (!item.deadline && item.end <= now) ||
                item.start > now + TodayScheduleWidget.DEADLINE_HORIZON)
                continue;
            upcoming.add(item);
        }
        int n=Math.min(upcoming.size(),2);
        int success=0;
        String failure="";
        int[] rows={R.id.agenda_item_one,R.id.agenda_item_two,R.id.agenda_item_three};
        for(int id:ids){
            try {
                RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.upcoming_agenda_widget);
                view.setTextViewText(R.id.agenda_caption, "近期安排");
                view.setTextViewText(R.id.agenda_counter,upcoming.size()+" 项");
                for(int i=0;i<rows.length;i++){
                    if(i<n){
                        view.setTextViewText(rows[i],row(upcoming.get(i),now));
                        view.setTextColor(rows[i],upcoming.get(i).deadline
                            ? android.graphics.Color.rgb(155,101,51)
                            : android.graphics.Color.rgb(57,87,119));
                        view.setViewVisibility(rows[i],View.VISIBLE);
                    }else if(i==0){
                        view.setTextViewText(rows[i],
                            "近期没有待办\n点击应用同步最新日程");
                        view.setViewVisibility(rows[i],View.VISIBLE);
                    }else if(i==2 && upcoming.size()>2){
                        view.setTextViewText(rows[i],
                            "还有 " + (upcoming.size()-2) + " 项 · 点击查看");
                        view.setViewVisibility(rows[i],View.VISIBLE);
                    }else view.setViewVisibility(rows[i],View.GONE);
                }
                view.setOnClickPendingIntent(R.id.agenda_root,
                    TodayScheduleWidget.openApp(context));
                manager.updateAppWidget(id,view);
                success++;
            } catch(Exception error){
                failure=error.getClass().getSimpleName();
                try{
                    RemoteViews fallback=new RemoteViews(context.getPackageName(),
                        R.layout.today_schedule_widget_fallback);
                    fallback.setTextViewText(R.id.widget_fallback_message,
                        "近日安排\n点击进入应用同步日程");
                    fallback.setOnClickPendingIntent(R.id.widget_fallback_root,
                        TodayScheduleWidget.openApp(context));
                    manager.updateAppWidget(id,fallback);
                    success++;
                }catch(Exception ignored){}
            }
        }
        TodayScheduleWidget.preferences(context).edit()
            .putInt("agendaRenderedInstances",success)
            .putString("agendaRenderError",failure.isEmpty()?"":"agenda:"+failure)
            .apply();
    }
}
