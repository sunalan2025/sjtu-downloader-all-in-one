package me.hisunalan.sjtudownloader;

import me.hisunalan.sjtudownloader.beta.R;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Locale;

/** Minute-accurate continuous week. No school-period slots or duration rounding. */
public final class WeeklyScheduleWidget extends AppWidgetProvider {
    private static final String FOCUS_KEY="weekly-grid-v4-";
    private static final int[] DEADLINE_COLUMN={R.id.week_deadlines_mon, R.id.week_deadlines_tue, R.id.week_deadlines_wed, R.id.week_deadlines_thu, R.id.week_deadlines_fri, R.id.week_deadlines_sat, R.id.week_deadlines_sun};
    private static final int[] HEADER_DAY={R.id.week_day_mon, R.id.week_day_tue, R.id.week_day_wed, R.id.week_day_thu, R.id.week_day_fri, R.id.week_day_sat, R.id.week_day_sun};
    private static final int[] HEADER_DATE={R.id.week_date_mon, R.id.week_date_tue, R.id.week_date_wed, R.id.week_date_thu, R.id.week_date_fri, R.id.week_date_sat, R.id.week_date_sun};
    private static final String[] SHORT_DAYS={"一","二","三","四","五","六","日"};

    static final class ClassBlock {
        final TodayScheduleWidget.Item item;
        final float start,end;
        int lane,lanes=1;
        ClassBlock(TodayScheduleWidget.Item item,float start,float end){this.item=item;this.start=start;this.end=end;}
    }
    static final class WeekGrid {
        @SuppressWarnings("unchecked") final ArrayList<ClassBlock>[] days=new ArrayList[7];
        @SuppressWarnings("unchecked") final ArrayList<TodayScheduleWidget.Item>[] topItems=new ArrayList[7];
        final long[] dates=new long[7];
        final boolean preview;
        final long start,end;
        int firstMinute=480,lastMinute=1080;
        WeekGrid(long now){
            preview=weekendPreview(now);
            long monday=weekMonday(now);
            start=TodayScheduleWidget.midnight(monday,preview?5:0);
            end=TodayScheduleWidget.midnight(start,7);
            for(int i=0;i<7;i++){
                days[i]=new ArrayList<>();topItems[i]=new ArrayList<>();
                dates[i]=TodayScheduleWidget.midnight(monday,i+(preview&&i<5?7:0));
            }
        }
    }
    static long weekMonday(long now){
        Calendar local=Calendar.getInstance(TodayScheduleWidget.ZONE);local.setTimeInMillis(now);
        return TodayScheduleWidget.midnight(now,-(local.get(Calendar.DAY_OF_WEEK)+5)%7);
    }
    static boolean weekendPreview(long now){
        Calendar local=Calendar.getInstance(TodayScheduleWidget.ZONE);local.setTimeInMillis(now);
        int day=local.get(Calendar.DAY_OF_WEEK);
        return day==Calendar.SATURDAY||day==Calendar.SUNDAY;
    }
    static long displayStart(long now){
        return TodayScheduleWidget.midnight(weekMonday(now),weekendPreview(now)?5:0);
    }
    static String rangeLabel(WeekGrid grid){
        if(grid.preview)return "本周末  "+TodayScheduleWidget.format(grid.dates[5],"M/d")+" – "+
            TodayScheduleWidget.format(grid.dates[6],"M/d")+"\n下周  "+
            TodayScheduleWidget.format(grid.dates[0],"M/d")+" – "+TodayScheduleWidget.format(grid.dates[4],"M/d");
        return TodayScheduleWidget.format(grid.start,"M/d")+" – "+
            TodayScheduleWidget.format(TodayScheduleWidget.midnight(grid.end,-1),"M/d");
    }
    static boolean topLane(TodayScheduleWidget.Item item){
        return item.assignment||"homework".equals(item.category)||item.allDay||(item.deadline&&!"exam".equals(item.category));
    }
    private static String normalized(String value){return value==null?"":value.replaceAll("\\s+","").toLowerCase(Locale.ROOT);}
    static WeekGrid weekGrid(ArrayList<TodayScheduleWidget.Item> all,long now){
        WeekGrid grid=new WeekGrid(now);
        float earliest=1440,latest=0;
        for(int day=0;day<7;day++){
            long date=grid.dates[day],next=TodayScheduleWidget.midnight(date,1);
            HashSet<String> seen=new HashSet<>();
            for(TodayScheduleWidget.Item item:all){
                boolean top=topLane(item);
                long effectiveEnd=Math.max(item.end,item.start+60_000);
                if(top?item.start<date||item.start>=next:item.start>=next||effectiveEnd<=date)continue;
                String owner=item.deadline||!"course".equals(item.category)?normalized(item.courseName):"";
                String key=item.start+"|"+item.end+"|"+item.category+"|"+normalized(item.title)+"|"+normalized(item.place)+"|"+owner;
                if(!seen.add(key))continue;
                if(top){grid.topItems[day].add(item);continue;}
                float start=Math.max(0,(item.start-date)/60_000f),end=Math.min(1440,(effectiveEnd-date)/60_000f);
                grid.days[day].add(new ClassBlock(item,start,end));earliest=Math.min(earliest,start);latest=Math.max(latest,end);
            }
            grid.days[day].sort(Comparator.comparingDouble((ClassBlock b)->b.start).thenComparingDouble(b->b.end).thenComparing(b->b.item.title));
            // Actual time conflicts keep separate rectangles; touching endpoints
            // and events during class breaks are never merged or snapped.
            ArrayList<ClassBlock> cluster=new ArrayList<>();float clusterEnd=-1;
            for(ClassBlock block:grid.days[day]){
                if(!cluster.isEmpty()&&block.start>=clusterEnd){placeLanes(cluster);cluster.clear();}
                cluster.add(block);clusterEnd=Math.max(clusterEnd,block.end);
            }
            placeLanes(cluster);
            grid.topItems[day].sort(Comparator.comparingLong((TodayScheduleWidget.Item item)->item.start).thenComparing(item->item.title));
        }
        if(latest>0){
            grid.firstMinute=Math.max(0,((int)Math.floor(earliest/60)-1)*60);
            grid.lastMinute=Math.min(1440,Math.max(grid.firstMinute+180,((int)Math.ceil(latest/60)+1)*60));
        }
        return grid;
    }
    private static void placeLanes(ArrayList<ClassBlock> cluster){
        ArrayList<Float> ends=new ArrayList<>();
        for(ClassBlock block:cluster){
            int lane=0;while(lane<ends.size()&&ends.get(lane)>block.start)lane++;
            if(lane==ends.size())ends.add(block.end);else ends.set(lane,block.end);
            block.lane=lane;
        }
        for(ClassBlock block:cluster)block.lanes=ends.size();
    }
    static int stage(TodayScheduleWidget.Item item,long now){
        if(item.assignment||(item.deadline&&!"exam".equals(item.category)))return item.start<now?-1:1;
        if(TodayScheduleWidget.ongoing(item,now))return 0;
        if(item.allDay)return TodayScheduleWidget.midnight(item.start,1)<=now?-1:1;
        return item.end<=now?-1:1;
    }
    private static RemoteViews deadlineChip(Context context,TodayScheduleWidget.Item item,long now){
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.weekly_schedule_deadline_chip);
        String caption=(item.allDay?"全天":TodayScheduleWidget.format(item.start,"HH:mm"))+
            (item.assignment||"homework".equals(item.category)?" 截止":"")+"\n"+SchedulePresentation.title(item);
        if(!item.courseName.isEmpty()&&!item.title.equals(item.courseName))caption+="\n"+item.courseName;
        String status=AssignmentStatus.label(item.metadata,item.start,now);
        if(!status.isEmpty())caption+="\n"+status;
        view.setTextViewText(R.id.week_deadline_chip,caption);
        int[] colors=ScheduleColors.widgetPaint(context,item,now);
        if(Build.VERSION.SDK_INT>=31)view.setColorStateList(R.id.week_deadline_chip,"setBackgroundTintList",ColorStateList.valueOf(colors[0]));
        else view.setInt(R.id.week_deadline_chip,"setBackgroundColor",colors[0]);
        view.setTextColor(R.id.week_deadline_chip,colors[1]);return view;
    }
    static int width(Context context,int widgetId){
        android.os.Bundle options=AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId);
        int minimum=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,340);
        boolean landscape=context.getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        int width=landscape?options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,minimum):minimum;
        return Math.max(240,Math.min(1000,width))-16;
    }
    static RemoteViews gridView(Context context,WeekGrid grid,long now){return gridView(context,grid,now,324);}
    static RemoteViews gridView(Context context,WeekGrid grid,long now,int width){
        context=AppAppearance.widgetContext(context);
        RemoteViews body=new RemoteViews(context.getPackageName(),R.layout.weekly_schedule_grid_body);
        body.setInt(R.id.week_grid_body_surface,"setBackgroundColor",AppAppearance.color(context,"surface"));
        body.setTextColor(R.id.week_deadline_axis_label,AppAppearance.color(context,"onSurfaceVariant"));
        org.json.JSONArray titles=new org.json.JSONArray();
        for(int day=0;day<7;day++)for(ClassBlock block:grid.days[day])if("course".equals(block.item.category))titles.put(block.item.title);
        ScheduleColors.assign(context,titles,null);
        for(int day=0;day<7;day++){
            body.setInt(DEADLINE_COLUMN[day],"setBackgroundColor",AppAppearance.color(context,"surfaceContainerLow"));
            body.removeAllViews(DEADLINE_COLUMN[day]);
            for(TodayScheduleWidget.Item item:grid.topItems[day])body.addView(DEADLINE_COLUMN[day],deadlineChip(context,item,now));
        }
        body.removeAllViews(R.id.week_timeline_host);
        if(Build.VERSION.SDK_INT>=31)body.addView(R.id.week_timeline_host,NativeWeeklyTimeline.draw(context,grid,now));
        else{
            RemoteViews legacy=new RemoteViews(context.getPackageName(),R.layout.weekly_schedule_legacy_timeline);
            legacy.setImageViewBitmap(R.id.week_timeline,WeeklyTimeline.draw(context,grid,now,width));
            legacy.setContentDescription(R.id.week_timeline,WeeklyTimeline.description(grid));body.addView(R.id.week_timeline_host,legacy);
        }
        return body;
    }

    static String focusLabel(ArrayList<TodayScheduleWidget.Item> all,long now) {
        return focusLabel(all,now,new WeekGrid(now));
    }
    private static String focusLabel(ArrayList<TodayScheduleWidget.Item> all,long now,WeekGrid grid) {
        TodayScheduleWidget.Item active=null,next=null;
        int activeCount=0;
        for(TodayScheduleWidget.Item item:all){
            if(item.start>=grid.end || Math.max(item.end,item.start+60_000)<=grid.start)continue;
            if(stage(item,now)==0){
                activeCount++;
                if(active==null || item.end<active.end)active=item;
            }else if(stage(item,now)>0 &&
                (next==null || item.start<next.start))next=item;
        }
        if(active!=null)return "正在进行  ·  "+SchedulePresentation.title(active)+"\n"+
            TodayScheduleWidget.format(active.start,"HH:mm")+" — "+
            TodayScheduleWidget.format(active.end,"HH:mm")+
            (active.place.isEmpty()?"":"  ·  "+active.place)+
            (activeCount>1?" 等"+activeCount+"项":"");
        if(next!=null)return "下一项  ·  "+SchedulePresentation.title(next)+"\n"+
            TodayScheduleWidget.format(next.start,"M/d HH:mm")+
            (next.place.isEmpty()?"":"  ·  "+next.place);
        return grid.preview?"周末及下周工作日暂无安排":"本周暂无待进行的日程";
    }

    /** Inline collection updates on Android 12+ do not wait for a transient
     * RemoteViewsService binding or an asynchronous collection-cache refresh. */
    static RemoteViews widgetView(Context context,int id,ArrayList<TodayScheduleWidget.Item> all,
                                  long now,WeekGrid grid,boolean resetScroll){
        context=AppAppearance.widgetContext(context);
        long today=TodayScheduleWidget.midnight(now,0);
        RemoteViews view=new RemoteViews(context.getPackageName(),
            R.layout.weekly_schedule_widget);
        view.setInt(R.id.week_widget_root,"setBackgroundResource",AppAppearance.isDark(context)
            ? R.drawable.material_widget_surface_dark:R.drawable.material_widget_surface_light);
        view.setColorStateList(R.id.week_widget_root,"setBackgroundTintList",ColorStateList.valueOf(AppAppearance.color(context,"surfaceContainer")));
        view.setTextColor(R.id.week_legend,AppAppearance.color(context,"onSurfaceVariant"));
        view.setTextColor(R.id.week_scroll_hint,AppAppearance.color(context,"onSurfaceVariant"));
        view.setTextColor(R.id.week_range,AppAppearance.color(context,"onSurface"));
        view.setTextColor(R.id.week_time_axis_title,AppAppearance.color(context,"onSurface"));
        view.setTextViewText(R.id.week_time_axis_title,grid.preview?"周末与下周":"本周日程");
        view.setTextViewText(R.id.week_legend,grid.preview?"周末看本周 · 工作日看下周":"课程独立配色 · 浅红为考试");
        view.setTextColor(R.id.week_time_axis_label,AppAppearance.color(context,"onSurfaceVariant"));
        view.setTextColor(R.id.week_focus,AppAppearance.color(context,"onPrimaryContainer"));
        view.setInt(R.id.week_focus,"setBackgroundColor",AppAppearance.color(context,"primaryContainer"));
        view.setTextColor(R.id.week_empty,AppAppearance.color(context,"onSurfaceVariant"));
        view.setTextViewText(R.id.week_focus,focusLabel(all,now,grid));
        view.setTextViewText(R.id.week_range,rangeLabel(grid));
        for(int day=0;day<7;day++){
            long date=grid.dates[day];
            boolean current=date==today;
            view.setTextViewText(HEADER_DAY[day],current?"今":SHORT_DAYS[day]);
            view.setTextViewText(HEADER_DATE[day],TodayScheduleWidget.format(date,grid.preview?"M/d":"d"));
            view.setTextColor(HEADER_DAY[day],AppAppearance.color(context,current?"primary":"onSurfaceVariant"));
            view.setTextColor(HEADER_DATE[day],AppAppearance.color(context,current?"primary":"onSurfaceVariant"));
        }
        if(Build.VERSION.SDK_INT>=31){
            RemoteViews.RemoteCollectionItems items=new RemoteViews.RemoteCollectionItems.Builder()
                .setHasStableIds(true).setViewTypeCount(1)
                .addItem(AppAppearance.widgetItemId(context,grid.start),gridView(context,grid,now,width(context,id))).build();
            view.setRemoteAdapter(R.id.week_list,items);
        }else{
            Intent intent=new Intent(context,WeeklyScheduleWidgetService.class);
            intent.setData(Uri.parse("sjtu-widget://weekgrid-native/"+id+"?week="+grid.start+"&theme="+AppAppearance.widgetItemId(context,0)));
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);
            view.setRemoteAdapter(R.id.week_list,AppAppearance.widgetIntent(context,intent));
        }
        view.setEmptyView(R.id.week_list,R.id.week_empty);
        if(resetScroll)
            view.setScrollPosition(R.id.week_list,0);
        return view;
    }

    static void render(Context context,AppWidgetManager manager,int[] ids,
                       ArrayList<TodayScheduleWidget.Item> all,long now) {
        if(ids.length==0)return;
        WeekGrid grid=weekGrid(all,now);
        SharedPreferences prefs=TodayScheduleWidget.preferences(context);
        long today=TodayScheduleWidget.midnight(now,0);
        int success=0;String error="";
        for(int id:ids){
            try{
                RemoteViews view=widgetView(context,id,all,now,grid,prefs.getLong(FOCUS_KEY+id,0)!=today);
                manager.updateAppWidget(id,view);
                prefs.edit().putLong(FOCUS_KEY+id,today).apply();
                if(Build.VERSION.SDK_INT<31)manager.notifyAppWidgetViewDataChanged(new int[]{id},R.id.week_list);
                success++;
            }catch(Exception failure){
                error=failure.getClass().getSimpleName();
                try{
                    RemoteViews fallback=new RemoteViews(context.getPackageName(),
                        R.layout.today_schedule_widget_fallback);
                    fallback.setTextViewText(R.id.widget_fallback_message,
                        "本周课表暂时无法显示，请打开应用同步后重试");
                    manager.updateAppWidget(id,fallback);
                }catch(Exception ignored){}
            }
        }
        prefs.edit().putInt("weeklyRenderedInstances",success)
            .putString("weeklyRenderError",error).putLong("lastRenderAt",now).apply();
    }

    @Override public void onAppWidgetOptionsChanged(Context context,AppWidgetManager manager,int id,android.os.Bundle options){
        TodayScheduleWidget.refresh(context);
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){
        TodayScheduleWidget.refresh(context);
    }
    @Override public void onEnabled(Context context){TodayScheduleWidget.refresh(context);}
    @Override public void onDisabled(Context context){TodayScheduleWidget.refresh(context);}
    @Override public void onDeleted(Context context,int[] ids){
        SharedPreferences.Editor edit=TodayScheduleWidget.preferences(context).edit();
        for(int id:ids)edit.remove(FOCUS_KEY+id);
        edit.apply();
    }
    @Override public void onReceive(Context context,Intent intent){
        super.onReceive(context,intent);
        if(intent!=null && (Intent.ACTION_DATE_CHANGED.equals(intent.getAction())||
            Intent.ACTION_TIME_CHANGED.equals(intent.getAction())||
            Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction())||
            Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())))
            TodayScheduleWidget.refresh(context);
    }
}
