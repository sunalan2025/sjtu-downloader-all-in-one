package me.hisunalan.sjtudownloader;

import android.webkit.CookieManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Mirrors desktop exam-service: primary j.sjtu.edu.cn study exam JSON, with
 * i.sjtu.edu.cn registrar exam listing as fallback. Both have independent
 * SSO sessions. No credentials are logged, forwarded or persisted here.
 */
final class MobileExamService {
    private static final String STUDY = "https://j.sjtu.edu.cn";
    private static final String JIAOWU = "https://i.sjtu.edu.cn";
    private static final TimeZone SHANGHAI = TimeZone.getTimeZone("Asia/Shanghai");
    private static final long CACHE_MS = 5 * 60_000L;
    private JSObject cached;
    private long cacheUntil;
    // Only status/response category; never cookies, redirect URLs or account IDs.
    private String registrarDiagnostic="尚未请求";
    private String studyDiagnostic="尚未请求";

    private void describe(String host,String value){
        if("i.sjtu.edu.cn".equals(host))registrarDiagnostic=value;
        if("j.sjtu.edu.cn".equals(host))studyDiagnostic=value;
    }

    synchronized void invalidate() {
        cached = null;
        cacheUntil = 0;
    }

    synchronized JSObject fetch(boolean force) {
        long now=System.currentTimeMillis();
        if(!force && cached!=null && now<cacheUntil)return cached;
        JSArray exams=new JSArray();
        boolean authorized=false;
        String source="";
        String warning="";
        registrarDiagnostic="尚未请求";
        studyDiagnostic="尚未请求";

        // First use the official teaching-information service, matching the
        // mobile SSO handshake that opens i.sjtu.edu.cn/jaccountlogin.
        // A valid JSON response with zero exams still counts as logged in.
        try {
            JSONObject registrar=requestRegistrarExams();
            if(registrar!=null){
                authorized=true;
                source="教务信息服务网";
                exams=parseRegistrar(registrar);
            }
        }catch(Exception ignored){
            warning="教务考试接口暂不可用，尝试学在交大备用源";
        }
        // If registrar lists no announced examinations, check the alternative
        // school source instead of conflating an empty result with auth failure.
        if(!authorized || exams.length()==0){
            try{
                JSONObject study=requestStudyExams();
                if(study!=null){
                    JSArray alternative=parseStudy(study);
                    if(alternative.length()>0 || !authorized){
                        exams=alternative;
                        source="学在交大";
                    }
                    authorized=true;
                    warning="";
                }
            }catch(Exception ignored){
                if(!authorized)warning="学校考试会话暂时不可用，正在通过 jAccount 自动恢复";
            }
        }
        JSObject result=new JSObject();
        result.put("items",exams);
        result.put("connected",authorized);
        result.put("source",source);
        if(!authorized) {
            // The UI can distinguish a missing service cookie from an
            // authenticated-looking cookie whose API still returns a login
            // redirect/HTML. Never expose actual cookie values.
            boolean iCookie=!SchoolWebSession.cookie(JIAOWU+
                "/kwgl/kscx_cxXsksxxIndex.html").isEmpty();
            boolean studyCookie=!SchoolWebSession.cookie(STUDY+
                "/app/stu/exam/semester/list").isEmpty();
            String explanation=!iCookie&&!studyCookie
                ? "考试站点尚未建立会话，正在尝试正常的 jAccount 单点登录"
                : "已读取到学校站点 Cookie，但考试接口尚未完成验证";
            result.put("warning",explanation+"；教务："+registrarDiagnostic+
                "；学在交大："+studyDiagnostic);
            result.put("registrarCookiePresent",iCookie);
            result.put("studyCookiePresent",studyCookie);
        }
        cached=result;
        cacheUntil=System.currentTimeMillis()+(authorized?CACHE_MS:15_000L);
        return result;
    }

    private JSONObject jsonRequest(String address, String referer,
                                          String body) throws Exception {
        URL url = new URL(address);
        String host = url.getHost();
        if (!"https".equalsIgnoreCase(url.getProtocol()) ||
            !("j.sjtu.edu.cn".equals(host) || "i.sjtu.edu.cn".equals(host)))
            throw new Exception("不支持的考试服务地址");
        String cookies = SchoolWebSession.cookie(address);
        if (cookies.isEmpty()) {
            describe(host,"无站点 Cookie");
            return null;
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(6500);
        connection.setReadTimeout(7500);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        // Match the mobile WebView that established the portal's CAS session.
        connection.setRequestProperty("User-Agent",
            "Mozilla/5.0 (Linux; Android " + android.os.Build.VERSION.RELEASE +
            "; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/131.0.0.0 Mobile Safari/537.36");
        connection.setRequestProperty("Cookie", cookies);
        connection.setRequestProperty("Referer", referer);
        connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
        try {
            if (body != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type",
                    "application/x-www-form-urlencoded;charset=UTF-8");
                try (OutputStream stream = connection.getOutputStream()) {
                    stream.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            // The exam backend may rotate its session via Set-Cookie on a
            // JSON response. HttpURLConnection does not automatically update
            // Android WebView's CookieManager; losing that rotation is a
            // second source of repeated "please sign in" after relaunch.
            for (java.util.Map.Entry<String,java.util.List<String>> header :
                    connection.getHeaderFields().entrySet()) {
                if (header.getKey() == null ||
                    !"Set-Cookie".equalsIgnoreCase(header.getKey()) ||
                    header.getValue() == null) continue;
                for (String value : header.getValue()) {
                    if (value != null && value.length() <= 8192)
                        CookieManager.getInstance().setCookie(
                            "https://" + host + "/", value);
                }
            }
            SchoolWebSession.flush();
            if (status != 200) {
                describe(host,status>=300&&status<400
                    ? "HTTP "+status+" 认证跳转":"HTTP "+status);
                return null;
            }
            String mime = connection.getContentType();
            if (mime != null && mime.toLowerCase(Locale.ROOT).contains("html")){
                describe(host,"HTTP 200 登录/HTML 页面");
                return null;
            }
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] block = new byte[8192];
                int len;
                while ((len = input.read(block)) != -1) {
                    if (output.size() + len > 3 * 1024 * 1024)
                        throw new Exception("考试接口响应过大");
                    output.write(block, 0, len);
                }
                JSONObject json=new JSONObject(output.toString("UTF-8"));
                describe(host,"HTTP 200 JSON");
                return json;
            }
        } finally {
            connection.disconnect();
        }
    }

    private static String[] term() {
        Calendar now = new GregorianCalendar(SHANGHAI, Locale.ROOT);
        int year = now.get(Calendar.YEAR);
        int month = now.get(Calendar.MONTH) + 1;
        if (month >= 9) return new String[]{year+"-"+(year+1),"1"};
        if (month <= 2) return new String[]{(year-1)+"-"+year,"1"};
        if (month <= 7) return new String[]{(year-1)+"-"+year,"2"};
        return new String[]{(year-1)+"-"+year,"3"};
    }

    private JSONObject requestStudyExams() throws Exception {
        if (SchoolWebSession.cookie(STUDY + "/app/stu/exam/semester/list").isEmpty()){
            studyDiagnostic="缺少 /app 会话 Cookie";
            return null;
        }
        String[] term = term();
        JSONObject info = jsonRequest(STUDY + "/app/stu/school/calendar/info",
            STUDY + "/app/ui/index", null);
        if (info != null) {
            JSONObject details = info.optJSONObject("data");
            if (details != null) {
                String year = details.optString("year", "");
                String semester = details.optString("semester", "");
                if (year.matches("20\\d{2}-20\\d{2}")) term[0] = year;
                if (semester.matches("[123]")) term[1] = semester;
            }
        }
        String address = STUDY + "/app/stu/exam/semester/list?locale=zh&year=" +
            URLEncoder.encode(term[0],"UTF-8") + "&semester=" +
            URLEncoder.encode(term[1],"UTF-8");
        JSONObject result = jsonRequest(address, STUDY + "/app/ui/exam", null);
        if (result == null || result.optJSONObject("data") == null){
            if(result!=null)studyDiagnostic="HTTP 200 JSON 格式变化";
            return null;
        }
        return result;
    }

    private JSONObject requestRegistrarExams() throws Exception {
        if (SchoolWebSession.cookie(JIAOWU + "/kwgl/kscx_cxXsksxxIndex.html").isEmpty()){
            registrarDiagnostic="缺少 /kwgl 会话 Cookie";
            return null;
        }
        String[] yearSem = term();
        int startYear = Integer.parseInt(yearSem[0].substring(0,4));
        String xqm = "1".equals(yearSem[1]) ? "3" :
            "2".equals(yearSem[1]) ? "12" : "16";
        // The registrar requires its complete exam-query form. Omitting
        // these fields can yield a 200 page with no useful exam JSON.
        String form = "xnm=" + URLEncoder.encode(String.valueOf(startYear),"UTF-8") +
            "&xqm=" + URLEncoder.encode(xqm,"UTF-8") +
            "&ksmcdmb_id=&kch=&kc=&ksrq=&kkbm_id=&_search=false&time=5" +
            "&queryModel.showCount=200&queryModel.currentPage=1" +
            "&queryModel.sortName=&queryModel.sortOrder=asc";
        JSONObject result = jsonRequest(
            JIAOWU + "/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105",
            JIAOWU + "/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default", form);
        if (result == null || result.optJSONArray("items") == null){
            if(result!=null)registrarDiagnostic="HTTP 200 JSON 格式变化";
            return null;
        }
        return result;
    }

    private static String iso(String day, String time) {
        if (!day.matches("20[0-9]{2}-[0-9]{2}-[0-9]{2}")) return "";
        String part = time == null ? "" : time.trim();
        if (part.matches("[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?")) {
            String[] values = part.split(":");
            String hour = String.format(Locale.ROOT,"%02d",Integer.parseInt(values[0]));
            return day + "T" + hour + ":" + values[1] +
                (values.length > 2 ? ":" + values[2] : ":00") + "+08:00";
        }
        return day;
    }

    private static JSArray parseStudy(JSONObject result) {
        JSArray items = new JSArray();
        JSONObject data = result.optJSONObject("data");
        if (data == null) return items;
        java.util.Iterator<String> fields = data.keys();
        int limit = 0;
        while (fields.hasNext() && limit < 500) {
            String category = fields.next();
            JSONArray exams = data.optJSONArray(category);
            if (exams == null) continue;
            for (int i=0; i<exams.length() && limit<500; i++) {
                JSONObject raw = exams.optJSONObject(i);
                if (raw == null) continue;
                String title = raw.optString("name","").trim();
                String day = raw.optString("day","").trim();
                String start = iso(day,raw.optString("startTime",""));
                if (title.isEmpty() || start.isEmpty()) continue;
                String end = iso(day,raw.optString("endTime",""));
                String examType = raw.optString("examType",category);
                JSObject item = new JSObject();
                item.put("id","exam:study:"+day+":"+raw.optString("semester","")+":"+title+":"+start);
                item.put("title",title);
                item.put("courseName",title);
                item.put("location",raw.optString("address","").trim());
                item.put("startTime",start);
                item.put("endTime",end.isEmpty()?start:end);
                item.put("type","exam");
                item.put("examType",examType);
                items.put(item);
                limit++;
            }
        }
        return items;
    }

    private static JSArray parseRegistrar(JSONObject result) {
        JSArray items = new JSArray();
        JSONArray list = result.optJSONArray("items");
        if (list == null) return items;
        Pattern pattern = Pattern.compile("(20[0-9]{2}-[0-9]{2}-[0-9]{2})[^0-9]*" +
            "([0-9]{1,2}:[0-9]{2})\\s*[-~至到]\\s*([0-9]{1,2}:[0-9]{2})");
        for (int i=0;i<list.length() && items.length()<500;i++) {
            JSONObject raw = list.optJSONObject(i);
            if (raw == null) continue;
            String name = raw.optString("kcmc","").trim();
            String time = raw.optString("kssj","");
            if (name.isEmpty()) continue;
            Matcher match = pattern.matcher(time);
            if (!match.find()) continue;
            String start = iso(match.group(1),match.group(2));
            String end = iso(match.group(1),match.group(3));
            String location = raw.optString("cdmc","").trim();
            String campus = raw.optString("cdxqmc","").trim();
            if (!campus.isEmpty() && !location.contains(campus))
                location += " (" + campus + ")";
            JSObject item = new JSObject();
            item.put("id","exam:jiaowu:"+start+":"+name);
            item.put("title",name);
            item.put("courseName",name);
            item.put("location",location.trim());
            item.put("startTime",start);
            item.put("endTime",end);
            item.put("type","exam");
            item.put("examType",raw.optString("ksmc","考试"));
            items.put(item);
        }
        return items;
    }
}
