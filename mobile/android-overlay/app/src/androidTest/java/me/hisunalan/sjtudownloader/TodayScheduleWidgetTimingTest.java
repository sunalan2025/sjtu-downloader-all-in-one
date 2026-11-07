package me.hisunalan.sjtudownloader;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.ArrayList;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TodayScheduleWidgetTimingTest {
    private static TodayScheduleWidget.Item event(long start,long end,String category,boolean deadline) {
        return new TodayScheduleWidget.Item(start,end,"测试安排","",deadline,category,false,"");
    }

    @Test public void currentEventWinsOverCompletedAndUpcoming() {
        long now=1800000000000L;
        ArrayList<TodayScheduleWidget.Item> items=new ArrayList<>();
        items.add(event(now-7200000,now-3600000,"course",false));
        items.add(event(now-900000,now+1800000,"course",false));
        items.add(event(now+3600000,now+5400000,"course",false));
        assertEquals(1,TodayScheduleWidget.firstRelevantIndex(items,now));
        assertTrue(TodayScheduleWidget.focusText(items,now).startsWith("进行中"));
        assertEquals(now+1801000,TodayScheduleWidget.nextRefreshTime(items,now));
    }

    @Test public void nearestFutureStartTriggersRefresh() {
        long now=1800000000000L;
        ArrayList<TodayScheduleWidget.Item> items=new ArrayList<>();
        items.add(event(now-7200000,now-3600000,"course",false));
        items.add(event(now+900000,now+3600000,"course",false));
        assertEquals(1,TodayScheduleWidget.firstRelevantIndex(items,now));
        assertTrue(TodayScheduleWidget.focusText(items,now).startsWith("下一项"));
        assertEquals(now+901000,TodayScheduleWidget.nextRefreshTime(items,now));
    }

    @Test public void homeworkIsInstantButTimedExamIsOngoing() {
        long now=1800000000000L;
        TodayScheduleWidget.Item homework=event(now-60000,now-60000,"homework",true);
        TodayScheduleWidget.Item exam=event(now-60000,now+3600000,"exam",true);
        assertFalse(TodayScheduleWidget.ongoing(homework,now));
        assertTrue(TodayScheduleWidget.ongoing(exam,now));
        ArrayList<TodayScheduleWidget.Item> items=new ArrayList<>();
        items.add(homework);
        assertEquals(-1,TodayScheduleWidget.firstRelevantIndex(items,now));
        items.add(exam);
        assertEquals(1,TodayScheduleWidget.firstRelevantIndex(items,now));
    }

    @Test public void widgetChangesAtExactLectureAndExamBoundaries() {
        long now=1800000000000L;
        ArrayList<TodayScheduleWidget.Item> all=new ArrayList<>();
        all.add(event(now+2*60000,now+102*60000,"course",false));
        all.add(event(now+6*60000,now+66*60000,"exam",true));
        assertEquals(now+2*60000+1000,TodayScheduleWidget.nextRefreshTime(all,now));
        assertEquals(now+6*60000+1000,
            TodayScheduleWidget.nextRefreshTime(all,now+2*60000+2000));
        assertEquals(now+66*60000+1000,
            TodayScheduleWidget.nextRefreshTime(all,now+6*60000+2000));
    }

    @Test public void deadlineBoundaryTriggersARefreshDespiteNotBeingOngoing() {
        long now=1800000000000L;
        ArrayList<TodayScheduleWidget.Item> all=new ArrayList<>();
        all.add(event(now+10*60000,now+10*60000,"homework",true));
        assertEquals(now+10*60000+1000,TodayScheduleWidget.nextRefreshTime(all,now));
        assertFalse(TodayScheduleWidget.ongoing(all.get(0),now+11*60000));
    }

    @Test public void launcherHasHalfHourlyRecoveryInAdditionToAlarmBoundaries() {
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .getTargetContext();
        android.content.Context context=
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .getTargetContext();
        android.appwidget.AppWidgetManager manager=
            android.appwidget.AppWidgetManager.getInstance(context);
        boolean daily=false,weekly=false;
        for(android.appwidget.AppWidgetProviderInfo provider:manager.getInstalledProviders()){
            if(provider.provider.equals(new android.content.ComponentName(
                context,UpcomingAgendaWidget.class))){
                daily=true;
                assertEquals(1800000,provider.updatePeriodMillis);
            }
            if(provider.provider.equals(new android.content.ComponentName(
                context,WeeklyScheduleWidget.class))){
                weekly=true;
                assertEquals(1800000,provider.updatePeriodMillis);
            }
        }
        assertTrue(daily);
        assertTrue(weekly);
    }

    @Test public void afterTheLastEventNextWakeupIsTomorrow() {
        long now=1800000000000L;
        ArrayList<TodayScheduleWidget.Item> items=new ArrayList<>();
        items.add(event(now-3600000,now-1800000,"course",false));
        assertEquals(TodayScheduleWidget.midnight(now,1)+TodayScheduleWidget.MINUTE,
            TodayScheduleWidget.nextRefreshTime(items,now));
        assertEquals(-1,TodayScheduleWidget.firstRelevantIndex(items,now));
    }

    @Test public void timedClassTakesPriorityOverAllDayAgenda() {
        long now=1800000000000L;
        long morning=TodayScheduleWidget.midnight(now,0);
        ArrayList<TodayScheduleWidget.Item> items=new ArrayList<>();
        items.add(new TodayScheduleWidget.Item(morning,morning+2700000,
            "全天安排","",false,"event",true,""));
        items.add(event(now-60000,now+3600000,"course",false));
        assertEquals(1,TodayScheduleWidget.firstRelevantIndex(items,now));
        assertTrue(TodayScheduleWidget.focusText(items,now).startsWith("进行中"));
        items.set(1,event(now+3600000,now+5400000,"course",false));
        assertEquals(1,TodayScheduleWidget.firstRelevantIndex(items,now));
        assertTrue(TodayScheduleWidget.focusText(items,now).startsWith("下一项"));
    }

    @Test public void allDayPlanStaysActiveUntilShanghaiMidnight() {
        long now=1800000000000L;
        long morning=TodayScheduleWidget.midnight(now,0);
        TodayScheduleWidget.Item allDay=new TodayScheduleWidget.Item(
            morning,morning+2700000,"全天事项","",false,"event",true,"");
        assertTrue(TodayScheduleWidget.ongoing(allDay,now));
        assertFalse(TodayScheduleWidget.ongoing(allDay,TodayScheduleWidget.midnight(now,1)));
    }
}
