package me.hisunalan.sjtudownloader;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Exercise the names/annotations the installed WebView bridge discovers,
 * against the same packaged application that will be published. */
@RunWith(AndroidJUnit4.class)
public class NativeBridgeContractTest {
    @Test public void optimizedPackageRetainsEveryNativeBridgeEntryPoint() throws Exception {
        assertEquals("SjtuCanvas",SjtuCanvasPlugin.class.getAnnotation(CapacitorPlugin.class).name());
        for(String method:new String[]{"status","courses","files","download","login","logout","calendarWeek","calendarWeekSupplement",
            "exams","agendaSettings","saveAgendaSettings","widgetStatus","refreshTodayWidget","deviceAppearance","setAppAppearance","scheduleColors"}){
            assertNotNull(method,SjtuCanvasPlugin.class.getDeclaredMethod(method,PluginCall.class).getAnnotation(PluginMethod.class));
        }
        for(String name:new String[]{"com.capacitorjs.plugins.app.AppPlugin","com.capacitorjs.plugins.haptics.HapticsPlugin"})
            assertNotNull(name,Class.forName(name).getAnnotation(CapacitorPlugin.class));
        try {
            SjtuCanvasPlugin.class.getDeclaredMethod("testAgendaNotification",PluginCall.class);
            fail("Retired notification test must not be exposed to the WebView");
        } catch (NoSuchMethodException expected) { }
    }
}
