package me.hisunalan.sjtudownloader;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.RectF;
import android.view.View;
import android.widget.ImageView;
import android.widget.RemoteViews;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.TimeZone;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class WeeklyScheduleWidgetTest {
    private static long at(int day,int h,int m){Calendar c=Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));c.clear();c.set(2026,10,day,h,m);return c.getTimeInMillis();}
    private static TodayScheduleWidget.Item course(long start,long end,String name){return new TodayScheduleWidget.Item(start,end,name,"教室203",false,"course",false,"");}
    private static WeeklyScheduleWidget.WeekGrid grid(TodayScheduleWidget.Item... items){ArrayList<TodayScheduleWidget.Item> all=new ArrayList<>();java.util.Collections.addAll(all,items);return WeeklyScheduleWidget.weekGrid(all,at(3,10,0));}
    private static Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
    @Test public void mondayStillUsesShanghaiWeekBoundary(){assertEquals(at(2,0,0),WeeklyScheduleWidget.weekMonday(at(8,23,59)));assertEquals(at(9,0,0),WeeklyScheduleWidget.weekMonday(at(9,0,1)));}
    @Test public void twoPeriodLessonIsOneExactHundredMinuteRectangle(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,8,0),at(2,9,40),"物理"));
        assertEquals(1,g.days[0].size());assertEquals(480,g.days[0].get(0).start,0);assertEquals(580,g.days[0].get(0).end,0);
        RectF r=WeeklyTimeline.bounds(g,g.days[0].get(0),0,324);assertEquals(120,r.height(),.01f);
    }
    @Test public void arbitraryBreakTimeDoesNotSnapToAnotherLesson(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,9,43),at(2,9,57),"课间讨论"));
        WeeklyScheduleWidget.ClassBlock b=g.days[0].get(0);assertEquals(583,b.start,0);assertEquals(597,b.end,0);
        assertEquals(14*1.2f,WeeklyTimeline.bounds(g,b,0,324).height(),.01f);
    }
    @Test public void earlyMorningAndLateNightRemainOnTheirActualMinutes(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,3,17),at(2,3,42),"晨间活动"),course(at(2,23,11),at(2,23,59),"深夜活动"));
        assertTrue(g.firstMinute<=197);assertEquals(1440,g.lastMinute);assertEquals(1391,g.days[0].get(1).start,0);
    }
    @Test public void fiveMinuteEventDoesNotBecomeAWholeClassPeriod(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,12,7),at(2,12,12),"短会"));
        assertEquals(6,WeeklyTimeline.bounds(g,g.days[0].get(0),0,324).height(),.01f);
    }
    @Test public void crossMidnightEventClipsAtBothCalendarDayEdges(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,23,47),at(3,0,13),"跨日活动"));
        assertEquals(1427,g.days[0].get(0).start,0);assertEquals(1440,g.days[0].get(0).end,0);
        assertEquals(0,g.days[1].get(0).start,0);assertEquals(13,g.days[1].get(0).end,0);assertEquals(0,g.firstMinute);
    }
    @Test public void adjacentAppointmentsRemainSeparateAndUseSameLane(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,9,17),at(2,9,43),"活动甲"),course(at(2,9,43),at(2,10,7),"活动乙"));
        assertEquals(2,g.days[0].size());assertEquals(1,g.days[0].get(0).lanes);assertEquals(1,g.days[0].get(1).lanes);
        assertEquals(WeeklyTimeline.bounds(g,g.days[0].get(0),0,324).bottom,WeeklyTimeline.bounds(g,g.days[0].get(1),0,324).top,.01f);
    }
    @Test public void realConflictsKeepIndependentTimesAndColors(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,8,0),at(2,9,40),"物理"),course(at(2,8,17),at(2,8,43),"数学"));
        assertEquals(2,g.days[0].size());assertEquals(2,g.days[0].get(0).lanes);assertNotEquals(g.days[0].get(0).lane,g.days[0].get(1).lane);
        RectF a=WeeklyTimeline.bounds(g,g.days[0].get(0),0,324),b=WeeklyTimeline.bounds(g,g.days[0].get(1),0,324);
        assertTrue(a.right<b.left);assertEquals(26*1.2f,b.height(),.01f);
    }
    @Test public void assignmentRemainsAboveTimelineAndDoesNotChangeHourRange(){
        TodayScheduleWidget.Item due=new TodayScheduleWidget.Item(at(3,23,59),at(3,23,59),"作业","",true,"homework",false,"物理");
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(3,8,0),at(3,9,40),"物理"),due);
        assertEquals(1,g.topItems[1].size());assertTrue(g.lastMinute<1440);
        View rendered=WeeklyScheduleWidget.gridView(context(),g,at(3,8,0)).apply(context(),null);
        TextView chip=rendered.findViewById(me.hisunalan.sjtudownloader.beta.R.id.week_deadline_chip);assertTrue(chip.getText().toString().contains("23:59 截止"));
    }
    @Test public void sameNameAssignmentsFromDifferentCoursesStayDistinct(){
        WeeklyScheduleWidget.WeekGrid g=grid(new TodayScheduleWidget.Item(at(3,23,59),at(3,23,59),"练习","",true,"homework",false,"课程甲"),new TodayScheduleWidget.Item(at(3,23,59),at(3,23,59),"练习","",true,"homework",false,"课程乙"));
        assertEquals(2,g.topItems[1].size());
    }
    @Test public void examNamedAssignmentStillUsesDeadlineLane(){
        WeeklyScheduleWidget.WeekGrid g=grid(new TodayScheduleWidget.Item(at(3,8,0),at(3,8,45),"测验作业","",true,"exam",false,"物理",true),new TodayScheduleWidget.Item(at(3,9,17),at(3,10,3),"正式考试","",true,"exam",false,"物理"));
        assertEquals(1,g.topItems[1].size());assertEquals(1,g.days[1].size());assertEquals(557,g.days[1].get(0).start,0);
    }
    @Test public void duplicateSourcesDoNotDuplicateTheRectangle(){
        TodayScheduleWidget.Item item=course(at(2,8,0),at(2,9,40),"物理");assertEquals(1,grid(item,item,item).days[0].size());
    }
    @Test public void progressDoesNotEraseSubjectIdentity(){
        TodayScheduleWidget.Item active=course(at(2,8,0),at(2,9,40),"物理");
        assertEquals(1,WeeklyScheduleWidget.stage(active,at(2,7,0)));assertEquals(0,WeeklyScheduleWidget.stage(active,at(2,9,0)));assertEquals(-1,WeeklyScheduleWidget.stage(active,at(2,10,0)));
        int color=ScheduleColors.paint(context(),active)[0];assertEquals(color,ScheduleColors.paint(context(),active)[0]);
    }
    @Test public void renderedBitmapUsesBoundedMemoryForEntireTwentyFourHours(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,0,0),at(3,0,0),"全天时段"));
        Bitmap bitmap=WeeklyTimeline.draw(context(),g,at(2,12,0),984);
        android.util.DisplayMetrics metrics=context().getResources().getDisplayMetrics();
        assertTrue(bitmap.getAllocationByteCount()<=(long)metrics.widthPixels*metrics.heightPixels*5+20_000);assertTrue(bitmap.getHeight()>500);bitmap.recycle();
    }
    @Test public void remoteViewsInflateAndReapplyWithoutAccumulatingTimeline(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,8,17),at(2,9,43),"数学"));
        RemoteViews rv=WeeklyScheduleWidget.gridView(context(),g,at(2,8,0));View root=rv.apply(context(),null);
        for(int i=0;i<3;i++){
            android.view.ViewGroup host=root.findViewById(me.hisunalan.sjtudownloader.beta.R.id.week_timeline_host);
            assertEquals(1,host.getChildCount());
            TextView text=root.findViewById(me.hisunalan.sjtudownloader.beta.R.id.week_native_card);
            assertNotNull("Android 12+ must render real text, not scale a timetable bitmap",text);
            assertTrue(text.getText().toString().contains("08:17–09:43"));
            assertNull(root.findViewById(me.hisunalan.sjtudownloader.beta.R.id.week_timeline));rv.reapply(context(),root);
        }
    }
    @Test public void bitmapGeometryRetainsProportionAtPhoneAndTabletWidths(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(2,7,13),at(2,8,27),"数学"));
        RectF phone=WeeklyTimeline.bounds(g,g.days[0].get(0),0,264),tablet=WeeklyTimeline.bounds(g,g.days[0].get(0),0,684);
        assertEquals(phone.top,tablet.top,0);assertEquals(phone.height(),tablet.height(),0);assertTrue(tablet.width()>phone.width());
    }
    @Test public void nativeCardsKeepExactMinutesAndNowLineAtPhoneAndTabletWidths(){
        WeeklyScheduleWidget.WeekGrid g=grid(course(at(3,8,17),at(3,9,43),"数学"));
        float density=context().getResources().getDisplayMetrics().density;
        for(int width:new int[]{324,900}){
            View root=WeeklyScheduleWidget.gridView(context(),g,at(3,9,0),width).apply(context(),null);
            root.measure(View.MeasureSpec.makeMeasureSpec(Math.round(width*density),View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED));
            root.layout(0,0,root.getMeasuredWidth(),root.getMeasuredHeight());
            TextView card=root.findViewById(me.hisunalan.sjtudownloader.beta.R.id.week_native_card);
            View row=(View)card.getParent();
            assertEquals(86*1.2f*density,row.getHeight(),2);
            assertEquals(WeeklyTimeline.position(g,497)*density,row.getTop(),2);
            View line=root.findViewById(me.hisunalan.sjtudownloader.beta.R.id.week_now_row);
            assertEquals(View.VISIBLE,line.getVisibility());
            assertEquals((WeeklyTimeline.position(g,540)-9)*density,line.getTop(),2);
            assertEquals("09:00",((TextView)root.findViewById(me.hisunalan.sjtudownloader.beta.R.id.week_now_label)).getText().toString());
            assertTrue(card.getWidth()>0);
            if(width==324)try{
                Bitmap capture=Bitmap.createBitmap(root.getWidth(),root.getHeight(),Bitmap.Config.ARGB_8888);root.draw(new android.graphics.Canvas(capture));
                try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(context().getFilesDir(),"weekly-native-text.png"))){capture.compress(Bitmap.CompressFormat.PNG,100,out);}capture.recycle();
            }catch(Exception e){throw new AssertionError(e);}
        }
        View outside=WeeklyScheduleWidget.gridView(context(),g,at(3,23,0)).apply(context(),null);
        assertEquals(View.GONE,outside.findViewById(me.hisunalan.sjtudownloader.beta.R.id.week_now_row).getVisibility());
    }
    @Test public void pastWidgetCardsBecomeGrayButCurrentAndFutureKeepTheirColor(){
        TodayScheduleWidget.Item item=course(at(3,8,0),at(3,9,40),"物理");
        int color=ScheduleColors.paint(context(),item)[0];
        assertEquals(color,ScheduleColors.widgetPaint(context(),item,at(3,7,59))[0]);
        assertEquals(color,ScheduleColors.widgetPaint(context(),item,at(3,9,39))[0]);
        assertNotEquals(color,ScheduleColors.widgetPaint(context(),item,at(3,9,40))[0]);
        TodayScheduleWidget.Item other=course(at(2,10,0),at(2,11,0),"数学");
        assertEquals(ScheduleColors.widgetPaint(context(),other,at(3,10,0))[0],ScheduleColors.widgetPaint(context(),item,at(3,10,0))[0]);
    }
    @Test public void twoFixedWidgetProvidersRemainDeclared(){
        AppWidgetProviderInfo day=null,week=null;
        for(AppWidgetProviderInfo info:AppWidgetManager.getInstance(context()).getInstalledProviders()){
            if(info.provider.equals(new ComponentName(context(),UpcomingAgendaWidget.class)))day=info;
            if(info.provider.equals(new ComponentName(context(),WeeklyScheduleWidget.class)))week=info;
        }
        assertNotNull(day);assertNotNull(week);assertEquals(AppWidgetProviderInfo.RESIZE_NONE,week.resizeMode);
        if(android.os.Build.VERSION.SDK_INT>=31){assertEquals(2,day.targetCellWidth);assertEquals(3,day.targetCellHeight);assertEquals(4,week.targetCellWidth);assertEquals(6,week.targetCellHeight);}
    }
}
