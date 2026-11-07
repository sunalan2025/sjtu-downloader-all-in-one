package me.hisunalan.sjtudownloader;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.util.Locale;
import me.hisunalan.sjtudownloader.beta.R;

/** Same Material roles in WebView, native authentication chrome and widgets. */
final class AppAppearance {
    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("sjtu-material-appearance-v1", Context.MODE_PRIVATE);
    }
    static boolean systemDark(Context context) {
        return (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
    }
    static boolean isDark(Context context) {
        if(context instanceof WidgetContext)return ((WidgetContext)context).dark;
        SharedPreferences p = prefs(context);
        return "system".equals(p.getString("mode", "system")) ? systemDark(context) : p.getBoolean("dark", false);
    }
    private static final String[] paletteJson=new String[2];
    private static final JSONObject[] palettes=new JSONObject[2];
    private static synchronized String savedColor(Context context,boolean dark,String role){
        int index=dark?1:0;
        String stored=prefs(context).getString(dark?"dark.colors":"light.colors","{}");
        if(palettes[index]==null||!stored.equals(paletteJson[index])){
            try{palettes[index]=new JSONObject(stored);}catch(Exception ignored){palettes[index]=new JSONObject();}
            paletteJson[index]=stored;
        }
        return palettes[index].optString(role);
    }
    static int color(Context context, String role) {
        boolean dark = isDark(context);
        String value=context instanceof WidgetContext?((WidgetContext)context).colors.optString(role):savedColor(context,dark,role);
        if(value.matches("#[0-9a-fA-F]{6}"))return Color.parseColor(value);
        switch (role) {
            case "primary": return dark ? 0xffadc6ff : 0xff005ac1;
            case "onPrimary": return dark ? 0xff002e69 : Color.WHITE;
            case "primaryContainer": return dark ? 0xff004494 : 0xffd8e2ff;
            case "onPrimaryContainer": return dark ? 0xffd8e2ff : 0xff001a41;
            case "secondaryContainer": return dark ? 0xff3f4759 : 0xffdae2f9;
            case "onSecondaryContainer": return dark ? 0xffdae2f9 : 0xff131c2b;
            case "tertiaryContainer": return dark ? 0xff573e5b : 0xfffad8fd;
            case "onTertiaryContainer": return dark ? 0xfffad8fd : 0xff28132e;
            case "eventContainer": return dark ? 0xff005142 : 0xffa5f2dc;
            case "onEventContainer": return dark ? 0xffa5f2dc : 0xff002018;
            case "homeworkContainer": return dark ? 0xff674000 : 0xffffddb3;
            case "onHomeworkContainer": return dark ? 0xffffddb3 : 0xff2c1700;
            case "examContainer": return dark ? 0xff63396b : 0xffffd6ff;
            case "onExamContainer": return dark ? 0xffffd6ff : 0xff340c3f;
            case "surfaceContainerLow": return dark ? 0xff1b1b1f : 0xfff4f3f7;
            case "onSurface": return dark ? 0xffe3e2e6 : 0xff1b1b1f;
            case "onSurfaceVariant": return dark ? 0xffc4c6d0 : 0xff44464f;
            case "outlineVariant": return dark ? 0xff44464f : 0xffc4c6d0;
            case "surfaceContainer": return dark ? 0xff1f2024 : 0xffeeedf1;
            case "surfaceContainerHigh": return dark ? 0xff292a2e : 0xffe9e7ec;
            default: return dark ? 0xff131316 : 0xfffaf9fd;
        }
    }
    /** RemoteViews headers and collection children must share one immutable
     * palette even if a foreground theme change races background rendering. */
    static Context widgetContext(Context context){
        if(context instanceof WidgetContext)return context;
        java.util.Map<String,?> state=prefs(context).getAll();
        String mode=state.get("mode") instanceof String?(String)state.get("mode"):"system";
        boolean dark="system".equals(mode)?systemDark(context):Boolean.TRUE.equals(state.get("dark"));
        Object stored=state.get(dark?"dark.colors":"light.colors");
        return new WidgetContext(context,dark,stored instanceof String?(String)stored:"{}");
    }
    static long widgetItemId(Context context,long item){
        // A new palette needs a new collection identity on launchers that
        // retain children with stable IDs. Minute updates keep the same ID.
        return (item^((WidgetContext)widgetContext(context)).identity)&Long.MAX_VALUE;
    }
    static Intent widgetIntent(Context context,Intent intent){
        WidgetContext theme=(WidgetContext)widgetContext(context);
        return intent.putExtra("widgetDark",theme.dark).putExtra("widgetColors",theme.source);
    }
    static Context widgetContext(Context context,Intent intent){
        if(!intent.hasExtra("widgetDark"))return widgetContext(context);
        String source=intent.getStringExtra("widgetColors");
        return new WidgetContext(context,intent.getBooleanExtra("widgetDark",false),source==null?"{}":source);
    }
    private static final class WidgetContext extends ContextWrapper {
        final boolean dark;
        final String source;
        final JSONObject colors;
        final long identity;
        WidgetContext(Context context,boolean dark,String source){
            super(context);this.dark=dark;this.source=source;
            JSONObject parsed;try{parsed=new JSONObject(source);}catch(Exception ignored){parsed=new JSONObject();}
            colors=parsed;
            long hash=0xcbf29ce484222325L;
            String key=(dark?"dark:":"light:")+source;
            for(int i=0;i<key.length();i++){hash^=key.charAt(i);hash*=0x100000001b3L;}
            identity=hash;
        }
    }
    static int dialogStyle(Context context) {
        return isDark(context) ? R.style.SJTUMaterialDialog_Dark : R.style.SJTUMaterialDialog;
    }
    static JSObject device(Context context) {
        JSObject result = new JSObject();
        result.put("dark", systemDark(context));
        if (Build.VERSION.SDK_INT >= 31) result.put("systemSeed", String.format(Locale.ROOT,
            "#%06x", context.getColor(android.R.color.system_accent1_600) & 0xffffff));
        return result;
    }
    static boolean save(Context context, JSObject input) {
        boolean dark = input.optBoolean("dark", systemDark(context));
        String mode = input.optString("mode", "system");
        if (!("light".equals(mode) || "dark".equals(mode))) mode = "system";
        JSONObject source = input.optJSONObject("colors"), clean = new JSONObject();
        if (source != null) {
            java.util.Iterator<String> keys = source.keys();
            while (keys.hasNext()) {
                String key = keys.next(), value = source.optString(key);
                if (key.matches("[a-zA-Z]{1,40}") && value.matches("#[0-9a-fA-F]{6}"))
                    try { clean.put(key, value); } catch (Exception ignored) { }
            }
        }
        String key = dark ? "dark.colors" : "light.colors";
        SharedPreferences p = prefs(context);
        boolean changed = !clean.toString().equals(p.getString(key, ""))
            || p.getBoolean("dark", !dark) != dark || !mode.equals(p.getString("mode", "system"));
        p.edit().putString("mode", mode).putBoolean("dark", dark).putBoolean("reducedEffects",input.optBoolean("reducedEffects",false)).putString(key, clean.toString()).apply();
        return changed;
    }
    static void dialogWindow(Window window,Context context){
        if(window!=null)window.setWindowAnimations(prefs(context).getBoolean("reducedEffects",false)?0:R.style.SJTUMaterialDialogAnimation);
        window(window,context);
    }
    static void window(Window window, Context context) {
        if (window == null) return;
        window.setBackgroundDrawable(new ColorDrawable(color(context, "surface")));
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(!isDark(context));
        bars.setAppearanceLightNavigationBars(!isDark(context));
    }
    static void activity(Activity activity) {
        window(activity.getWindow(), activity);
        activity.getWindow().getDecorView().setBackgroundColor(color(activity, "surface"));
        if (activity instanceof com.getcapacitor.BridgeActivity) {
            com.getcapacitor.Bridge bridge = ((com.getcapacitor.BridgeActivity) activity).getBridge();
            if (bridge != null && bridge.getWebView() != null)
                bridge.getWebView().setBackgroundColor(color(activity, "surface"));
        }
    }
}
