package me.hisunalan.sjtudownloader;

import android.app.Instrumentation;
import android.app.AlarmManager;
import android.content.SharedPreferences;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** CI-only setup/cleanup for a real OS-alarm/process-death probe. This test
 * exists only in the test APK and never adds an application/debug screen. */
@org.junit.runner.RunWith(androidx.test.ext.junit.runners.AndroidJUnit4.class)
public final class WidgetClockColdStartProbeTest {
    private static final int HOST=7195;
    private final Instrumentation instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation();
    private final Bundle arguments=androidx.test.platform.app.InstrumentationRegistry.getArguments();
    private String shell(String command) throws Exception {
        try(ParcelFileDescriptor.AutoCloseInputStream stream=new ParcelFileDescriptor.AutoCloseInputStream(instrumentation.getUiAutomation().executeShellCommand(command))){
            java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] bytes=new byte[4096];int n;
            while((n=stream.read(bytes))!=-1)out.write(bytes,0,n);
            return out.toString("UTF-8");
        }
    }
    private static String read(File file) throws Exception {
        try(FileInputStream stream=new FileInputStream(file)){
            java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] bytes=new byte[4096];int n;
            while((n=stream.read(bytes))!=-1)out.write(bytes,0,n);return out.toString("UTF-8");
        }
    }
    private SharedPreferences prefs(Context context){return context.getSharedPreferences("sjtu-today-widget-v1",Context.MODE_PRIVATE);}
    private boolean exact(Context context){return context.getSystemService(AlarmManager.class).canScheduleExactAlarms();}
    private void refresh(Context context){
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        new WeeklyScheduleWidget().onUpdate(context,manager,manager.getAppWidgetIds(new ComponentName(context,WeeklyScheduleWidget.class)));
    }
    private long midnight(long now){
        java.util.Calendar day=java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Shanghai"));day.setTimeInMillis(now);
        day.set(java.util.Calendar.HOUR_OF_DAY,0);day.set(java.util.Calendar.MINUTE,0);day.set(java.util.Calendar.SECOND,0);day.set(java.util.Calendar.MILLISECOND,0);return day.getTimeInMillis();
    }
    @org.junit.Test public void verifyRecoverySetupOrCleanup() throws Exception {
        org.junit.Assume.assumeTrue("Standalone CI probe",arguments.getString("clockProbeMode")!=null);
        Bundle result=new Bundle();
        try{
            if(!"1".equals(shell("getprop ro.kernel.qemu").trim()))throw new IllegalStateException("Probe requires an emulator");
            Context context=instrumentation.getTargetContext();String pkg=context.getPackageName();
            File backup=new File(context.getFilesDir(),"widget-clock-probe-backup.json");
            if("cleanup".equals(arguments.getString("clockProbeMode"))){
                new AppWidgetHost(context,HOST).deleteHost();
                if(backup.exists()){
                    JSONObject previous=new JSONObject(read(backup));
                    TodayScheduleWidget.persist(context,new JSONArray(previous.getString("events")),true);
                    result.putBoolean("exactOriginallyAllowed",previous.optBoolean("exact"));
                    if(!backup.delete())throw new java.io.IOException("Probe backup cleanup failed");
                }
                shell("appwidget revokebind --package "+pkg+" --user 0");
                refresh(context);result.putString("clockProbe","clean");
            }else{
                if(backup.exists())throw new IllegalStateException("Previous probe must be cleaned up first");
                JSONObject previous=new JSONObject().put("events",prefs(context).getString("events","[]"))
                    .put("exact",exact(context));
                try(FileOutputStream out=new FileOutputStream(backup)){out.write(previous.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}
                shell("appwidget grantbind --package "+pkg+" --user 0");
                if(!exact(context))shell("appops set "+pkg+" SCHEDULE_EXACT_ALARM allow");
                if(!exact(context))throw new IllegalStateException("Exact alarm setup failed");
                AppWidgetHost host=new AppWidgetHost(context,HOST);int id=host.allocateAppWidgetId();
                if(!AppWidgetManager.getInstance(context).bindAppWidgetIdIfAllowed(id,new ComponentName(context,WeeklyScheduleWidget.class)))throw new IllegalStateException("Widget binding denied");
                long now=System.currentTimeMillis(),day=midnight(now);
                JSONObject event=new JSONObject().put("title","分钟刷新验证").put("startMs",day).put("endMs",day+86_400_000L)
                    .put("category","course").put("kind","course");
                TodayScheduleWidget.persist(context,new JSONArray().put(event),true);
                refresh(context);
                if(prefs(context).getInt("weeklyRenderedInstances",0)!=1)throw new IllegalStateException("Widget render failed");
                prefs(context).edit().putLong("lastMinuteAlarmAt",0).putInt("lastMinuteAlarmPid",0).commit();
                result.putString("clockProbe","ready");result.putInt("seedPid",android.os.Process.myPid());
                result.putLong("expectedAt",prefs(context).getLong("nextMinuteAt",0));
            }
            instrumentation.addResults(result);
        }catch(Exception error){result.putString("clockProbe","failed");result.putString("error",error.toString());instrumentation.addResults(result);throw error;}
    }
}
