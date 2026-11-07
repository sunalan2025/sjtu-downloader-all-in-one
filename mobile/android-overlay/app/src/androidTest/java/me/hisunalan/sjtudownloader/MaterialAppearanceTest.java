package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import androidx.core.graphics.ColorUtils;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.Map;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class MaterialAppearanceTest {
    private Context context;
    private SharedPreferences prefs;
    private Map<String,?> previous;
    @Before public void setup() {
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        prefs=context.getSharedPreferences("sjtu-material-appearance-v1",Context.MODE_PRIVATE);
        previous=prefs.getAll();prefs.edit().clear().commit();
    }
    @After public void restore(){
        SharedPreferences.Editor editor=prefs.edit().clear();
        for(Map.Entry<String,?> entry:previous.entrySet()) {
            if(entry.getValue() instanceof String)editor.putString(entry.getKey(),(String)entry.getValue());
            if(entry.getValue() instanceof Boolean)editor.putBoolean(entry.getKey(),(Boolean)entry.getValue());
        }
        editor.commit();
    }
    private JSObject appearance(boolean dark,String mode){
        JSObject input=new JSObject();input.put("dark",dark);input.put("mode",mode);return input;
    }
    @Test public void nativeChromeUsesReadableFallbackRolesInBothModes(){
        for(boolean dark:new boolean[]{false,true}) {
            AppAppearance.save(context,appearance(dark,dark?"dark":"light"));
            assertEquals(dark,AppAppearance.isDark(context));
            assertTrue(ColorUtils.calculateContrast(AppAppearance.color(context,"onSurface"),AppAppearance.color(context,"surface"))>=7);
            assertTrue(ColorUtils.calculateContrast(AppAppearance.color(context,"onPrimary"),AppAppearance.color(context,"primary"))>=4.5);
            assertTrue(ColorUtils.calculateContrast(AppAppearance.color(context,"onSecondaryContainer"),AppAppearance.color(context,"secondaryContainer"))>=7);
        }
    }
    @Test public void palettePersistsSeparatelyForLightAndDark(){
        JSObject light=appearance(false,"light"),dark=appearance(true,"dark");
        JSObject lightColors=new JSObject();lightColors.put("primary","#125678");light.put("colors",lightColors);
        JSObject darkColors=new JSObject();darkColors.put("primary","#abcdef");dark.put("colors",darkColors);
        AppAppearance.save(context,light);assertEquals(Color.parseColor("#125678"),AppAppearance.color(context,"primary"));
        AppAppearance.save(context,dark);assertEquals(Color.parseColor("#abcdef"),AppAppearance.color(context,"primary"));
        prefs.edit().putString("mode","light").putBoolean("dark",false).commit();
        assertEquals(Color.parseColor("#125678"),AppAppearance.color(context,"primary"));
    }
    @Test public void cachedPaletteNoticesColorChangesInTheSameTheme(){
        AppAppearance.save(context,appearance(false,"light"));
        prefs.edit().putString("light.colors","{\"primary\":\"#225577\"}").commit();
        assertEquals(Color.parseColor("#225577"),AppAppearance.color(context,"primary"));
        prefs.edit().putString("light.colors","{\"primary\":\"#447799\"}").commit();
        assertEquals(Color.parseColor("#447799"),AppAppearance.color(context,"primary"));
        prefs.edit().putString("light.colors","bad-json").commit();
        assertEquals(Color.parseColor("#005ac1"),AppAppearance.color(context,"primary"));
    }
    @Test public void systemModeFollowsAndroidConfigurationAndExposesDynamicSeed(){
        AppAppearance.save(context,appearance(false,"system"));
        Configuration config=new Configuration(context.getResources().getConfiguration());
        config.uiMode=(config.uiMode&~Configuration.UI_MODE_NIGHT_MASK)|Configuration.UI_MODE_NIGHT_YES;
        assertTrue(AppAppearance.isDark(context.createConfigurationContext(config)));
        config.uiMode=(config.uiMode&~Configuration.UI_MODE_NIGHT_MASK)|Configuration.UI_MODE_NIGHT_NO;
        assertFalse(AppAppearance.isDark(context.createConfigurationContext(config)));
        JSObject device=AppAppearance.device(context);
        assertEquals(AppAppearance.systemDark(context),device.optBoolean("dark"));
        if(Build.VERSION.SDK_INT>=31)assertTrue(device.optString("systemSeed").matches("#[0-9a-fA-F]{6}"));
    }
    @Test public void systemThemeChangeRefreshesWidgetsEvenWithCachedPalette(){
        AppAppearance.save(context,appearance(true,"system"));
        AppAppearance.save(context,appearance(false,"system"));
        assertFalse(AppAppearance.save(context,appearance(false,"system")));
        Configuration config=new Configuration(context.getResources().getConfiguration());
        config.uiMode=(config.uiMode&~Configuration.UI_MODE_NIGHT_MASK)|Configuration.UI_MODE_NIGHT_YES;
        Context darkContext=context.createConfigurationContext(config);
        assertTrue(AppAppearance.save(darkContext,appearance(true,"system")));
        assertFalse(AppAppearance.save(darkContext,appearance(true,"system")));
    }
    @Test public void widgetRowsAndNativeDialogHaveMaterialThemes(){
        for(boolean dark:new boolean[]{false,true}){
            AppAppearance.save(context,appearance(dark,dark?"dark":"light"));
            assertEquals(dark?me.hisunalan.sjtudownloader.beta.R.style.SJTUMaterialDialog_Dark:
                me.hisunalan.sjtudownloader.beta.R.style.SJTUMaterialDialog,AppAppearance.dialogStyle(context));
            TodayScheduleWidget.Item item=new TodayScheduleWidget.Item(System.currentTimeMillis()+60_000,
                System.currentTimeMillis()+3_600_000,"主题测试课程","测试教室",false,"course",false,"");
            android.widget.RemoteViews row=TodayScheduleWidget.rowView(context,item);
            android.view.View result=row.apply(context,new android.widget.FrameLayout(context));
            android.widget.TextView title=result.findViewById(me.hisunalan.sjtudownloader.beta.R.id.widget_row_title);
            assertEquals(AppAppearance.color(context,"onSurface"),title.getCurrentTextColor());
        }
    }
}
