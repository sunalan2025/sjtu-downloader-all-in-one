package me.hisunalan.sjtudownloader;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.os.Message;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import android.app.Dialog;
import android.content.Context;
import android.graphics.Color;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "SjtuCanvas")
public class SjtuCanvasPlugin extends Plugin {
    private static final String HOST = "oc.sjtu.edu.cn";
    private static final String BASE = "https://" + HOST;
    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final Map<String, AtomicBoolean> cancels = new ConcurrentHashMap<>();

    @PluginMethod
    public void login(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Dialog dialog = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar);
            LinearLayout panel = new LinearLayout(getActivity());
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setBackgroundColor(Color.WHITE);
            LinearLayout toolbar = new LinearLayout(getActivity());
            toolbar.setOrientation(LinearLayout.HORIZONTAL);
            toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
            toolbar.setPadding(dp(16), dp(8), dp(12), dp(8));
            toolbar.setBackgroundColor(Color.WHITE);
            TextView title = new TextView(getActivity());
            title.setText("交大统一身份认证 · 手机端");
            title.setTextSize(14);
            title.setTextColor(Color.rgb(27, 61, 99));
            title.setTypeface(null, android.graphics.Typeface.BOLD);
            toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
            Button check = new Button(getActivity());
            check.setText("完成登录");
            check.setTextSize(11);
            toolbar.addView(check);
            Button close = new Button(getActivity());
            close.setText("关闭");
            close.setTextSize(11);
            toolbar.addView(close);
            Button jwb = new Button(getActivity());
            jwb.setText("交我办");
            jwb.setTextSize(11);
            toolbar.addView(jwb);
            panel.addView(toolbar);
            WebView browser = new WebView(getActivity());
            WebSettings settings = browser.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setSupportMultipleWindows(true);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);
            // jAccount may render a non-mobile page for the embedded "; wv" Android WebView UA.
            // Keep the actual Android OS version while presenting a mobile Chrome browser UA.
            String androidVersion = android.os.Build.VERSION.RELEASE;
            settings.setUserAgentString("Mozilla/5.0 (Linux; Android " + androidVersion +
                "; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36");
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
            panel.addView(browser, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            AtomicBoolean settled = new AtomicBoolean(false);
            AtomicBoolean checking = new AtomicBoolean(false);
            Runnable verify = () -> {
                if (!checking.compareAndSet(false, true)) return;
                io.execute(() -> {
                    boolean ok = false;
                    try {
                        HttpURLConnection connection = connect(BASE + "/api/v1/users/self/profile", null);
                        ok = connection.getResponseCode() == 200;
                        connection.disconnect();
                    } catch (Exception ignored) {}
                    final boolean verified = ok;
                    new Handler(Looper.getMainLooper()).post(() -> {
                        checking.set(false);
                        if (!dialog.isShowing() || settled.get()) return;
                        if (verified) {
                            if (settled.compareAndSet(false, true)) {
                                JSObject response = new JSObject();
                                response.put("completed", true);
                                call.resolve(response);
                                dialog.dismiss();
                            }
                        } else if (browser.getUrl() != null && !browser.getUrl().startsWith(BASE)) {
                            // Do not show spurious warnings while the OAuth screen is still active.
                        } else {
                            Toast.makeText(getContext(), "尚未检测到 Canvas 登录会话，请在网页内完成认证", Toast.LENGTH_SHORT).show();
                        }
                    });
                });
            };
            jwb.setOnClickListener(v -> {
                // Invoke only an actual link supplied by the official jAccount login page.
                // Do not construct undocumented deep links or fake successful authentication.
                String script = "(function(){if(location.hostname!=='jaccount.sjtu.edu.cn')return 'domain';" +
                    "var nodes=Array.from(document.querySelectorAll('a,button,[role=button],input'));" +
                    "var match=nodes.find(n=>/交我办/.test(n.innerText||n.textContent||n.value||n.getAttribute('aria-label')||''));" +
                    "if(match){match.click();return 'clicked';}" +
                    "if(typeof window.appLogin==='function'){window.appLogin();return 'clicked';}" +
                    "return 'missing'})()";
                browser.evaluateJavascript(script, response -> {
                    if (!"\"clicked\"".equals(response)) {
                        Toast.makeText(getContext(),
                            "当前官方登录页尚未显示“交我办”入口，可使用网页账号登录",
                            Toast.LENGTH_LONG).show();
                    }
                });
            });
            check.setOnClickListener(v -> verify.run());
            close.setOnClickListener(v -> dialog.cancel());
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    String scheme = uri.getScheme();
                    if ("https".equalsIgnoreCase(scheme)) return false;
                    if (shouldLaunchLoginApp(uri, view.getUrl(), request.hasGesture())) {
                        openLoginAppLink(uri, browser);
                    }
                    return true; // never load a non-HTTPS scheme in WebView
                }
                @Override public void onPageFinished(WebView view, String url) {
                    if (url.startsWith(BASE) && !url.contains("/login")) verify.run();
                    if (url.startsWith("https://jaccount.sjtu.edu.cn/")) activateMobileMode(browser);
                }
            });
            browser.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onCreateWindow(WebView view, boolean isDialog,
                    boolean isUserGesture, Message resultMsg) {
                    if (!isUserGesture) return false;
                    WebView popup = new WebView(getActivity());
                    popup.setWebViewClient(new WebViewClient() {
                        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                            Uri uri = request.getUrl();
                            if ("https".equalsIgnoreCase(uri.getScheme())) browser.loadUrl(uri.toString());
                            else if (shouldLaunchLoginApp(uri, browser.getUrl(), true)) openLoginAppLink(uri, browser);
                            return true;
                        }
                        @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                            if (url.startsWith("https://")) browser.loadUrl(url);
                            else if (shouldLaunchLoginApp(Uri.parse(url), browser.getUrl(), true)) openLoginAppLink(Uri.parse(url), browser);
                            panel.removeView(popup);
                            popup.destroy();
                        }
                    });
                    panel.addView(popup, new LinearLayout.LayoutParams(1, 1));
                    WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                    transport.setWebView(popup);
                    resultMsg.sendToTarget();
                    return true;
                }
            });
            dialog.setContentView(panel);
            Window win = dialog.getWindow();
            if (win != null) {
                win.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
                win.setStatusBarColor(Color.WHITE);
                win.setNavigationBarColor(Color.WHITE);
                androidx.core.view.WindowCompat.setDecorFitsSystemWindows(win, false);
                androidx.core.view.WindowInsetsControllerCompat controller =
                  new androidx.core.view.WindowInsetsControllerCompat(win, win.getDecorView());
                controller.setAppearanceLightStatusBars(true);
                controller.setAppearanceLightNavigationBars(true);
            }
            ViewCompat.setOnApplyWindowInsetsListener(panel, (view, insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                panel.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            dialog.setOnCancelListener(d -> {
                if (settled.compareAndSet(false, true)) call.reject("已取消登录");
            });
            dialog.setOnDismissListener(d -> {
                browser.stopLoading();
                browser.destroy();
                if (settled.compareAndSet(false, true)) call.reject("登录窗口已关闭");
            });
            dialog.show();
            Window shown = dialog.getWindow();
            if (shown != null) shown.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            ViewCompat.requestApplyInsets(panel);
            // Let Canvas redirect to jAccount's official MOBILE login page and its 交我办 option.
            browser.loadUrl(BASE + "/login/openid_connect");
        });
    }

    /** Official jAccount mobile login uses jaccount://login?uuid=..., often from JS without hasGesture. */
    private boolean shouldLaunchLoginApp(Uri target, String pageUrl, boolean userGesture) {
        String scheme = target.getScheme();
        if (scheme == null) return false;
        Uri origin = pageUrl == null ? Uri.EMPTY : Uri.parse(pageUrl);
        String host = origin.getHost();
        boolean trusted = "https".equalsIgnoreCase(origin.getScheme())
            && "jaccount.sjtu.edu.cn".equalsIgnoreCase(host);
        if (!trusted) return false;
        if ("jaccount".equalsIgnoreCase(scheme)) {
            String uuid = target.getQueryParameter("uuid");
            return "login".equalsIgnoreCase(target.getHost())
                && uuid != null && uuid.matches("[0-9a-fA-F-]{32,40}");
        }
        return userGesture && ("intent".equalsIgnoreCase(scheme)
                || "sjtu".equalsIgnoreCase(scheme) || "jwb".equalsIgnoreCase(scheme));
    }

    /** Click official MOBILE mode, if it exists; no fake auth page or invented login URL. */
    private void activateMobileMode(WebView browser) {
        String script = "(function(){if(location.hostname!=='jaccount.sjtu.edu.cn')return 'skip';"
            + "var nodes=Array.from(document.querySelectorAll('a,button,[role=tab],label'));"
            + "var n=nodes.find(e=>(e.innerText||e.textContent||'').trim().toUpperCase()==='MOBILE');"
            + "if(!n)return 'absent';"
            + "if(n.getAttribute('aria-selected')==='true'||n.classList.contains('active'))return 'active';"
            + "n.click();return 'clicked'})()";
        browser.evaluateJavascript(script, ignored -> {});
    }

    private int dp(int value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    private void openLoginAppLink(Uri uri, WebView browser) {
        try {
            String scheme = uri.getScheme();
            if (scheme == null) return;
            if (!("intent".equalsIgnoreCase(scheme) || "jaccount".equalsIgnoreCase(scheme) ||
                  "sjtu".equalsIgnoreCase(scheme) || "jwb".equalsIgnoreCase(scheme) ||
                  "weixin".equalsIgnoreCase(scheme) || "alipays".equalsIgnoreCase(scheme) ||
                  "my".equalsIgnoreCase(scheme))) return;
            Intent intent;
            if ("intent".equalsIgnoreCase(scheme)) {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, uri);
            }
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.setComponent(null);
            intent.setSelector(null);
            try {
                getActivity().startActivity(intent);
            } catch (ActivityNotFoundException missing) {
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null) {
                    Uri target = Uri.parse(fallback);
                    String host = target.getHost();
                    if ("https".equalsIgnoreCase(target.getScheme()) &&
                        host != null && (host.equals("sjtu.edu.cn") || host.endsWith(".sjtu.edu.cn"))) {
                        browser.loadUrl(fallback);
                        return;
                    }
                }
                Toast.makeText(getContext(), "未找到对应 App，可选择网页账号登录", Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Toast.makeText(getContext(), "无法打开认证应用，请尝试网页账号登录", Toast.LENGTH_SHORT).show();
        }
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            View root = getActivity().getWindow().getDecorView();
            WindowInsetsCompat windowInsets = ViewCompat.getRootWindowInsets(root);
            Insets bars = windowInsets == null ? Insets.NONE :
                windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = root.getResources().getDisplayMetrics().density;
            JSObject result = new JSObject();
            result.put("top", bars.top / density);
            result.put("bottom", bars.bottom / density);
            result.put("left", bars.left / density);
            result.put("right", bars.right / density);
            call.resolve(result);
        });
    }


    @PluginMethod
    public void openOfficialCalendar(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            // External browser cookies cannot be read by the native calendar client.
            Dialog dialog = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar);
            AtomicBoolean settled = new AtomicBoolean(false);
            LinearLayout panel = new LinearLayout(getActivity());
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setBackgroundColor(Color.WHITE);
            LinearLayout header = new LinearLayout(getActivity());
            header.setGravity(android.view.Gravity.CENTER_VERTICAL);
            TextView title = new TextView(getActivity());
            title.setText("交大正式课表 · 独立认证");
            title.setPadding(dp(12), 0, 0, 0);
            header.addView(title, new LinearLayout.LayoutParams(0, dp(54), 1));
            Button done = new Button(getActivity());
            done.setText("完成同步");
            header.addView(done);
            Button close = new Button(getActivity());
            close.setText("关闭");
            header.addView(close);
            panel.addView(header);
            WebView browser = new WebView(getActivity());
            browser.getSettings().setJavaScriptEnabled(true);
            browser.getSettings().setDomStorageEnabled(true);
            browser.getSettings().setUseWideViewPort(true);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
            panel.addView(browser, new LinearLayout.LayoutParams(-1, 0, 1));
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                    if ("https".equalsIgnoreCase(req.getUrl().getScheme())) return false;
                    if (shouldLaunchLoginApp(req.getUrl(), view.getUrl(), req.hasGesture())) {
                        openLoginAppLink(req.getUrl(), browser);
                    }
                    return true;
                }
                @Override public void onPageFinished(WebView view, String url) {
                    if (url.startsWith("https://jaccount.sjtu.edu.cn/")) activateMobileMode(view);
                }
            });
            close.setOnClickListener(v -> dialog.dismiss());
            done.setOnClickListener(v -> io.execute(() -> {
                boolean valid = false;
                try {
                    HttpURLConnection c = connect("https://calendar.sjtu.edu.cn/api/calendar/list",
                        "https://calendar.sjtu.edu.cn/ui/calendar");
                    valid = c.getResponseCode() == 200 && "calendar.sjtu.edu.cn".equalsIgnoreCase(c.getURL().getHost())
                        && c.getContentType() != null && c.getContentType().contains("json");
                    c.disconnect();
                } catch (Exception ignored) {}
                final boolean success = valid;
                new Handler(Looper.getMainLooper()).post(() -> {
                    if (success) {
                        CookieManager.getInstance().flush();
                        JSObject out = new JSObject();
                        out.put("ok", true);
                        if (settled.compareAndSet(false, true)) call.resolve(out);
                        dialog.dismiss();
                    } else {
                        Toast.makeText(getContext(), "请先在网页完成正式课表 SSO 登录", Toast.LENGTH_LONG).show();
                    }
                });
            }));
            dialog.setContentView(panel);
            Window window = dialog.getWindow();
            if (window != null) {
                androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false);
                window.setStatusBarColor(Color.WHITE);
                window.setNavigationBarColor(Color.WHITE);
                androidx.core.view.WindowInsetsControllerCompat bars =
                    new androidx.core.view.WindowInsetsControllerCompat(window, window.getDecorView());
                bars.setAppearanceLightStatusBars(true);
                bars.setAppearanceLightNavigationBars(true);
            }
            ViewCompat.setOnApplyWindowInsetsListener(panel, (view, insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            dialog.setOnDismissListener(d -> {
                browser.stopLoading();
                browser.destroy();
                JSObject out = new JSObject();
                out.put("ok", false);
                if (settled.compareAndSet(false, true)) call.resolve(out);
            });
            dialog.show();
            Window shown = dialog.getWindow();
            if (shown != null) shown.setLayout(-1, -1);
            browser.loadUrl("https://calendar.sjtu.edu.cn/login");
        });
    }

    /** Native equivalent of desktop schedule-fetcher.ts, with separate official SSO cookies. */
    private JSArray officialCalendarEvents(String month) throws Exception {
        int y = Integer.parseInt(month.substring(0, 4));
        int m = Integer.parseInt(month.substring(5, 7));
        Calendar next = new GregorianCalendar(TimeZone.getTimeZone("Asia/Shanghai"), Locale.ROOT);
        next.clear();
        next.set(y, m - 1, 1);
        next.add(Calendar.MONTH, 1);
        String from = month + "-01 00:00";
        String to = String.format(Locale.ROOT, "%04d-%02d-01 00:00",
            next.get(Calendar.YEAR), next.get(Calendar.MONTH) + 1);
        String url = "https://calendar.sjtu.edu.cn/api/event/list?startDate=" +
            URLEncoder.encode(from, "UTF-8") + "&endDate=" + URLEncoder.encode(to, "UTF-8") + "&weekly=true&ids=";
        JSONObject data = getObject(url).optJSONObject("data");
        if (data == null) throw new Exception("正式课表接口无日程数据");
        JSONArray events = data.optJSONArray("events");
        JSArray items = new JSArray();
        if (events == null) return items;
        for (int i = 0; i < events.length(); i++) {
            JSONObject item = events.optJSONObject(i);
            if (item == null || item.optString("startTime", "").isEmpty()) continue;
            JSObject result = new JSObject();
            result.put("id", "official:" + item.optString("eventId", String.valueOf(i)));
            result.put("title", item.optString("title", "课程事件"));
            result.put("startTime", withShanghaiZone(item.optString("startTime")));
            result.put("endTime", withShanghaiZone(item.optString("endTime", item.optString("startTime"))));
            result.put("courseName", item.optString("location", "正式课表"));
            result.put("type", "course");
            items.put(result);
        }
        return items;
    }

    private String withShanghaiZone(String date) {
        if (date == null) return "";
        if (date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) return date;
        String result = date.replace(' ', 'T');
        return result.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?")
            ? result + "+08:00" : result;
    }

    @PluginMethod
    public void calendar(PluginCall call) {
        String month = call.getString("month", "");
        if (!month.matches("20[0-9]{2}-(0[1-9]|1[0-2])")) { call.reject("月份格式不合法"); return; }
        io.execute(() -> {
            try {
                JSArray official = new JSArray();
                String officialWarning = "";
                try { official = officialCalendarEvents(month); }
                catch (Exception e) {
                    officialWarning = "正式课表未连接，请点击下方“同步交大官方课表”完成独立登录。";
                }
                // Preserve useful official timetable even when Canvas-only API credentials fail.
                final JSArray authorizedOfficial = official;
                final String calendarInfo = officialWarning;
                // Distinguish expired login from a single restricted endpoint.
                try { getObject(BASE + "/api/v1/users/self/profile"); }
                catch (Exception authError) {
                    JSObject result = new JSObject();
                    result.put("items", authorizedOfficial);
                    result.put("authRequired", true);
                    result.put("warning", authorizedOfficial.length() > 0
                        ? "正式课表已同步，但 Canvas 会话未授权，作业截止日期无法同步。"
                        : "Canvas 登录会话失效或 API 不允许访问；" + calendarInfo);
                    call.resolve(result);
                    return;
                }
                int year = Integer.parseInt(month.substring(0, 4));
                int monthNo = Integer.parseInt(month.substring(5, 7));
                Calendar next = new GregorianCalendar(TimeZone.getTimeZone("Asia/Shanghai"), Locale.ROOT);
                next.clear();
                next.set(year, monthNo - 1, 1);
                next.add(Calendar.MONTH, 1);
                String end = String.format(Locale.ROOT, "%04d-%02d-01", next.get(Calendar.YEAR), next.get(Calendar.MONTH) + 1);
                java.util.LinkedHashMap<String, JSObject> found = new java.util.LinkedHashMap<>();
                java.util.ArrayList<String> courses = new java.util.ArrayList<>();
                java.util.HashMap<String, String> courseNames = new java.util.HashMap<>();
                boolean courseDenied = false;
                try {
                    JSONArray courseList = getAllPages(BASE +
                        "/api/v1/courses?per_page=100&enrollment_state%5B%5D=active&enrollment_state%5B%5D=completed");
                    for (int i = 0; i < courseList.length(); i++) {
                        JSONObject course = courseList.optJSONObject(i);
                        if (course == null) continue;
                        String id = course.optString("id", "");
                        if (id.matches("[0-9]{1,20}")) {
                            courses.add(id);
                            courseNames.put(id, course.optString("name", ""));
                        }
                    }
                } catch (Exception e) { courseDenied = true; }
                boolean calendarDenied = false;
                if (!courses.isEmpty()) {
                    outer:
                    for (int pos = 0; pos < courses.size(); pos += 8) {
                        StringBuilder context = new StringBuilder();
                        for (int i = pos; i < Math.min(courses.size(), pos + 8); i++) {
                            context.append("&context_codes%5B%5D=course_").append(courses.get(i));
                        }
                        for (String type : new String[]{"event", "assignment"}) {
                            try {
                                JSONArray batch = getAllPages(BASE + "/api/v1/calendar_events?per_page=100&type=" +
                                    type + "&start_date=" + month + "-01&end_date=" + end + context);
                                for (int i = 0; i < batch.length(); i++) {
                                    JSONObject raw = batch.optJSONObject(i);
                                    if (raw == null) continue;
                                    JSONObject assignment = raw.optJSONObject("assignment");
                                    String date = raw.optString("start_at", "");
                                    if (date.isEmpty()) date = raw.optString("due_at", "");
                                    if (date.isEmpty() && assignment != null) date = assignment.optString("due_at", "");
                                    if (date.isEmpty()) continue;
                                    String title = raw.optString("title", "");
                                    if (title.isEmpty() && assignment != null) title = assignment.optString("name", "");
                                    if (title.isEmpty()) title = "未命名日程";
                                    String id = type + ":" + raw.optString("id", String.valueOf(i));
                                    JSObject event = new JSObject();
                                    event.put("id", id);
                                    event.put("title", title);
                                    event.put("startTime", date);
                                    event.put("endTime", raw.optString("end_at", date));
                                    event.put("courseName", raw.optString("context_name", ""));
                                    event.put("type", type);
                                    found.put(id, event);
                                }
                            } catch (Exception e) {
                                calendarDenied = true;
                                // Do not trigger the same unauthorized endpoint repeatedly.
                                if (safeError(e).contains("401") || safeError(e).contains("403")) break outer;
                            }
                        }
                    }
                } else { calendarDenied = true; }

                // Official API fallback 1: the student's upcoming sidebar events.
                boolean fallbackSucceeded = false;
                if (calendarDenied || found.isEmpty()) {
                    try {
                        JSONArray upcoming = getAllPages(BASE + "/api/v1/users/self/upcoming_events?per_page=100");
                        fallbackSucceeded = true;
                        for (int i = 0; i < upcoming.length(); i++) {
                            JSONObject raw = upcoming.optJSONObject(i);
                            if (raw == null) continue;
                            JSONObject assignment = raw.optJSONObject("assignment");
                            String date = raw.optString("start_at", raw.optString("due_at", ""));
                            if (date.isEmpty() && assignment != null) date = assignment.optString("due_at", "");
                            if (date.isEmpty() || !date.startsWith(month)) continue;
                            String title = raw.optString("title", "");
                            if (title.isEmpty() && assignment != null) title = assignment.optString("name", "");
                            if (title.isEmpty()) continue;
                            String id = "upcoming:" + raw.optString("id", String.valueOf(i));
                            JSObject event = new JSObject();
                            event.put("id", id);
                            event.put("title", title);
                            event.put("startTime", date);
                            event.put("endTime", raw.optString("end_at", date));
                            event.put("courseName", raw.optString("context_name", ""));
                            event.put("type", assignment == null ? "event" : "assignment");
                            found.put(id, event);
                        }
                    } catch (Exception ignored) { /* handled via warning */ }
                }

                // Official API fallback 2: course assignment deadlines, useful when calendar_events is 401.
                int successfulAssignmentCourses = 0;
                if (calendarDenied) {
                    for (String id : courses) {
                        if (successfulAssignmentCourses >= 40) break;
                        try {
                            JSONArray assignments = getAllPages(BASE + "/api/v1/courses/" + id +
                                "/assignments?per_page=100&order_by=due_at");
                            successfulAssignmentCourses++;
                            for (int i = 0; i < assignments.length(); i++) {
                                JSONObject item = assignments.optJSONObject(i);
                                if (item == null) continue;
                                String date = item.optString("due_at", "");
                                if (date.isEmpty() || !date.startsWith(month)) continue;
                                String assignmentId = item.optString("id", String.valueOf(i));
                                JSObject event = new JSObject();
                                event.put("id", "assignment:" + id + ":" + assignmentId);
                                event.put("title", item.optString("name", "作业截止"));
                                event.put("startTime", date);
                                event.put("endTime", date);
                                event.put("courseName", courseNames.get(id));
                                event.put("type", "assignment");
                                found.put("assignment:" + id + ":" + assignmentId, event);
                            }
                        } catch (Exception ignored) { /* some courses restrict assignment access */ }
                    }
                }
                JSArray items = new JSArray();
                for (int i = 0; i < authorizedOfficial.length(); i++) {
                    items.put(authorizedOfficial.get(i));
                }
                for (JSObject item : found.values()) items.put(item);
                JSObject result = new JSObject();
                result.put("items", items);
                result.put("authRequired", false);
                if (calendarDenied || courseDenied) {
                    if (fallbackSucceeded || successfulAssignmentCourses > 0) {
                        result.put("warning", "Canvas 日历接口暂不可访问，已使用授权课程作业和近期事件作为备用来源，显示的日程可能不完整。");
                    } else {
                        result.put("warning", "Canvas 日历接口未授权且备用源也不可用。" + calendarInfo);
                    }
                }
                if (!result.has("warning") && !calendarInfo.isEmpty()) result.put("warning", calendarInfo);
                call.resolve(result);
            } catch (Exception e) { call.reject(safeError(e)); }
        });
    }


    /** Privacy-safe on-device diagnostics: never return Cookie, access token or URL query string. */
    @PluginMethod
    public void diagnoseAuth(PluginCall call) {
        io.execute(() -> {
            JSObject result = new JSObject();
            result.put("canvasCookie", CookieManager.getInstance().getCookie(BASE) != null);
            result.put("jaccountCookie", CookieManager.getInstance().getCookie("https://jaccount.sjtu.edu.cn") != null);
            result.put("officialCalendarCookie",
                CookieManager.getInstance().getCookie("https://calendar.sjtu.edu.cn") != null);
            result.put("canvasProfile", safeProbe(BASE + "/api/v1/users/self/profile"));
            result.put("canvasCalendar", safeProbe(BASE + "/api/v1/calendar_events?per_page=1"));
            result.put("canvasCourses", safeProbe(BASE + "/api/v1/courses?per_page=1"));
            result.put("officialCalendar", safeProbe("https://calendar.sjtu.edu.cn/api/calendar/list"));
            call.resolve(result);
        });
    }

    private String safeProbe(String url) {
        HttpURLConnection c = null;
        try {
            c = connect(url, url.startsWith("https://calendar.sjtu.edu.cn/")
                ? "https://calendar.sjtu.edu.cn/ui/calendar" : BASE);
            int status = c.getResponseCode();
            String host = c.getURL().getHost();
            // Fixed hostnames only. Never include auth query strings, cookies or response bodies.
            if (!("oc.sjtu.edu.cn".equals(host) || "calendar.sjtu.edu.cn".equals(host)
                || "jaccount.sjtu.edu.cn".equals(host))) host = "other";
            return status + " (" + host + ")";
        } catch (Exception e) {
            return "请求异常：" + e.getClass().getSimpleName();
        } finally {
            if (c != null) c.disconnect();
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        io.execute(() -> {
            try {
                JSONObject profile = getObject(BASE + "/api/v1/users/self/profile");
                JSObject result = new JSObject();
                result.put("loggedIn", true);
                result.put("name", profile.optString("name", ""));
                call.resolve(result);
            } catch (Exception ignored) {
                JSObject result = new JSObject();
                result.put("loggedIn", false);
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void courses(PluginCall call) {
        io.execute(() -> {
            try {
                String url = BASE + "/api/v1/courses?per_page=100&include%5B%5D=term&enrollment_state%5B%5D=active&enrollment_state%5B%5D=completed&enrollment_state%5B%5D=concluded";
                JSONArray raw = getAllPages(url);
                JSArray items = new JSArray();
                for (int i = 0; i < raw.length(); i++) {
                    JSONObject course = raw.optJSONObject(i);
                    if (course == null || course.optBoolean("access_restricted_by_date", false)) continue;
                    String name = course.optString("name", "");
                    if (name.isEmpty()) continue;
                    JSObject item = new JSObject();
                    item.put("id", course.optString("id"));
                    item.put("name", name);
                    item.put("code", course.optString("course_code", ""));
                    JSONObject term = course.optJSONObject("term");
                    item.put("term", term == null ? "" : term.optString("name", ""));
                    items.put(item);
                }
                JSObject result = new JSObject();
                result.put("items", items);
                call.resolve(result);
            } catch (Exception e) { call.reject(safeError(e)); }
        });
    }

    @PluginMethod
    public void files(PluginCall call) {
        String courseId = call.getString("courseId", "");
        if (!courseId.matches("[0-9]{1,20}")) { call.reject("课程编号不合法"); return; }
        io.execute(() -> {
            try {
                JSONArray raw = getAllPages(BASE + "/api/v1/courses/" + courseId + "/files?per_page=100");
                JSArray items = new JSArray();
                for (int i = 0; i < raw.length(); i++) {
                    JSONObject file = raw.optJSONObject(i);
                    if (file == null) continue;
                    JSObject item = new JSObject();
                    item.put("id", file.optString("id"));
                    item.put("name", file.optString("display_name", file.optString("filename", "unnamed")));
                    item.put("size", file.optLong("size", 0));
                    item.put("contentType", file.optString("content-type", ""));
                    item.put("locked", file.optBoolean("locked", false) || file.optBoolean("hidden", false));
                    items.put(item);
                }
                JSObject result = new JSObject();
                result.put("items", items);
                call.resolve(result);
            } catch (Exception e) { call.reject(safeError(e)); }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        String fileId = call.getString("fileId", "");
        String taskId = call.getString("taskId", "");
        if (!fileId.matches("[0-9]{1,20}") || taskId.isEmpty() || taskId.length() > 120) {
            call.reject("参数不合法"); return;
        }
        AtomicBoolean cancelled = new AtomicBoolean(false);
        if (cancels.putIfAbsent(taskId, cancelled) != null) { call.reject("任务已存在"); return; }
        io.execute(() -> {
            File temp = null;
            try {
                JSONObject info = getObject(BASE + "/api/v1/files/" + fileId);
                if (info.optBoolean("locked", false) || info.optBoolean("hidden", false)) throw new Exception("文件不可下载");
                String url = info.optString("url", "");
                if (!url.startsWith("https://")) throw new Exception("Canvas 未提供有效 HTTPS 下载链接");
                String name = cleanName(info.optString("display_name", info.optString("filename", "download-" + fileId)));
                File root = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "SJTU Downloader");
                // Preserve desktop-style folder organization, never trust raw path fragments.
                String term = call.getString("term", "");
                String courseName = call.getString("courseName", "");
                if (!term.trim().isEmpty()) root = new File(root, cleanName(term));
                if (!courseName.trim().isEmpty()) root = new File(root, cleanName(courseName));
                if (!root.exists() && !root.mkdirs()) throw new Exception("无法创建下载目录");
                File target = uniqueFile(root, name);
                temp = new File(root, "." + taskId.replaceAll("[^A-Za-z0-9_-]", "_") + ".part");
                long total = Math.max(0, info.optLong("size", 0));
                HttpURLConnection connection = connect(url, BASE);
                if (connection.getResponseCode() / 100 != 2) throw new Exception("下载 HTTP " + connection.getResponseCode());
                long length = connection.getContentLengthLong();
                if (length > 0) total = length;
                long bytes = 0;
                byte[] buffer = new byte[64 * 1024];
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temp)) {
                    int count;
                    long lastUpdate = 0;
                    while ((count = input.read(buffer)) != -1) {
                        if (cancelled.get()) throw new Exception("用户取消下载");
                        output.write(buffer, 0, count);
                        bytes += count;
                        long now = System.currentTimeMillis();
                        if (now - lastUpdate > 220) {
                            progress(taskId, name, bytes, total);
                            lastUpdate = now;
                        }
                    }
                    output.getFD().sync();
                } finally { connection.disconnect(); }
                if (cancelled.get()) throw new Exception("用户取消下载");
                if (!temp.renameTo(target)) throw new Exception("保存文件失败");
                progress(taskId, name, bytes, total);
                JSObject result = new JSObject();
                result.put("uri", target.toURI().toString());
                result.put("fileName", target.getName());
                call.resolve(result);
            } catch (Exception e) {
                if (temp != null) temp.delete();
                call.reject(safeError(e));
            } finally { cancels.remove(taskId); }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String taskId = call.getString("taskId", "");
        AtomicBoolean cancel = cancels.get(taskId);
        if (cancel != null) cancel.set(true);
        JSObject result = new JSObject();
        result.put("ok", cancel != null);
        call.resolve(result);
    }

    @PluginMethod
    public void logout(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CookieManager.getInstance().removeAllCookies(null);
            CookieManager.getInstance().flush();
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        });
    }

    private void progress(String taskId, String name, long bytes, long total) {
        JSObject result = new JSObject();
        result.put("taskId", taskId);
        result.put("fileName", name);
        result.put("bytes", bytes);
        result.put("total", total);
        notifyListeners("downloadProgress", result);
    }

    private HttpURLConnection connect(String value, String referer) throws Exception {
        URL url = new URL(value);
        for (int i = 0; i < 8; i++) {
            if (!"https".equalsIgnoreCase(url.getProtocol())) throw new Exception("禁止非 HTTPS 请求");
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "SJTU Downloader Android/0.1");
            c.setRequestProperty("Accept", "application/json, */*");
            if ("calendar.sjtu.edu.cn".equalsIgnoreCase(url.getHost())) {
                c.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            }
            if (referer != null) c.setRequestProperty("Referer", referer);
            if (HOST.equalsIgnoreCase(url.getHost()) || "calendar.sjtu.edu.cn".equalsIgnoreCase(url.getHost())) {
                String cookie = CookieManager.getInstance().getCookie("https://" + url.getHost());
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
            }
            int code = c.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = c.getHeaderField("Location");
                if (location == null) throw new Exception("重定向缺少地址");
                URL next = new URL(url, location);
                c.disconnect();
                url = next;
                continue;
            }
            return c;
        }
        throw new Exception("重定向次数过多");
    }

    private JSONObject getObject(String url) throws Exception {
        String referer = url.startsWith("https://calendar.sjtu.edu.cn/")
            ? "https://calendar.sjtu.edu.cn/ui/calendar" : BASE;
        HttpURLConnection c = connect(url, referer);

        try {
            if (c.getResponseCode() != 200) throw new Exception("Canvas HTTP " + c.getResponseCode());
            String json;
            try (InputStream input = c.getInputStream()) { json = readString(input); }
            return new JSONObject(json);
        } finally { c.disconnect(); }
    }

    private JSONArray getAllPages(String firstUrl) throws Exception {
        JSONArray combined = new JSONArray();
        String next = firstUrl;
        for (int page = 0; next != null && page < 100; page++) {
            if (!next.startsWith(BASE + "/api/v1/")) throw new Exception("Canvas 翻页地址不合法");
            HttpURLConnection c = connect(next, BASE);
            try {
                if (c.getResponseCode() != 200) throw new Exception("Canvas HTTP " + c.getResponseCode());
                JSONArray batch;
                try (InputStream in = c.getInputStream()) { batch = new JSONArray(readString(in)); }
                for (int i = 0; i < batch.length(); i++) combined.put(batch.get(i));
                next = null;
                String links = c.getHeaderField("Link");
                if (links != null) {
                    for (String part : links.split(",")) {
                        if (part.contains("rel=\"next\"")) {
                            int a = part.indexOf('<'), b = part.indexOf('>', a + 1);
                            if (a >= 0 && b > a) next = part.substring(a + 1, b);
                        }
                    }
                }
            } finally { c.disconnect(); }
        }
        return combined;
    }

    private static String readString(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[8192]; int count;
        while ((count = in.read(chunk)) != -1) {
            buffer.write(chunk, 0, count);
            if (buffer.size() > 16 * 1024 * 1024) throw new Exception("响应数据过大");
        }
        return buffer.toString("UTF-8");
    }

    private static String cleanName(String raw) {
        String cleaned = raw.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").replaceAll("^\\.+", "_").trim();
        if (cleaned.length() > 160) cleaned = cleaned.substring(0, 160);
        return cleaned.isEmpty() ? "download" : cleaned;
    }

    private static File uniqueFile(File dir, String filename) {
        File candidate = new File(dir, filename);
        if (!candidate.exists()) return candidate;
        int dot = filename.lastIndexOf('.');
        String stem = dot > 0 ? filename.substring(0, dot) : filename;
        String suffix = dot > 0 ? filename.substring(dot) : "";
        for (int i = 1; i < 100000; i++) {
            candidate = new File(dir, stem + " (" + i + ")" + suffix);
            if (!candidate.exists()) return candidate;
        }
        return new File(dir, String.valueOf(System.currentTimeMillis()) + "-" + filename);
    }

    private static String safeError(Exception e) {
        String msg = e.getMessage();
        if (msg == null) return "未知错误";
        return msg.replaceAll("https?://[^\\s]+", "[URL]");
    }
}
