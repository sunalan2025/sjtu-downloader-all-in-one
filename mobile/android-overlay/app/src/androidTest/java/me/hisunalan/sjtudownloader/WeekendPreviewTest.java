package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Calendar;
import org.junit.Test;
import org.junit.runner.RunWith;
import me.hisunalan.sjtudownloader.beta.R;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class WeekendPreviewTest {
    private static long at(int year,int month,int day,int hour,int minute){
        Calendar date=Calendar.getInstance(TodayScheduleWidget.ZONE);date.clear();date.set(year,month-1,day,hour,minute);return date.getTimeInMillis();
    }
    private static long nov(int day,int hour){return at(2026,11,day,hour,0);}
    private static TodayScheduleWidget.Item lesson(long start,String title){return new TodayScheduleWidget.Item(start,start+90*60_000L,title,"教室",false,"course",false,"");}
    private static ArrayList<TodayScheduleWidget.Item> fixtures(){
        ArrayList<TodayScheduleWidget.Item> all=new ArrayList<>();
        all.add(lesson(nov(2,8),"旧周课程"));
        all.add(lesson(nov(7,10),"本周六安排"));
        all.add(lesson(nov(8,11),"本周日安排"));
        all.add(lesson(nov(9,8),"下周一课程"));
        all.add(new TodayScheduleWidget.Item(nov(10,16),nov(10,17),"下周考试","教室",false,"exam",false,""));
        all.add(new TodayScheduleWidget.Item(nov(11,23),nov(11,23),"下周作业","",true,"homework",false,"课程"));
        all.add(lesson(nov(13,9),"下周五课程"));
        all.add(lesson(nov(14,8),"下周六安排"));
        all.add(lesson(nov(15,8),"下周日安排"));
        return all;
    }
    @Test public void shanghaiSaturdayBoundaryMovesOnlyWorkdaysAndMondayReturnsToTheNewWeek(){
        WeeklyScheduleWidget.WeekGrid friday=WeeklyScheduleWidget.weekGrid(fixtures(),nov(7,0)-1);
        assertFalse(friday.preview);assertEquals(nov(2,0),friday.dates[0]);assertEquals(nov(8,0),friday.dates[6]);
        for(long now:new long[]{nov(7,0),nov(7,12),nov(8,23)+59*60_000L}){
            WeeklyScheduleWidget.WeekGrid grid=WeeklyScheduleWidget.weekGrid(fixtures(),now);
            assertTrue(grid.preview);
            for(int i=0;i<5;i++)assertEquals(nov(9+i,0),grid.dates[i]);
            assertEquals(nov(7,0),grid.dates[5]);assertEquals(nov(8,0),grid.dates[6]);
            assertEquals(nov(7,0),grid.start);assertEquals(nov(14,0),grid.end);
            assertEquals(grid.start,WeeklyScheduleWidget.displayStart(now));
        }
        WeeklyScheduleWidget.WeekGrid monday=WeeklyScheduleWidget.weekGrid(fixtures(),nov(9,0));
        assertFalse(monday.preview);
        for(int i=0;i<7;i++)assertEquals(nov(9+i,0),monday.dates[i]);
        assertEquals("下周六安排",monday.days[5].get(0).item.title);
        assertEquals("下周日安排",monday.days[6].get(0).item.title);
        long utcFriday16=java.time.Instant.parse("2026-11-06T16:00:00Z").toEpochMilli();
        assertTrue(WeeklyScheduleWidget.weekendPreview(utcFriday16));
        assertFalse(WeeklyScheduleWidget.weekendPreview(utcFriday16-1));
        ArrayList<TodayScheduleWidget.Item> overnight=new ArrayList<>();
        overnight.add(new TodayScheduleWidget.Item(nov(8,23),nov(9,1),"跨午夜安排","",false,"event",false,""));
        WeeklyScheduleWidget.WeekGrid crossing=WeeklyScheduleWidget.weekGrid(overnight,nov(8,12));
        assertEquals(0,crossing.days[0].get(0).start,0);assertEquals(60,crossing.days[0].get(0).end,0);
        assertEquals(1380,crossing.days[6].get(0).start,0);assertEquals(1440,crossing.days[6].get(0).end,0);
    }
    @Test public void monthAndYearTransitionsKeepSevenActualDates(){
        WeeklyScheduleWidget.WeekGrid january=new WeeklyScheduleWidget.WeekGrid(at(2026,1,31,12,0));
        assertEquals(at(2026,2,2,0,0),january.dates[0]);assertEquals(at(2026,2,6,0,0),january.dates[4]);
        assertEquals(at(2026,1,31,0,0),january.dates[5]);assertEquals(at(2026,2,1,0,0),january.dates[6]);
        assertEquals("本周末  1/31 – 2/1\n下周  2/2 – 2/6",WeeklyScheduleWidget.rangeLabel(january));
        WeeklyScheduleWidget.WeekGrid december=new WeeklyScheduleWidget.WeekGrid(at(2026,12,26,12,0));
        assertEquals(at(2026,12,28,0,0),december.dates[0]);assertEquals(at(2027,1,1,0,0),december.dates[4]);
        assertEquals(at(2026,12,26,0,0),december.start);assertEquals(at(2027,1,2,0,0),december.end);
        assertEquals("本周末  12/26 – 12/27\n下周  12/28 – 1/1",WeeklyScheduleWidget.rangeLabel(december));
        assertEquals("11/9 – 11/15",WeeklyScheduleWidget.rangeLabel(new WeeklyScheduleWidget.WeekGrid(nov(9,0))));
    }
    @Test public void previewIncludesUpcomingLessonsExamsAndHomeworkAndPreservesThisWeekend(){
        ArrayList<TodayScheduleWidget.Item> all=fixtures();long now=nov(7,9);
        WeeklyScheduleWidget.WeekGrid grid=WeeklyScheduleWidget.weekGrid(all,now);
        assertEquals("下周一课程",grid.days[0].get(0).item.title);
        assertEquals("下周考试",grid.days[1].get(0).item.title);
        assertEquals("下周作业",grid.topItems[2].get(0).title);
        assertEquals("下周五课程",grid.days[4].get(0).item.title);
        assertEquals("本周六安排",grid.days[5].get(0).item.title);
        assertEquals("本周日安排",grid.days[6].get(0).item.title);
        assertTrue(WeeklyScheduleWidget.focusLabel(all,now).contains("本周六安排"));
        assertTrue(WeeklyScheduleWidget.focusLabel(all,nov(7,10)+30*60_000L).startsWith("正在进行"));
        assertTrue(WeeklyScheduleWidget.focusLabel(all,nov(8,13)).contains("下周一课程"));
        assertEquals("周末及下周工作日暂无安排",WeeklyScheduleWidget.focusLabel(new ArrayList<>(),now));
        assertEquals(1,WeeklyScheduleWidget.stage(grid.days[0].get(0).item,now));
        assertTrue(WeeklyTimeline.description(grid).startsWith("周末与下周工作日"));
    }
    private static TextView text(View view,String prefix){
        if(view instanceof TextView&&((TextView)view).getText().toString().startsWith(prefix))return (TextView)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){
            TextView found=text(((ViewGroup)view).getChildAt(i),prefix);if(found!=null)return found;
        }
        return null;
    }
    @Test public void actualHeadersHighlightTheCurrentWeekendAndMatchThePreviewCards(){
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.appwidget.AppWidgetProviderInfo provider=null;
        for(android.appwidget.AppWidgetProviderInfo info:android.appwidget.AppWidgetManager.getInstance(context).getInstalledProviders())
            if(info.provider.equals(new android.content.ComponentName(context,WeeklyScheduleWidget.class)))provider=info;
        assertNotNull(provider);final android.appwidget.AppWidgetProviderInfo declared=provider;
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            ArrayList<TodayScheduleWidget.Item> all=fixtures();long now=nov(7,9);
            WeeklyScheduleWidget.WeekGrid grid=WeeklyScheduleWidget.weekGrid(all,now);
            android.widget.RemoteViews rv=WeeklyScheduleWidget.widgetView(context,7868,all,now,grid,false);
            android.appwidget.AppWidgetHostView root=new android.appwidget.AppWidgetHostView(context);root.setAppWidget(7868,declared);root.updateAppWidget(rv);
            float density=context.getResources().getDisplayMetrics().density;
            for(int widthDp:new int[]{324,700}){
            int width=Math.round(widthDp*density),height=Math.round(600*density);
            root.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));root.layout(0,0,width,height);
            assertEquals("周末与下周",((TextView)root.findViewById(R.id.week_time_axis_title)).getText().toString());
            TextView range=root.findViewById(R.id.week_range);
            assertEquals("本周末  11/7 – 11/8\n下周  11/9 – 11/13",range.getText().toString());
            assertEquals(2,range.getLineCount());assertEquals(0,range.getLayout().getEllipsisCount(1));
            assertTrue(range.getHeight()>=range.getLayout().getHeight());
            assertEquals("11/9",((TextView)root.findViewById(R.id.week_date_mon)).getText().toString());
            assertEquals("11/7",((TextView)root.findViewById(R.id.week_date_sat)).getText().toString());
            assertEquals("今",((TextView)root.findViewById(R.id.week_day_sat)).getText().toString());
            assertEquals("一",((TextView)root.findViewById(R.id.week_day_mon)).getText().toString());
            assertTrue(((TextView)root.findViewById(R.id.week_focus)).getText().toString().contains("本周六安排"));
            View body=((android.widget.ListView)root.findViewById(R.id.week_list)).getChildAt(0);assertNotNull(body);
            assertNotNull(text(body,"下周一课程"));assertNull(text(body,"旧周课程"));
            assertNotNull(text(body,"本周六安排"));assertNotNull(text(body,"本周日安排"));
            assertEquals(AppAppearance.color(context,"surfaceContainerLow"),((ColorDrawable)body.findViewById(R.id.week_native_sat).getBackground()).getColor());
            assertEquals(AppAppearance.color(context,"surface"),((ColorDrawable)body.findViewById(R.id.week_native_mon).getBackground()).getColor());
            assertEquals(View.VISIBLE,body.findViewById(R.id.week_now_row).getVisibility());
            assertEquals("09:00",((TextView)body.findViewById(R.id.week_now_label)).getText().toString());
            long fridayId=AppAppearance.widgetItemId(context,new WeeklyScheduleWidget.WeekGrid(nov(6,12)).start);
            long saturdayId=AppAppearance.widgetItemId(context,grid.start);
            assertNotEquals(fridayId,saturdayId);
            assertEquals(saturdayId,AppAppearance.widgetItemId(context,new WeeklyScheduleWidget.WeekGrid(nov(8,12)).start));
            assertNotEquals(saturdayId,AppAppearance.widgetItemId(context,new WeeklyScheduleWidget.WeekGrid(nov(9,12)).start));
            }
        });
    }
}
