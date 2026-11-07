package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.content.res.ColorStateList;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import me.hisunalan.sjtudownloader.beta.R;

/** Native launcher TextViews stay sharp at the host's actual density and width.
 * All geometry uses the same minute axis as the legacy renderer. */
final class NativeWeeklyTimeline {
    private static final int[] DAYS={R.id.week_native_mon,R.id.week_native_tue,R.id.week_native_wed,R.id.week_native_thu,R.id.week_native_fri,R.id.week_native_sat,R.id.week_native_sun};
    private static void height(RemoteViews view,int id,float dp){view.setViewLayoutHeight(id,dp,TypedValue.COMPLEX_UNIT_DIP);}
    private static void top(RemoteViews view,int id,float dp){view.setViewLayoutMargin(id,RemoteViews.MARGIN_TOP,dp,TypedValue.COMPLEX_UNIT_DIP);}
    static RemoteViews draw(Context context,WeeklyScheduleWidget.WeekGrid grid,long now){
        context=AppAppearance.widgetContext(context);
        RemoteViews root=new RemoteViews(context.getPackageName(),R.layout.weekly_schedule_native_timeline);
        root.setInt(R.id.week_native_timeline,"setBackgroundColor",AppAppearance.color(context,"surface"));
        root.setInt(R.id.week_native_axis,"setBackgroundColor",AppAppearance.color(context,"surface"));
        height(root,R.id.week_native_timeline,(grid.lastMinute-grid.firstMinute)*WeeklyTimeline.PX_PER_MINUTE+16);
        long today=TodayScheduleWidget.midnight(now,0);
        for(int day=0;day<7;day++){
            root.setInt(DAYS[day],"setBackgroundColor",AppAppearance.color(context,
                grid.dates[day]==today?"surfaceContainerLow":"surface"));
        }
        for(int column:DAYS){
            RemoteViews divider=new RemoteViews(context.getPackageName(),R.layout.weekly_schedule_native_rule);
            divider.setViewLayoutWidth(R.id.week_native_rule,.5f,TypedValue.COMPLEX_UNIT_DIP);
            divider.setViewLayoutHeight(R.id.week_native_rule,-1,TypedValue.COMPLEX_UNIT_PX);
            divider.setInt(R.id.week_native_rule,"setBackgroundColor",AppAppearance.color(context,"outlineVariant"));root.addView(column,divider);
        }
        for(int minute=grid.firstMinute;minute<=grid.lastMinute;minute+=60){
            float y=WeeklyTimeline.position(grid,minute);
            RemoteViews label=new RemoteViews(context.getPackageName(),R.layout.weekly_schedule_native_hour);
            label.setTextViewText(R.id.week_native_hour,String.format(java.util.Locale.ROOT,"%02d:%02d",minute/60,minute%60));
            label.setTextColor(R.id.week_native_hour,AppAppearance.color(context,"onSurfaceVariant"));
            top(label,R.id.week_native_hour,y-8);root.addView(R.id.week_native_axis,label);
            for(int column:DAYS){
                RemoteViews rule=new RemoteViews(context.getPackageName(),R.layout.weekly_schedule_native_rule);
                top(rule,R.id.week_native_rule,y);
                rule.setInt(R.id.week_native_rule,"setBackgroundColor",AppAppearance.color(context,"outlineVariant"));root.addView(column,rule);
            }
        }
        for(int day=0;day<7;day++)for(WeeklyScheduleWidget.ClassBlock block:grid.days[day]){
            RemoteViews row=new RemoteViews(context.getPackageName(),R.layout.weekly_schedule_native_event_row);
            top(row,R.id.week_native_event_row,WeeklyTimeline.position(grid,block.start));
            height(row,R.id.week_native_event_row,(block.end-block.start)*WeeklyTimeline.PX_PER_MINUTE);
            for(int lane=0;lane<block.lanes;lane++){
                RemoteViews card=new RemoteViews(context.getPackageName(),lane==block.lane?R.layout.weekly_schedule_native_card:R.layout.weekly_schedule_native_space);
                if(lane==block.lane){
                    int[] colors=ScheduleColors.widgetPaint(context,block.item,now);
                    card.setTextViewText(R.id.week_native_card,SchedulePresentation.caption(block.item,now));
                    card.setTextColor(R.id.week_native_card,colors[1]);
                    card.setColorStateList(R.id.week_native_card,"setBackgroundTintList",ColorStateList.valueOf(colors[0]));
                    card.setContentDescription(R.id.week_native_card,SchedulePresentation.caption(block.item,now));
                }
                row.addView(R.id.week_native_event_row,card);
            }
            root.addView(DAYS[day],row);
        }
        float current=(now-today)/60_000f;
        boolean visible=current>=grid.firstMinute&&current<=grid.lastMinute;
        root.setViewVisibility(R.id.week_now_row,visible?View.VISIBLE:View.GONE);
        if(visible){
            top(root,R.id.week_now_row,WeeklyTimeline.position(grid,current)-9);
            root.setTextViewText(R.id.week_now_label,TodayScheduleWidget.format(now,"HH:mm"));
            root.setTextColor(R.id.week_now_label,AppAppearance.isDark(context)?0xffffb4ab:0xffb52b3a);
            root.setInt(R.id.week_now_label,"setBackgroundColor",AppAppearance.color(context,"surface"));
            root.setContentDescription(R.id.week_now_row,"当前时间 "+TodayScheduleWidget.format(now,"HH:mm"));
        }
        return root;
    }
}
