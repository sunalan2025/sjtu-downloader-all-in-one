package me.hisunalan.sjtudownloader;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.LinkedHashMap;

final class AgendaBackgroundSync {
    static final Object LOCK = new Object();
    private static final java.util.concurrent.atomic.AtomicBoolean RUNNING = new java.util.concurrent.atomic.AtomicBoolean();
    interface Source { SchoolAgendaClient.Result fetch() throws Exception; }
    static JSONArray cached(Context context) {
        try { return new JSONArray(TodayScheduleWidget.preferences(context).getString("events", "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }
    static String fingerprint(JSONObject item) {
        return item.optString("source", "school") + "|" + (item.optBoolean("assignment")?"homework":item.optString("category")) + "|" + item.optString("title") + "|" + item.optLong("startMs") + "|" + (item.optBoolean("assignment")?item.optString("courseName"):"");
    }
    static void foreground(Context context, JSONArray incoming, boolean clear, boolean preserveSchool) {
        synchronized (LOCK) {
            LinkedHashMap<String, JSONObject> merged = new LinkedHashMap<>();
            if (!clear && preserveSchool) {
                JSONArray old = cached(context);
                for (int i = 0; i < old.length(); i++) {
                    JSONObject item = old.optJSONObject(i);
                    if (item != null && !"personal".equals(item.optString("source"))) merged.put(fingerprint(item), item);
                }
            }
            LinkedHashMap<String,JSONObject> previous=new LinkedHashMap<>();
            JSONArray oldStatus=cached(context);
            for(int i=0;i<oldStatus.length();i++){JSONObject item=oldStatus.optJSONObject(i);if(item!=null)previous.put(fingerprint(item),item);}
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject item = incoming.optJSONObject(i);
                if (item != null) merged.put(fingerprint(item),AssignmentStatus.merge(previous.get(fingerprint(item)),item));
            }
            JSONArray items = new JSONArray();
            for (JSONObject item : merged.values()) items.put(item);
            TodayScheduleWidget.persist(context, items, true);
            AgendaNotifications.refresh(context, false);
        }
    }
    static void logout(Context context) {
        synchronized (LOCK) {
            android.content.SharedPreferences prefs = AgendaPreferences.store(context);
            prefs.edit().putLong("generation", prefs.getLong("generation", 0) + 1)
                .putBoolean("backgroundEnabled", false).putString("syncState", "idle").commit();
            AgendaSyncService.configure(context);
            JSONArray old = cached(context), personal = new JSONArray();
            for (int i = 0; i < old.length(); i++) {
                JSONObject item = old.optJSONObject(i);
                if (item != null && "personal".equals(item.optString("source"))) personal.put(item);
            }
            TodayScheduleWidget.persist(context, personal, true);
            android.app.NotificationManager manager = context.getSystemService(android.app.NotificationManager.class);
            manager.cancelAll();
            AgendaNotifications.refresh(context, false);
        }
    }
    static void run(Context context, Source source) {
        if (!RUNNING.compareAndSet(false, true)) return;
        try { runOnce(context, source); } finally { RUNNING.set(false); }
    }
    private static void runOnce(Context context, Source source) {
        android.content.SharedPreferences prefs = AgendaPreferences.store(context);
        final long generation;
        synchronized (LOCK) {
            generation = prefs.getLong("generation", 0);
            prefs.edit().putLong("lastSyncAt", System.currentTimeMillis()).putString("syncState", "running").apply();
        }
        String state = "network";
        try {
            SchoolAgendaClient.Result response = source.fetch();
            synchronized (LOCK) {
                if (Thread.currentThread().isInterrupted() || generation != prefs.getLong("generation", 0)) return;
                if (response.any()) {
                    LinkedHashMap<String, JSONObject> merged = new LinkedHashMap<>();
                    JSONArray old = cached(context);
                    long now = System.currentTimeMillis();
                    boolean freshOfficial = false;
                    for (int i = 0; i < response.items.length(); i++) {
                        JSONObject item = response.items.optJSONObject(i);
                        if (item != null && item.optString("id").startsWith("official:")) freshOfficial = true;
                    }
                    for (int i = 0; i < old.length(); i++) {
                        JSONObject item = old.optJSONObject(i); if (item == null) continue;
                        if (item.optLong("endMs") < now - 8 * TodayScheduleWidget.DAY) continue;
                        // A verified nonempty official response replaces only official lessons
                        // in its requested future window; local plans and unavailable sources survive.
                        if (response.official && freshOfficial && item.optString("id").startsWith("official:")
                            && item.optLong("startMs") >= TodayScheduleWidget.midnight(now, 0)
                            && item.optLong("startMs") < TodayScheduleWidget.midnight(now, 22)) continue;
                        merged.put(fingerprint(item), item);
                    }
                    for (int i = 0; i < response.items.length(); i++) {
                        JSONObject item = response.items.optJSONObject(i);
                        if (item != null && item.optLong("startMs") >= now - 8 * TodayScheduleWidget.DAY
                                && item.optLong("startMs") < now + 22 * TodayScheduleWidget.DAY)
                            merged.put(fingerprint(item),AssignmentStatus.merge(merged.get(fingerprint(item)),item));
                    }
                    JSONArray snapshot = new JSONArray();
                    for (JSONObject item : merged.values()) snapshot.put(item);
                    TodayScheduleWidget.persist(context, snapshot, true);
                    AgendaNotifications.refresh(context, false);
                    prefs.edit().putLong("lastSyncSuccessAt", now).apply();
                    state = response.official && response.canvas && response.exams ? "success" : "partial";
                } else state = response.authRequired ? "auth" : "network";
            }
        } catch (Exception ignored) { /* Keep private data and school responses out of logs. */ }
        synchronized (LOCK) {
            if (generation == prefs.getLong("generation", 0)) prefs.edit().putString("syncState", state).apply();
        }
    }
}
