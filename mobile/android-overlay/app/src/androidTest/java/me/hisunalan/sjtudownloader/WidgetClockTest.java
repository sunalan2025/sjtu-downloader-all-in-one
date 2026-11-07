package me.hisunalan.sjtudownloader;

import android.app.PendingIntent;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.ListView;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import me.hisunalan.sjtudownloader.beta.R;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.ArrayList;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class WidgetClockTest {
    private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
    @Test public void minuteAlarmAlignsToNextBoundaryInsteadOfDrifting(){
        long minute=1_800_000_000_000L;
        assertEquals(minute+60_150,WidgetClock.nextMinute(minute));
        assertEquals(minute+60_150,WidgetClock.nextMinute(minute+59_999));
        assertEquals(minute+120_150,WidgetClock.nextMinute(minute+60_000));
    }
    @Test public void screenOffSkipsDrawingButResumeCorrectsTheSameMinute(){
        long now=1_800_000_012_000L;
        assertFalse(WidgetClock.shouldRender(false,true,now,now-60_000));
        assertFalse(WidgetClock.shouldRender(true,false,now,now-1000));
        assertTrue(WidgetClock.shouldRender(true,false,now,now-60_000));
        assertTrue(WidgetClock.shouldRender(true,true,now,now-1000));
    }
    @Test public void deletedWidgetCancelsTheDurablePendingIntent(){
        WidgetClock.schedule(context(),true,System.currentTimeMillis());
        assertNotNull(WidgetClock.minuteIntent(context(),PendingIntent.FLAG_NO_CREATE));
        WidgetClock.schedule(context(),false,System.currentTimeMillis());
        assertNull(WidgetClock.minuteIntent(context(),PendingIntent.FLAG_NO_CREATE));
        assertEquals(0,TodayScheduleWidget.preferences(context()).getLong("nextMinuteAt",-1));
    }
    @Test public void minuteReceiverIsPackagedAndNotExternallyExported() throws Exception {
        android.content.pm.ActivityInfo info=context().getPackageManager().getReceiverInfo(new ComponentName(context(),WidgetMinuteReceiver.class),0);
        assertFalse(info.exported);assertTrue(info.enabled);
    }
    @Test public void inlineClockUpdateChangesLabelAndPreservesManualScroll(){
        Context context=context();
        AppWidgetProviderInfo provider=null;
        for(AppWidgetProviderInfo info:AppWidgetManager.getInstance(context).getInstalledProviders())
            if(info.provider.equals(new ComponentName(context,WeeklyScheduleWidget.class)))provider=info;
        assertNotNull(provider);
        final AppWidgetProviderInfo declared=provider;
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            long day=TodayScheduleWidget.midnight(System.currentTimeMillis(),0),now=day+12*60*60_000L;
            ArrayList<TodayScheduleWidget.Item> events=new ArrayList<>();
            events.add(new TodayScheduleWidget.Item(day,day+TodayScheduleWidget.DAY,"全天时间轴","",false,"course",false,""));
            WeeklyScheduleWidget.WeekGrid grid=WeeklyScheduleWidget.weekGrid(events,now);
            AppWidgetHostView host=new AppWidgetHostView(context);host.setAppWidget(7715,declared);
            host.updateAppWidget(WeeklyScheduleWidget.widgetView(context,7715,events,now,grid,false));
            int width=Math.round(600*context.getResources().getDisplayMetrics().density),height=Math.round(500*context.getResources().getDisplayMetrics().density);
            host.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));host.layout(0,0,width,height);
            ListView list=host.findViewById(R.id.week_list);assertNotNull(list);assertEquals(1,list.getAdapter().getCount());
            // Each collection child is an Android root namespace. Read it
            // through its own host, just as the launcher applies row updates.
            assertEquals("12:00",((TextView)list.getChildAt(0).findViewById(R.id.week_now_label)).getText().toString());
            list.scrollListBy(200);int top=list.getChildAt(0).getTop();assertTrue("fixture must be scrolled",top<0);
            host.updateAppWidget(WeeklyScheduleWidget.widgetView(context,7715,events,now+60_000,grid,false));
            host.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));host.layout(0,0,width,height);
            assertEquals("12:01",((TextView)list.getChildAt(0).findViewById(R.id.week_now_label)).getText().toString());
            assertEquals("minute updates must not jump to the top",top,list.getChildAt(0).getTop(),2);
        });
    }
}
