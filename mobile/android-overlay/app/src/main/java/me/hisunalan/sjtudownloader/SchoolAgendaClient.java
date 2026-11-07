package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Bounded, read-only school queries for an OS-scheduled job. There is no
 * background WebView/SSO flow, password storage or third-party relay. */
final class SchoolAgendaClient {
    static final class Result {
        final JSONArray items = new JSONArray();
        boolean official, canvas, exams, authRequired;
        boolean any() { return official || canvas || exams || items.length() > 0; }
    }
    private static final class AuthRequired extends Exception { }
    private final Context context;
    private int requests;
    private final long deadline = System.currentTimeMillis() + 90_000;
    SchoolAgendaClient(Context context) { this.context = context.getApplicationContext(); }
    static boolean allowed(URL url) {
        return "https".equals(url.getProtocol()) && (url.getPort() == -1 || url.getPort() == 443)
            && url.getUserInfo() == null && ("calendar.sjtu.edu.cn".equals(url.getHost())
                || "oc.sjtu.edu.cn".equals(url.getHost()));
    }
    private static final class Reply {
        String body, next;
    }
    private Reply request(String address) throws Exception {
        if (Thread.currentThread().isInterrupted() || ++requests > 22
                || System.currentTimeMillis() > deadline) throw new java.io.InterruptedIOException();
        URL url = new URL(address);
        if (!allowed(url)) throw new SecurityException("Unapproved school endpoint");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000); connection.setReadTimeout(12000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "SJTU Downloader Android Background Sync");
            connection.setRequestProperty("Referer", "https://" + url.getHost() + "/");
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            String cookie = CookieManager.getInstance().getCookie("https://" + url.getHost());
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            int code = connection.getResponseCode();
            if (code == 401 || code == 403 || code >= 300 && code < 400) throw new AuthRequired();
            if (code != 200) throw new java.io.IOException("School API unavailable");
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            try (InputStream stream = connection.getInputStream()) {
                byte[] bytes = new byte[8192]; int count;
                while ((count = stream.read(bytes)) != -1) {
                    if (Thread.currentThread().isInterrupted() || buffer.size() + count > 2 * 1024 * 1024)
                        throw new java.io.InterruptedIOException();
                    buffer.write(bytes, 0, count);
                }
            }
            Reply result = new Reply();
            result.body = buffer.toString("UTF-8").trim();
            if (!result.body.startsWith("{") && !result.body.startsWith("[")) throw new AuthRequired();
            String link = connection.getHeaderField("Link");
            if (link != null) for (String part : link.split(",")) {
                if (!part.contains("rel=\"next\"")) continue;
                int begin = part.indexOf('<'), end = part.indexOf('>');
                if (begin >= 0 && end > begin) {
                    URL next = new URL(url, part.substring(begin + 1, end));
                    if (!allowed(next) || !url.getHost().equals(next.getHost())
                        || !next.getPath().startsWith("/api/v1/")) throw new SecurityException();
                    result.next = next.toString();
                }
            }
            return result;
        } finally { connection.disconnect(); }
    }
    private JSONArray pages(String address) throws Exception {
        JSONArray all = new JSONArray();
        for (int page = 0; address != null && page < 4; page++) {
            Reply reply = request(address);
            JSONArray rows = new JSONArray(reply.body);
            for (int i = 0; i < rows.length(); i++) all.put(rows.get(i));
            address = reply.next;
        }
        if (address != null) throw new java.io.IOException("Bounded pagination incomplete");
        return all;
    }
    static long millis(String value) {
        for (String pattern : new String[]{"yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX",
                "yyyy-MM-dd'T'HH:mmXXX", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"}) {
            SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.ROOT);
            format.setTimeZone(TodayScheduleWidget.ZONE); format.setLenient(false);
            ParsePosition position = new ParsePosition(0);
            java.util.Date date = format.parse(value, position);
            if (date != null && position.getIndex() == value.length()) return date.getTime();
        }
        return 0;
    }
    static JSONObject cacheItem(JSONObject event) throws Exception {
        String title = event.optString("title", "").trim();
        String date = event.optString("startTime", "");
        long start = millis(date), end = millis(event.optString("endTime", date));
        if (title.isEmpty() || start <= 0) return null;
        String type = event.optString("type", "event");
        boolean assignment = "assignment".equals(type);
        if(assignment)start=AssignmentStatus.deadlineMillis(date);
        boolean deadline = assignment || "exam".equals(type);
        JSONObject item = new JSONObject();
        item.put("id", event.optString("id")); item.put("source", "school");
        item.put("title", title); item.put("startMs", start);
        item.put("endMs", assignment ? start : "exam".equals(type) ? Math.max(start, end) : Math.max(start + 45 * 60_000L, end));
        // Never extend a real lesson end to the fallback duration.
        if (!deadline && end > start) item.put("endMs", end);
        item.put("location", event.optString("location"));
        item.put("courseName", event.optString("courseName"));
        item.put("assignment", assignment); item.put("kind", deadline ? "deadline" : "course");
        item.put("category", assignment ? "homework" : "exam".equals(type) ? "exam"
            : "course".equals(type) ? "course" : "event");
        item.put("allDay", date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"));
        AssignmentStatus.copy(event,item);
        return item;
    }
    private static void append(Result result, JSONObject event) throws Exception {
        JSONObject item = cacheItem(event);
        if (item != null) result.items.put(item);
    }
    Result fetch() throws Exception {
        new SessionCookieVault(context).restoreOnce();
        Result result = new Result();
        String begin = TodayScheduleWidget.format(System.currentTimeMillis()-8*TodayScheduleWidget.DAY, "yyyy-MM-dd");
        String end = TodayScheduleWidget.format(System.currentTimeMillis() + 22 * TodayScheduleWidget.DAY, "yyyy-MM-dd");
        try {
            // Match the existing foreground API's bounded weekly requests.
            for (int day = 0; day < 22; day += 7) {
                String from = TodayScheduleWidget.format(System.currentTimeMillis() + day * TodayScheduleWidget.DAY, "yyyy-MM-dd");
                String until = TodayScheduleWidget.format(System.currentTimeMillis() + Math.min(22, day + 7) * TodayScheduleWidget.DAY, "yyyy-MM-dd");
                String address = "https://calendar.sjtu.edu.cn/api/event/list?startDate="
                    + URLEncoder.encode(from + " 00:00", "UTF-8") + "&endDate="
                    + URLEncoder.encode(until + " 00:00", "UTF-8") + "&weekly=true&ids=";
                JSONObject data = new JSONObject(request(address).body).optJSONObject("data");
                JSONArray rows = data == null ? null : data.optJSONArray("events");
                if (rows == null) throw new AuthRequired();
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject row = rows.optJSONObject(i); if (row == null) continue;
                    JSONObject event = new JSONObject();
                    String id = row.optString("eventId", String.valueOf(i));
                    event.put("id", "official:" + id); event.put("title", row.optString("title", "课程"));
                    event.put("startTime", row.optString("startTime")); event.put("endTime", row.optString("endTime"));
                    event.put("location", row.optString("location")); event.put("type",
                        id.startsWith("ACTIVITY") || row.optBoolean("claimIcon")
                            || row.has("recurrence") && row.optInt("recurrence", -1) == 0 ? "event" : "course");
                    append(result, event);
                }
            }
            result.official = true;
        } catch (AuthRequired denied) { result.authRequired = true; }
          catch (Exception unavailable) { if (Thread.currentThread().isInterrupted()) throw unavailable; }
        Map<String, String> names = new HashMap<>();
        try {
            JSONArray courses = pages("https://oc.sjtu.edu.cn/api/v1/courses?per_page=100&enrollment_state=active");
            ArrayList<String> ids = new ArrayList<>();
            for (int i = 0; i < courses.length() && ids.size() < 60; i++) {
                JSONObject row = courses.optJSONObject(i); if (row == null) continue;
                String id = row.optString("id");
                if (id.matches("[0-9]{1,20}")) { ids.add(id); names.put(id, row.optString("name")); }
            }
            for (int offset = 0; offset < ids.size(); offset += 20) {
                String contexts = "";
                for (int i = offset; i < Math.min(ids.size(), offset + 20); i++)
                    contexts += "&context_codes%5B%5D=course_" + ids.get(i);
                for (String type : new String[]{"assignment", "event"}) {
                    JSONArray rows = pages("https://oc.sjtu.edu.cn/api/v1/calendar_events?per_page=100&type="
                        + type + "&start_date=" + begin + "&end_date=" + end + contexts);
                    for (int i = 0; i < rows.length(); i++)
                        if (rows.optJSONObject(i) != null) canvas(result, rows.getJSONObject(i), type, names);
                }
            }
            result.canvas = true;
        } catch (AuthRequired denied) { result.authRequired = true; }
          catch (Exception unavailable) { if (Thread.currentThread().isInterrupted()) throw unavailable; }
        if (!result.canvas) try {
            JSONArray rows = pages("https://oc.sjtu.edu.cn/api/v1/users/self/upcoming_events?per_page=100");
            for (int i = 0; i < rows.length(); i++) if (rows.optJSONObject(i) != null) {
                JSONObject row = rows.getJSONObject(i);
                canvas(result, row, row.optJSONObject("assignment") != null ? "assignment" : "event", names);
            }
            result.canvas = true;
        } catch (Exception ignored) { if (Thread.currentThread().isInterrupted()) throw ignored; }
        // Personal submission data is absent from some calendar responses.
        // Reuse the desktop include[]=submission query, prioritizing courses
        // that actually have deadlines; keep the existing request/time budget.
        java.util.LinkedHashSet<String> statusCourses=new java.util.LinkedHashSet<>();
        for(int i=0;i<result.items.length();i++){
            JSONObject item=result.items.optJSONObject(i);if(item==null||!item.optBoolean("assignment"))continue;
            for(Map.Entry<String,String> course:names.entrySet())if(course.getValue().equals(item.optString("courseName")))statusCourses.add(course.getKey());
        }
        statusCourses.addAll(names.keySet());
        for(String id:statusCourses){
            if(requests>=20||System.currentTimeMillis()>deadline||Thread.currentThread().isInterrupted())break;
            try{
                JSONArray assignments=pages("https://oc.sjtu.edu.cn/api/v1/courses/"+id+"/assignments?include%5B%5D=submission&per_page=100");
                for(int i=0;i<assignments.length();i++){
                    JSONObject row=assignments.optJSONObject(i);if(row==null)continue;
                    long due=AssignmentStatus.deadlineMillis(AssignmentStatus.due(row));
                    if(due< System.currentTimeMillis()-8*TodayScheduleWidget.DAY||due>=System.currentTimeMillis()+22*TodayScheduleWidget.DAY)continue;
                    row.put("course_id",id);canvas(result,row,"assignment",names,true);
                }
            }catch(Exception ignored){if(Thread.currentThread().isInterrupted())throw ignored;}
        }
        if (!Thread.currentThread().isInterrupted() && System.currentTimeMillis() < deadline) {
            JSObject exams = new MobileExamService().fetch(false);
            result.exams = exams.optBoolean("connected");
            JSONArray rows = exams.optJSONArray("items");
            if (result.exams && rows != null) for (int i = 0; i < rows.length(); i++)
                if (rows.optJSONObject(i) != null) append(result, rows.getJSONObject(i));
        }
        return result;
    }
    private static void canvas(Result result, JSONObject row, String type, Map<String, String> names) throws Exception {
        canvas(result,row,type,names,false);
    }
    private static void canvas(Result result,JSONObject row,String type,Map<String,String> names,boolean authoritative) throws Exception {
        JSONObject assignment = row.optJSONObject("assignment");
        JSONObject data = assignment == null ? row : assignment;
        JSONObject event = new JSONObject();
        event.put("id", "canvas:" + type + ":" + data.optString("id", row.optString("id")));
        event.put("title", data.optString("name", row.optString("title", "日程")));
        event.put("startTime", "assignment".equals(type) ? AssignmentStatus.due(row) : row.optString("start_at"));
        event.put("endTime", row.optString("end_at")); event.put("type", type);
        String id = data.optString("course_id");
        if (id.isEmpty()) id = row.optString("context_code").replace("course_", "");
        event.put("courseName", names.getOrDefault(id, row.optString("context_name")));
        event.put("location", row.optString("location_name"));
        if("assignment".equals(type))AssignmentStatus.decorate(event,row,AssignmentStatus.deadlineMillis(event.optString("startTime")),System.currentTimeMillis(),authoritative);
        append(result, event);
    }
}
