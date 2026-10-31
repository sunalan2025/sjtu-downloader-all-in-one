package me.hisunalan.sjtudownloader;

import android.app.Activity;
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
            Dialog dialog = new Dialog(getActivity());
            WebView browser = new WebView(getActivity());
            browser.getSettings().setJavaScriptEnabled(true);
            browser.getSettings().setDomStorageEnabled(true);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String scheme = request.getUrl().getScheme();
                    if (!"https".equalsIgnoreCase(scheme)) return true;
                    return false;
                }
                @Override public void onPageFinished(WebView view, String url) {
                    if (url.startsWith(BASE) && !url.contains("/login")) {
                        io.execute(() -> {
                            try {
                                HttpURLConnection connection = connect(BASE + "/api/v1/users/self/profile", null);
                                int code = connection.getResponseCode();
                                connection.disconnect();
                                if (code == 200) {
                                    new Handler(Looper.getMainLooper()).post(() -> {
                                        if (dialog.isShowing()) {
                                            dialog.dismiss();
                                            JSObject result = new JSObject();
                                            result.put("completed", true);
                                            call.resolve(result);
                                        }
                                    });
                                }
                            } catch (Exception ignored) {}
                        });
                    }
                }
            });
            dialog.setContentView(browser);
            Window win = dialog.getWindow();
            if (win != null) {
                win.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
                win.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
                win.setStatusBarColor(Color.rgb(8, 19, 35));
            }
            dialog.setOnCancelListener(d -> call.reject("已取消登录"));
            dialog.setOnDismissListener(d -> {
                browser.stopLoading();
                browser.destroy();
            });
            dialog.show();
            Window shown = dialog.getWindow();
            if (shown != null) shown.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            browser.loadUrl(BASE + "/login/openid_connect");
        });
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
            if (referer != null) c.setRequestProperty("Referer", referer);
            if (HOST.equalsIgnoreCase(url.getHost())) {
                String cookie = CookieManager.getInstance().getCookie(BASE);
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
        HttpURLConnection c = connect(url, BASE);
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
