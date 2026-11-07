package me.hisunalan.sjtudownloader;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.PowerManager;

/** A durable, non-wakeup minute alarm survives a reclaimed app process.
 * TIME_TICK remains a low-latency fallback while alive. Neither path queries
 * school servers or requires a foreground service. */
final class WidgetClock {
    static final String ACTION_MINUTE="me.hisunalan.sjtudownloader.WIDGET_MINUTE";
    private static int users;
    private static boolean widgetsEnabled,registered;
    private static final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
    private static final BroadcastReceiver receiver=new BroadcastReceiver(){
        @Override public void onReceive(Context context,Intent intent){
            final PendingResult pending=goAsync();
            enqueue(context,!Intent.ACTION_TIME_TICK.equals(intent.getAction()),false,pending::finish);
        }
    };
    static long nextMinute(long now){return (now/TodayScheduleWidget.MINUTE+1)*TodayScheduleWidget.MINUTE+150;}
    static PendingIntent minuteIntent(Context context,int flags){
        Intent intent=new Intent(context,WidgetMinuteReceiver.class).setAction(ACTION_MINUTE);
        return PendingIntent.getBroadcast(context,7291,intent,flags|PendingIntent.FLAG_IMMUTABLE);
    }
    static void schedule(Context context,boolean enabled,long now){
        AlarmManager alarm=context.getSystemService(AlarmManager.class);
        if(alarm==null)return;
        if(!enabled){
            PendingIntent old=minuteIntent(context,PendingIntent.FLAG_NO_CREATE);
            if(old!=null){alarm.cancel(old);old.cancel();}
            TodayScheduleWidget.preferences(context).edit().putLong("nextMinuteAt",0).apply();return;
        }
        long at=nextMinute(now);
        PendingIntent pending=minuteIntent(context,PendingIntent.FLAG_UPDATE_CURRENT);
        boolean exact=TodayScheduleWidget.canScheduleExact(context);
        try{
            // RTC deliberately does not wake a sleeping device. Overdue alarms
            // are delivered when it wakes; idle-mode quotas are not bypassed.
            if(exact)alarm.setExact(AlarmManager.RTC,at,pending);
            else alarm.set(AlarmManager.RTC,at,pending);
        }catch(SecurityException denied){exact=false;alarm.set(AlarmManager.RTC,at,pending);}
        TodayScheduleWidget.preferences(context).edit().putLong("nextMinuteAt",at).putBoolean("minuteExact",exact).apply();
    }
    static boolean hasWeekly(Context context){
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context,WeeklyScheduleWidget.class)).length>0;
    }
    static boolean shouldRender(boolean interactive,boolean forced,long now,long rendered){
        return interactive&&(forced||rendered/TodayScheduleWidget.MINUTE!=now/TodayScheduleWidget.MINUTE);
    }
    static void enqueue(Context context,boolean forced,boolean alarm,Runnable finished){
        Context app=context.getApplicationContext();
        worker.execute(()->{
            try{
                long now=System.currentTimeMillis();
                if(alarm)TodayScheduleWidget.preferences(app).edit().putLong("lastMinuteAlarmAt",now)
                    .putInt("lastMinuteAlarmPid",android.os.Process.myPid()).apply();
                tick(app,now,forced);
            }catch(Exception failure){
                TodayScheduleWidget.preferences(app).edit().putString("minuteError",failure.getClass().getSimpleName()).apply();
            }finally{finished.run();}
        });
    }
    static void tick(Context context,long now,boolean forced){
        boolean enabled=hasWeekly(context);
        configure(context,enabled);
        // Keep exactly one alarm pending even while the screen is off. It
        // cannot wake the CPU, and restores the clock after process death.
        schedule(context,enabled,now);
        if(!enabled)return;
        PowerManager power=context.getSystemService(PowerManager.class);
        long rendered=TodayScheduleWidget.preferences(context).getLong("lastRenderAt",0);
        if(shouldRender(power!=null&&power.isInteractive(),forced,now,rendered))TodayScheduleWidget.refresh(context);
    }
    static synchronized void configure(Context context,boolean enabled){widgetsEnabled=enabled;reconcile(context);}
    static synchronized void acquire(Context context){
        users++;reconcile(context);schedule(context,hasWeekly(context),System.currentTimeMillis());
    }
    static synchronized void release(Context context){if(users>0)users--;reconcile(context);}
    private static void reconcile(Context context){
        boolean needed=widgetsEnabled||users>0;
        if(needed==registered)return;
        if(needed){
            IntentFilter filter=new IntentFilter(Intent.ACTION_TIME_TICK);
            filter.addAction(Intent.ACTION_SCREEN_ON);filter.addAction(Intent.ACTION_USER_PRESENT);
            filter.addAction(Intent.ACTION_TIME_CHANGED);filter.addAction(Intent.ACTION_DATE_CHANGED);filter.addAction(Intent.ACTION_TIMEZONE_CHANGED);
            filter.addAction(Intent.ACTION_CONFIGURATION_CHANGED);
            if(Build.VERSION.SDK_INT>=33)context.getApplicationContext().registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);
            else context.getApplicationContext().registerReceiver(receiver,filter);
        }else context.getApplicationContext().unregisterReceiver(receiver);
        registered=needed;
    }
}
