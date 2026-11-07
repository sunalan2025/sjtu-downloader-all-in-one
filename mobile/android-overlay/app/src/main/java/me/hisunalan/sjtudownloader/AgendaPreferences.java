package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import org.json.JSONObject;

/** User choices only: no account credentials or school response bodies. */
final class AgendaPreferences {
    static final String FILE = "sjtu-agenda-settings-v1";
    static SharedPreferences store(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
    static int bounded(JSONObject input, String key, int fallback, int min, int max) {
        return Math.max(min, Math.min(max, input.optInt(key, fallback)));
    }
    static JSObject read(Context context) {
        SharedPreferences p = store(context);
        JSObject out = new JSObject();
        out.put("enabled", p.getBoolean("enabled", false));
        for (String kind : new String[]{"course", "event", "exam", "homework"}) {
            out.put(kind + "Enabled", p.getBoolean(kind + "Enabled", true));
            out.put(kind + "Minutes", p.getInt(kind + "Minutes",
                "exam".equals(kind) ? 60 : "homework".equals(kind) ? 1440 : 10));
        }
        out.put("quietMode", p.getString("quietMode", "silent"));
        out.put("quietEnabled", p.getBoolean("quietEnabled", true));
        out.put("quietStart", p.getInt("quietStart", 22 * 60));
        out.put("quietEnd", p.getInt("quietEnd", 8 * 60));
        out.put("allDayHour", p.getInt("allDayHour", 9));
        out.put("lockScreenDetails", p.getBoolean("lockScreenDetails", false));
        out.put("showContent", p.getBoolean("showContent", true));
        out.put("backgroundEnabled", p.getBoolean("backgroundEnabled", false));
        out.put("syncMinutes", p.getInt("syncMinutes", 60));
        out.put("unmeteredOnly", p.getBoolean("unmeteredOnly", false));
        out.put("batteryNotLow", p.getBoolean("batteryNotLow", true));
        return out;
    }
    static void save(Context context, JSONObject input) {
        JSONObject old = read(context);
        SharedPreferences.Editor e = store(context).edit();
        for (String key : new String[]{"enabled", "courseEnabled", "eventEnabled",
                "examEnabled", "homeworkEnabled", "quietEnabled", "showContent",
                "backgroundEnabled", "unmeteredOnly", "batteryNotLow", "lockScreenDetails"})
            e.putBoolean(key, input.optBoolean(key, old.optBoolean(key)));
        for (String kind : new String[]{"course", "event", "exam", "homework"})
            e.putInt(kind + "Minutes", bounded(input, kind + "Minutes",
                old.optInt(kind + "Minutes"), 0, 7 * 1440));
        e.putString("quietMode", "skip".equals(input.optString("quietMode", old.optString("quietMode"))) ? "skip" : "silent");
        e.putInt("quietStart", bounded(input, "quietStart", old.optInt("quietStart"), 0, 1439));
        e.putInt("quietEnd", bounded(input, "quietEnd", old.optInt("quietEnd"), 0, 1439));
        e.putInt("allDayHour", bounded(input, "allDayHour", old.optInt("allDayHour"), 0, 23));
        int minutes = input.optInt("syncMinutes", old.optInt("syncMinutes"));
        e.putInt("syncMinutes", minutes == 15 || minutes == 30 || minutes == 180 ? minutes : 60);
        e.commit();
    }
}
