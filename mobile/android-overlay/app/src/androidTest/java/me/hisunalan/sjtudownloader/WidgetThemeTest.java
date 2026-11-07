package me.hisunalan.sjtudownloader;

import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ListView;
import android.widget.TextView;
import androidx.core.graphics.ColorUtils;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import me.hisunalan.sjtudownloader.beta.R;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class WidgetThemeTest {
    private Context context;
    private SharedPreferences prefs;
    private Map<String,?> previous;
    @Before public void setup(){
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        prefs=context.getSharedPreferences("sjtu-material-appearance-v1",Context.MODE_PRIVATE);
        previous=prefs.getAll();prefs.edit().clear().commit();
    }
    @After public void restore(){
        SharedPreferences.Editor edit=prefs.edit().clear();
        for(Map.Entry<String,?> entry:previous.entrySet()){
            if(entry.getValue() instanceof String)edit.putString(entry.getKey(),(String)entry.getValue());
            if(entry.getValue() instanceof Boolean)edit.putBoolean(entry.getKey(),(Boolean)entry.getValue());
        }
        edit.commit();
    }
    private void save(boolean dark,String primary){
        JSObject colors=new JSObject();
        colors.put("surface",dark?"#101519":"#f8fafc");
        colors.put("surfaceContainer",dark?"#202529":"#edf0f4");
        colors.put("surfaceContainerLow",dark?"#1b2024":"#f1f4f8");
        colors.put("onSurface",dark?"#e2e7eb":"#181d21");
        colors.put("onSurfaceVariant",dark?"#c2c7cb":"#42474b");
        colors.put("primary",primary);
        JSObject input=new JSObject();input.put("mode",dark?"dark":"light");input.put("dark",dark);input.put("colors",colors);
        AppAppearance.save(context,input);
    }
    @Test public void renderSnapshotCannotMixPalettesDuringAConcurrentThemeChange(){
        save(false,"#005ac1");Context light=AppAppearance.widgetContext(context);
        long key=AppAppearance.widgetItemId(light,123);
        save(true,"#adc6ff");Context dark=AppAppearance.widgetContext(context);
        assertFalse(AppAppearance.isDark(light));assertTrue(AppAppearance.isDark(dark));
        assertEquals(0xfff8fafc,AppAppearance.color(light,"surface"));
        assertEquals(0xff101519,AppAppearance.color(dark,"surface"));
        Context legacy=AppAppearance.widgetContext(context,AppAppearance.widgetIntent(light,new android.content.Intent()));
        assertFalse(AppAppearance.isDark(legacy));assertEquals(0xfff8fafc,AppAppearance.color(legacy,"surface"));
        assertEquals(key,AppAppearance.widgetItemId(light,123));
        assertNotEquals(key,AppAppearance.widgetItemId(dark,123));
        long darkKey=AppAppearance.widgetItemId(dark,123);
        assertEquals(darkKey,AppAppearance.widgetItemId(AppAppearance.widgetContext(context),123));
        save(true,"#aaffbb");assertNotEquals(darkKey,AppAppearance.widgetItemId(context,123));
    }
    @Test public void systemModeUsesTheCurrentConfigurationAndExplicitModesKeepTheirChoice(){
        save(false,"#005ac1");save(true,"#adc6ff");
        prefs.edit().putString("mode","system").putBoolean("dark",false).commit();
        Configuration config=new Configuration(context.getResources().getConfiguration());
        config.uiMode=(config.uiMode&~Configuration.UI_MODE_NIGHT_MASK)|Configuration.UI_MODE_NIGHT_YES;
        Context night=context.createConfigurationContext(config);
        assertTrue(AppAppearance.isDark(AppAppearance.widgetContext(night)));
        assertEquals(0xff101519,AppAppearance.color(AppAppearance.widgetContext(night),"surface"));
        config.uiMode=(config.uiMode&~Configuration.UI_MODE_NIGHT_MASK)|Configuration.UI_MODE_NIGHT_NO;
        assertFalse(AppAppearance.isDark(AppAppearance.widgetContext(context.createConfigurationContext(config))));
        prefs.edit().putString("mode","light").putBoolean("dark",false).commit();
        assertFalse(AppAppearance.isDark(AppAppearance.widgetContext(night)));
    }
    private static TextView card(View view,String title){
        if(view.getId()==R.id.week_native_card&&view instanceof TextView&&((TextView)view).getText().toString().startsWith(title))return (TextView)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){
            TextView found=card(((ViewGroup)view).getChildAt(i),title);if(found!=null)return found;
        }
        return null;
    }
    private static void layout(View view,int width,int height){
        view.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));
        view.layout(0,0,width,height);
    }
    @Test public void existingLauncherHostSwitchesAllSurfacesTogetherAndKeepsPastelEvents(){
        AppWidgetProviderInfo provider=null;
        for(AppWidgetProviderInfo info:AppWidgetManager.getInstance(context).getInstalledProviders())
            if(info.provider.equals(new ComponentName(context,WeeklyScheduleWidget.class)))provider=info;
        assertNotNull(provider);final AppWidgetProviderInfo declared=provider;
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            long now=java.time.ZonedDateTime.of(2026,11,5,9,47,0,0,java.time.ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli();
            long monday=WeeklyScheduleWidget.weekMonday(now),day=TodayScheduleWidget.midnight(now,0);
            ArrayList<TodayScheduleWidget.Item> events=new ArrayList<>();
            TodayScheduleWidget.Item past=new TodayScheduleWidget.Item(monday+8*3_600_000,monday+10*3_600_000,"过去课程","教室1",false,"course",false,"");
            TodayScheduleWidget.Item future=new TodayScheduleWidget.Item(day+10*3_600_000,day+12*3_600_000,"未来课程","教室2",false,"course",false,"");
            TodayScheduleWidget.Item exam=new TodayScheduleWidget.Item(day+11*3_600_000,day+12*3_600_000,"期中","教室3",false,"exam",false,"");
            events.add(past);events.add(future);events.add(exam);
            WeeklyScheduleWidget.WeekGrid grid=WeeklyScheduleWidget.weekGrid(events,now);
            AppWidgetHostView host=new AppWidgetHostView(context);host.setAppWidget(7857,declared);
            float density=context.getResources().getDisplayMetrics().density;
            int width=Math.round(700*density),height=Math.round(600*density);long previousId=-1;
            for(boolean dark:new boolean[]{false,true,false,true}){
                save(dark,dark?"#adc6ff":"#005ac1");Context theme=AppAppearance.widgetContext(context);
                host.updateAppWidget(WeeklyScheduleWidget.widgetView(theme,7857,events,now,grid,false));layout(host,width,height);
                assertEquals(AppAppearance.color(theme,"surfaceContainer"),host.findViewById(R.id.week_widget_root).getBackgroundTintList().getDefaultColor());
                assertEquals(AppAppearance.color(theme,"onSurface"),((TextView)host.findViewById(R.id.week_time_axis_title)).getCurrentTextColor());
                ListView list=host.findViewById(R.id.week_list);assertNotNull(list.getChildAt(0));
                long id=list.getAdapter().getItemId(0);assertNotEquals(previousId,id);previousId=id;
                View body=list.getChildAt(0);
                assertEquals(AppAppearance.color(theme,"surface"),((ColorDrawable)body.findViewById(R.id.week_grid_body_surface).getBackground()).getColor());
                assertEquals(AppAppearance.color(theme,"surface"),((ColorDrawable)body.findViewById(R.id.week_native_axis).getBackground()).getColor());
                TextView old=card(body,"过去课程"),next=card(body,"未来课程"),test=card(body,"期中");
                assertNotNull(old);assertNotNull(next);assertNotNull(test);
                assertEquals(dark?0xff44484e:0xffe2e5e9,old.getBackgroundTintList().getDefaultColor());
                assertTrue(ColorUtils.calculateLuminance(next.getBackgroundTintList().getDefaultColor())>.4);
                assertEquals(0xffffc1c4,test.getBackgroundTintList().getDefaultColor());
                for(TextView text:new TextView[]{old,next,test})assertTrue(ColorUtils.calculateContrast(text.getCurrentTextColor(),text.getBackgroundTintList().getDefaultColor())>=4.5);
                assertEquals(AppAppearance.color(theme,"onSurfaceVariant"),((TextView)body.findViewById(R.id.week_native_hour)).getCurrentTextColor());
                try{
                    Bitmap capture=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);host.draw(new Canvas(capture));
                    try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(context.getFilesDir(),"widget-theme-"+(dark?"dark":"light")+".png"))){capture.compress(Bitmap.CompressFormat.PNG,100,out);}
                    capture.recycle();
                }catch(Exception error){throw new AssertionError(error);}
            }
        });
    }
}
