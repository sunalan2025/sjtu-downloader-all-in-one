package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.Map;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AgendaReminderTest {
    private Context context;
    private Map<String, ?> previous;
    private String previousEvents;
    @Before public void setup() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        previous = AgendaPreferences.store(context).getAll();
        previousEvents = TodayScheduleWidget.preferences(context).getString("events", "[]");
        AgendaPreferences.store(context).edit().clear().commit();
        TodayScheduleWidget.preferences(context).edit().putString("events", "[]").commit();
    }
    @After public void restore() {
        SharedPreferences.Editor edit = AgendaPreferences.store(context).edit().clear();
        for (Map.Entry<String, ?> entry : previous.entrySet()) {
            Object value = entry.getValue();
            if (value instanceof Boolean) edit.putBoolean(entry.getKey(), (Boolean)value);
            if (value instanceof Integer) edit.putInt(entry.getKey(), (Integer)value);
            if (value instanceof Long) edit.putLong(entry.getKey(), (Long)value);
            if (value instanceof String) edit.putString(entry.getKey(), (String)value);
        }
        edit.commit();
        TodayScheduleWidget.preferences(context).edit().putString("events", previousEvents).commit();
        context.getSystemService(android.app.NotificationManager.class).cancelAll();
        AgendaSyncService.configure(context); AgendaNotifications.refresh(context, false);
    }
    private static long time(String value) { return SchoolAgendaClient.millis(value); }
    private static TodayScheduleWidget.Item item(long start, String category, boolean allDay, String course) {
        return new TodayScheduleWidget.Item(start, start + 90*60_000L, "测试安排", "测试教室",
            "homework".equals(category), category, allDay, course, "homework".equals(category));
    }
    @Test public void quietHoursCrossMidnightUseShanghaiTime() throws Exception {
        JSONObject settings = AgendaPreferences.read(context);
        assertTrue(AgendaNotifications.quietAt(time("2026-11-04T22:00:00+08:00"), settings));
        assertTrue(AgendaNotifications.quietAt(time("2026-11-05T07:59:00+08:00"), settings));
        assertFalse(AgendaNotifications.quietAt(time("2026-11-05T08:00:00+08:00"), settings));
        settings.put("quietStart", 480); settings.put("quietEnd", 480);
        assertFalse(AgendaNotifications.quietAt(time("2026-11-05T09:00:00+08:00"), settings));
    }
    @Test public void allDayAndCategoryOffsetsDoNotDependOnDeviceTimezone() throws Exception {
        JSONObject settings = AgendaPreferences.read(context);
        TodayScheduleWidget.Item homework = item(time("2026-11-05"), "homework", true, "测试课程");
        assertEquals(time("2026-11-04T09:00:00+08:00"), AgendaNotifications.reminderTime(homework, settings));
        TodayScheduleWidget.Item exam = item(time("2026-11-05T14:00:00+08:00"), "exam", false, "");
        assertEquals(time("2026-11-05T13:00:00+08:00"), AgendaNotifications.reminderTime(exam, settings));
        settings.put("examEnabled", false);
        assertEquals(-1, AgendaNotifications.reminderTime(exam, settings));
    }
    @Test public void startTimeReminderSurvivesNormalAlarmDeliveryLatency() throws Exception {
        long start = time("2026-11-05T10:00:00+08:00");
        JSONObject settings = AgendaPreferences.read(context);
        settings.put("courseMinutes", 0); settings.put("quietEnabled", false);
        assertTrue(AgendaNotifications.due(item(start, "course", false, ""), settings, start + 1000));
        assertFalse(AgendaNotifications.due(item(start, "course", false, ""), settings, start + 16*60_000L));
        assertFalse(AgendaNotifications.due(item(start, "course", false, ""), settings, start - 1));
    }
    @Test public void quietModeCanKeepLateHomeworkVisibleWithoutSoundOrSkipIt() throws Exception {
        long start = time("2026-11-05T23:59:00+08:00");
        TodayScheduleWidget.Item homework = item(start, "homework", false, "测试课程");
        JSONObject settings = AgendaPreferences.read(context);
        long reminder = start - 1440*60_000L;
        assertTrue(AgendaNotifications.due(homework, settings, reminder + 1000));
        settings.put("quietMode", "skip");
        assertFalse(AgendaNotifications.due(homework, settings, reminder + 1000));
    }
    @Test public void homeworkClassificationAndNotificationIdentityKeepCoursesSeparate() {
        long start = System.currentTimeMillis() + 60_000;
        assertNotEquals(AgendaNotifications.key(item(start, "homework", false, "高数")),
            AgendaNotifications.key(item(start, "homework", false, "物理")));
        TodayScheduleWidget.Item namedExam = new TodayScheduleWidget.Item(start, start, "考试练习作业", "", true, "exam", false, "物理", true);
        assertEquals("homework", AgendaNotifications.category(namedExam));
    }
    @Test public void duplicateAlarmDoesNotSendTheSameReminderAgain() throws Exception {
        if (android.os.Build.VERSION.SDK_INT >= 33)
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(
                context.getPackageName(), android.Manifest.permission.POST_NOTIFICATIONS);
        JSONObject settings = AgendaPreferences.read(context);
        settings.put("enabled", true); settings.put("quietEnabled", false); settings.put("courseMinutes", 0);
        AgendaPreferences.save(context, settings);
        long start = System.currentTimeMillis() - 1000;
        JSONObject row = new JSONObject().put("title", "测试安排").put("startMs", start)
            .put("endMs", start + 90*60_000L).put("category", "course").put("kind", "course");
        TodayScheduleWidget.persist(context, new JSONArray().put(row), true);
        AgendaNotifications.refresh(context, true);
        String key = "sent." + AgendaNotifications.key(item(start, "course", false, ""));
        long sent = AgendaPreferences.store(context).getLong(key, 0);
        assertTrue("initial notification must be recorded", sent > 0);
        AgendaNotifications.refresh(context, true);
        assertEquals("duplicate delivery must not re-post", sent, AgendaPreferences.store(context).getLong(key, 0));
    }
    @Test public void deniedPermissionDisablesStaleFlagAndGrantDoesNotAutoEnable() throws Exception {
        JSONObject settings=AgendaPreferences.read(context);
        settings.put("enabled",true);settings.put("courseMinutes",30);settings.put("backgroundEnabled",true);
        AgendaPreferences.save(context,settings);
        JSONObject denied=AgendaNotifications.validatedSettings(context,false);
        assertFalse(denied.getBoolean("enabled"));
        assertFalse(AgendaPreferences.store(context).getBoolean("enabled",true));
        assertTrue(denied.getBoolean("backgroundEnabled"));assertEquals(30,denied.getInt("courseMinutes"));
        assertFalse(AgendaNotifications.validatedSettings(context,true).getBoolean("enabled"));
        settings.put("enabled",true);AgendaPreferences.save(context,settings);
        assertTrue(AgendaNotifications.validatedSettings(context,true).getBoolean("enabled"));
    }
    @Test public void backgroundSchedulingDoesNotRequireNotificationConsent() throws Exception {
        JSONObject settings = AgendaPreferences.read(context);
        settings.put("enabled", false); settings.put("backgroundEnabled", true);
        settings.put("syncMinutes", 30); settings.put("unmeteredOnly", true);
        AgendaPreferences.save(context, settings); AgendaSyncService.configure(context);
        assertTrue(AgendaSyncService.scheduled(context));
        android.app.job.JobScheduler scheduler = context.getSystemService(android.app.job.JobScheduler.class);
        for (android.app.job.JobInfo job : scheduler.getAllPendingJobs()) if (job.getId() == AgendaSyncService.JOB) {
            assertEquals(30*60_000L, job.getIntervalMillis());
            assertEquals(android.app.job.JobInfo.NETWORK_TYPE_UNMETERED, job.getNetworkType());
            assertTrue(job.isPersisted());
        }
        settings.put("backgroundEnabled", false); AgendaPreferences.save(context, settings);
        AgendaSyncService.configure(context); assertFalse(AgendaSyncService.scheduled(context));
    }
    private JSONObject cached(String id, String source) throws Exception {
        long start = System.currentTimeMillis() + 60*60_000L;
        return new JSONObject().put("id", id).put("source", source).put("title", id)
            .put("startMs", start).put("endMs", start + 60*60_000L).put("category", "course").put("kind", "course");
    }
    @Test public void personalEditsAndPartialRemoteFailuresPreserveVerifiedSchoolCache() throws Exception {
        TodayScheduleWidget.persist(context, new JSONArray().put(cached("official:test", "school"))
            .put(cached("personal-test", "personal")), true);
        AgendaBackgroundSync.foreground(context, new JSONArray(), false, true);
        assertEquals(1, AgendaBackgroundSync.cached(context).length());
        SchoolAgendaClient.Result empty = new SchoolAgendaClient.Result(); empty.official = true;
        AgendaBackgroundSync.run(context, () -> empty);
        assertEquals("official:test", AgendaBackgroundSync.cached(context).getJSONObject(0).getString("id"));
    }
    @Test public void logoutDuringARequestCannotRepopulateSchoolData() throws Exception {
        TodayScheduleWidget.persist(context, new JSONArray().put(cached("official:test", "school"))
            .put(cached("personal-test", "personal")), true);
        AgendaBackgroundSync.run(context, () -> {
            AgendaBackgroundSync.logout(context);
            SchoolAgendaClient.Result response = new SchoolAgendaClient.Result(); response.official = true;
            response.items.put(cached("official:late-response", "school")); return response;
        });
        JSONArray remaining = AgendaBackgroundSync.cached(context);
        assertEquals(1, remaining.length());
        assertEquals("personal-test", remaining.getJSONObject(0).getString("id"));
        assertFalse(AgendaSyncService.scheduled(context));
    }
    @Test public void backgroundClientNeverForwardsCookiesToLoginOrExternalHosts() throws Exception {
        assertTrue(SchoolAgendaClient.allowed(new java.net.URL("https://oc.sjtu.edu.cn/api/v1/calendar_events")));
        assertFalse(SchoolAgendaClient.allowed(new java.net.URL("https://jaccount.sjtu.edu.cn/login")));
        assertFalse(SchoolAgendaClient.allowed(new java.net.URL("https://oc.sjtu.edu.cn.evil.example/api")));
        assertFalse(SchoolAgendaClient.allowed(new java.net.URL("http://oc.sjtu.edu.cn/api")));
        assertFalse(SchoolAgendaClient.allowed(new java.net.URL("https://oc.sjtu.edu.cn:444/api")));
    }
}
