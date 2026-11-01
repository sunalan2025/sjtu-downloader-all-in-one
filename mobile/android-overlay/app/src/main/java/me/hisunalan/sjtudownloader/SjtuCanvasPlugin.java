package me.hisunalan.sjtudownloader;

import android.app.Activity;
import me.hisunalan.sjtudownloader.beta.R;
import android.content.res.ColorStateList;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.Settings;
import android.net.Uri;
import android.view.View;
import android.widget.FrameLayout;
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
import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.os.Build;
import android.provider.MediaStore;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.net.URLConnection;
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
import java.io.IOException;
import java.io.EOFException;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.ConnectException;
import java.net.UnknownHostException;
import javax.net.ssl.SSLException;
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

    private final AtomicBoolean calendarSsoInFlight = new AtomicBoolean(false);
    private final ExecutorService calendarAuthIo = Executors.newSingleThreadExecutor();
    private final ExecutorService examIo = Executors.newSingleThreadExecutor();
    private final MobileExamService examService = new MobileExamService();
    private final AtomicBoolean silentExamConnecting = new AtomicBoolean(false);
    private volatile long lastSilentExamAttempt = 0L;
    private volatile Runnable cancelSilentCalendarSso;

    private volatile long calendarVerifiedUntil = 0L;
    private SessionCookieVault sessionVault;

    private synchronized SessionCookieVault vault() {
        if (sessionVault == null) sessionVault = new SessionCookieVault(getContext());
        return sessionVault;
    }


    @PluginMethod
    public void login(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Dialog dialog = new Dialog(getActivity(), R.style.SJTUGlassDialog);
            LinearLayout panel = new LinearLayout(getActivity());
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setBackgroundResource(R.drawable.sjtu_glass_native_surface);
            LinearLayout toolbar = new LinearLayout(getActivity());
            toolbar.setOrientation(LinearLayout.HORIZONTAL);
            toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
            toolbar.setPadding(dp(10), dp(7), dp(10), dp(7));
            toolbar.setBackgroundColor(Color.TRANSPARENT);
            TextView title = new TextView(getActivity());
            title.setText("账号登录");
            title.setTextSize(14);
            title.setTextColor(Color.rgb(27, 61, 99));
            title.setTypeface(null, android.graphics.Typeface.BOLD);
            toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
            TextView check = glassAction("完成登录", false);
            check.setVisibility(View.GONE);
            toolbar.addView(check);
            TextView close = glassAction("×", false);
            toolbar.addView(close);
            TextView jwb = glassAction("交我办", true);
            jwb.setVisibility(View.GONE);
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
            // WebView must load the official OAuth challenge to obtain a fresh UUID.
            // Keep it covered by a native splash; users should see Jiaowoban, not
            // the intermediate login webpage. Manual web login is always available.
            FrameLayout browserHost = new FrameLayout(getActivity());
            panel.addView(browserHost, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            browserHost.addView(browser, new FrameLayout.LayoutParams(-1, -1));
            LinearLayout splash = new LinearLayout(getActivity());
            splash.setOrientation(LinearLayout.VERTICAL);
            splash.setGravity(Gravity.CENTER);
            splash.setBackgroundResource(R.drawable.sjtu_glass_native_surface);
            TextView launching = new TextView(getActivity());
            launching.setGravity(Gravity.CENTER);
            launching.setText("正在打开交我办…");
            launching.setTextSize(17);
            launching.setTextColor(0xFF385478);
            splash.addView(launching);
            android.widget.ProgressBar spinner = new android.widget.ProgressBar(getActivity());
            LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(dp(36), dp(36));
            spinnerParams.topMargin = dp(22);
            spinnerParams.bottomMargin = dp(22);
            splash.addView(spinner, spinnerParams);
            TextView fallback = glassAction("改用网页登录", false);
            splash.addView(fallback);
            browserHost.addView(splash, new FrameLayout.LayoutParams(-1, -1));
            AtomicBoolean appLaunched = new AtomicBoolean(false);
            Runnable showWebFallback = () -> {
                if (splash.getParent() != null) browserHost.removeView(splash);
                check.setVisibility(View.VISIBLE);
                jwb.setVisibility(View.VISIBLE);
            };
            fallback.setOnClickListener(v -> showWebFallback.run());
            AtomicBoolean settled = new AtomicBoolean(false);
            AtomicBoolean checking = new AtomicBoolean(false);
            AtomicBoolean jwbAutoClicked = new AtomicBoolean(false);
            Handler loginHandler = new Handler(Looper.getMainLooper());
            Runnable verify = () -> {
                if (!checking.compareAndSet(false, true)) return;
                io.execute(() -> {
                    boolean ok = false;
                    try {
                        HttpURLConnection connection = connect(BASE + "/api/v1/users/self/profile", null);
                        ok = connection.getResponseCode() == 200;
                        connection.disconnect();
                        if (ok) {
                            vault().saveAfterVerification();
                            // Canvas & calendar issue different sessions: silently attempt a
                            // new calendar SSO using the just-authenticated jAccount jar.
                            startSilentCalendarSso();
                        }
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
            // The first user tap on Login automatically follows the REAL official
            // Mobile -> 交我办 button inside jAccount, which produces a dynamic
            // jaccount://login?uuid=... value. We NEVER synthesize that UUID.
            jwb.setOnClickListener(v -> {
                jwbAutoClicked.set(false);
                activateMobileMode(browser);
                loginHandler.postDelayed(() ->
                    clickOfficialJiaowoban(browser, jwbAutoClicked, true), 400);
            });
            check.setOnClickListener(v -> verify.run());
            close.setOnClickListener(v -> dialog.cancel());
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    String scheme = uri.getScheme();
                    if ("https".equalsIgnoreCase(scheme)) return false;
                    if (shouldLaunchLoginApp(uri, view.getUrl(), request.hasGesture())) {
                        if (openLoginAppLink(uri, browser)) {
                            appLaunched.set(true);
                            launching.setText("请在交我办内完成登录");
                        } else {
                            showWebFallback.run();
                        }
                    }
                    return true; // never load a non-HTTPS scheme in WebView
                }
                @Override public void onPageFinished(WebView view, String url) {
                    if (url.startsWith(BASE) && !url.contains("/login")) verify.run();
                    if (url.startsWith("https://jaccount.sjtu.edu.cn/")) {
                        activateMobileMode(browser);
                        for (long delay : new long[]{550, 1500, 2900}) {
                            loginHandler.postDelayed(() -> {
                                if (dialog.isShowing() && !settled.get() && !jwbAutoClicked.get()) {
                                    clickOfficialJiaowoban(browser, jwbAutoClicked, false);
                                }
                            }, delay);
                        }
                    }
                }
            });
            // A login in another App does not necessarily trigger onPageFinished.
            // Check the real Canvas profile after the user returns to our process.
            Runnable[] loginPoll = new Runnable[1];
            loginPoll[0] = () -> {
                if (settled.get() || !dialog.isShowing()) return;
                if (appLaunched.get()) verify.run();
                loginHandler.postDelayed(loginPoll[0], 1800);
            };
            loginHandler.postDelayed(loginPoll[0], 1800);
            loginHandler.postDelayed(() -> {
                if (dialog.isShowing() && !settled.get() && !appLaunched.get()) {
                    launching.setText("交我办无法自动启动");
                    showWebFallback.run();
                }
            }, 14000);
            browser.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onCreateWindow(WebView view, boolean isDialog,
                    boolean isUserGesture, Message resultMsg) {
                    // The user already chose the App login flow. jAccount's
                    // script may open its generated app-link without hasGesture.
                    if (!isUserGesture && !isOfficialJaccountPage(browser.getUrl())) return false;
                    WebView popup = new WebView(getActivity());
                    popup.setWebViewClient(new WebViewClient() {
                        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                            Uri uri = request.getUrl();
                            if ("https".equalsIgnoreCase(uri.getScheme())) browser.loadUrl(uri.toString());
                            else if (shouldLaunchLoginApp(uri, browser.getUrl(), true)) {
                                if (openLoginAppLink(uri, browser)) {
                                    appLaunched.set(true);
                                    launching.setText("请在交我办内完成登录");
                                } else showWebFallback.run();
                            }
                            return true;
                        }
                        @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                            if (url.startsWith("https://")) browser.loadUrl(url);
                            else if (shouldLaunchLoginApp(Uri.parse(url), browser.getUrl(), true)) {
                                if (openLoginAppLink(Uri.parse(url), browser)) {
                                    appLaunched.set(true);
                                    launching.setText("请在交我办内完成登录");
                                } else showWebFallback.run();
                            }
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
                loginHandler.removeCallbacks(loginPoll[0]);
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

    private boolean isOfficialJaccountPage(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equalsIgnoreCase(uri.getScheme()) &&
            "jaccount.sjtu.edu.cn".equalsIgnoreCase(uri.getHost());
    }

    /** Reuse the official login page's dynamic app-link; do not forge deep links. */
    private void clickOfficialJiaowoban(WebView browser, AtomicBoolean clicked,
                                        boolean showFallback) {
        if (clicked.get() || !isOfficialJaccountPage(browser.getUrl())) return;
        String script = "(function(){if(location.hostname!=='jaccount.sjtu.edu.cn')return 'skip';" +
            "var nodes=Array.from(document.querySelectorAll('a,button,[role=button],input'));" +
            "var target=nodes.find(n=>/交我办/.test(n.innerText||n.textContent||n.value||n.getAttribute('aria-label')||''));" +
            "if(target){target.click();return 'clicked';}" +
            "if(typeof window.appLogin==='function'){window.appLogin();return 'clicked';}" +
            "return 'missing'})()";
        browser.evaluateJavascript(script, result -> {
            if ("\"clicked\"".equals(result)) {
                clicked.set(true);
            } else if (showFallback) {
                Toast.makeText(getContext(),
                    "官方页面未提供交我办快捷入口，可选择网页账号登录",
                    Toast.LENGTH_LONG).show();
            }
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

    /** Frosted, rounded actions that don't inherit the default Android Button skin. */
    private TextView glassAction(String label, boolean accented) {
        TextView view = new TextView(getActivity());
        view.setText(label);
        view.setTextSize(12);
        view.setGravity(Gravity.CENTER);
        view.setTypeface(null, android.graphics.Typeface.BOLD);
        view.setTextColor(accented ? Color.rgb(36, 95, 165) : Color.rgb(91, 111, 138));
        view.setMinHeight(dp(40));
        view.setMinWidth(dp(label.equals("×") ? 36 : 51));
        view.setPadding(dp(9), dp(5), dp(9), dp(5));
        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            accented ? new int[]{0xEAF6FBFF,0xC8DDEEFF}
                     : new int[]{0xEFFFFFFF,0xB5FFFFFF});
        background.setCornerRadius(dp(13));
        background.setStroke(dp(1), Color.WHITE);
        view.setBackground(new RippleDrawable(
            ColorStateList.valueOf(0x394F8EBD), background, null));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(40));
        params.setMargins(dp(3), 0, dp(3), 0);
        view.setLayoutParams(params);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    private boolean openLoginAppLink(Uri uri, WebView browser) {
        try {
            String scheme = uri.getScheme();
            if (scheme == null) return false;
            if (!("intent".equalsIgnoreCase(scheme) || "jaccount".equalsIgnoreCase(scheme) ||
                  "sjtu".equalsIgnoreCase(scheme) || "jwb".equalsIgnoreCase(scheme) ||
                  "weixin".equalsIgnoreCase(scheme) || "alipays".equalsIgnoreCase(scheme) ||
                  "my".equalsIgnoreCase(scheme))) return false;
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
                return true;
            } catch (ActivityNotFoundException missing) {
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null) {
                    Uri target = Uri.parse(fallback);
                    String host = target.getHost();
                    if ("https".equalsIgnoreCase(target.getScheme()) &&
                        host != null && (host.equals("sjtu.edu.cn") || host.endsWith(".sjtu.edu.cn"))) {
                        browser.loadUrl(fallback);
                        return false;
                    }
                }
                Toast.makeText(getContext(), "未找到对应 App，可选择网页账号登录", Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Toast.makeText(getContext(), "无法打开认证应用，请尝试网页账号登录", Toast.LENGTH_SHORT).show();
        }
        return false;
    }

    private static boolean hasCalendarSessionCookie() {
        String cookies = CookieManager.getInstance().getCookie("https://calendar.sjtu.edu.cn/");
        if (cookies == null) return false;
        for (String pair : cookies.split(";")) {
            if (pair.trim().toUpperCase(Locale.ROOT).startsWith("JSESSIONID=") &&
                pair.trim().length() > "JSESSIONID=".length()) return true;
        }
        return false;
    }

    /**
     * Unlike Canvas, the official timetable needs its own calendar.sjtu.edu.cn
     * JSESSIONID. Reproduce the desktop client's silent GET /login handshake.
     * The user must explicitly approve any additional permissions in the visible
     * "同步交大官方课表" screen; this background check never clicks approval.
     */
    private void startSilentCalendarSso() {
        if (!calendarSsoInFlight.compareAndSet(false, true)) return;
        getActivity().runOnUiThread(() -> {
            if (hasCalendarSessionCookie()) {
                calendarSsoInFlight.set(false);
                return;
            }
            FrameLayout container = getActivity().findViewById(android.R.id.content);
            if (container == null) { calendarSsoInFlight.set(false); return; }
            WebView silent = new WebView(getActivity());
            silent.getSettings().setJavaScriptEnabled(true);
            silent.getSettings().setDomStorageEnabled(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(silent, true);
            FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(dp(1), dp(1));
            silent.setAlpha(0.01f);
            container.addView(silent, layout);
            Handler handler = new Handler(Looper.getMainLooper());
            AtomicBoolean finished = new AtomicBoolean(false);
            Runnable cleanup = () -> {
                if (!finished.compareAndSet(false, true)) return;
                cancelSilentCalendarSso = null;
                silent.stopLoading();
                container.removeView(silent);
                silent.destroy();
                calendarSsoInFlight.set(false);
            };
            cancelSilentCalendarSso = cleanup;
            silent.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                    // Do not launch external apps or handle consent in a hidden WebView.
                    return !"https".equalsIgnoreCase(req.getUrl().getScheme());
                }
                @Override public void onPageFinished(WebView view, String url) {
                    if (finished.get()) return;
                    if (url.startsWith("https://calendar.sjtu.edu.cn/") && hasCalendarSessionCookie()) {
                        CookieManager.getInstance().flush();
                        calendarAuthIo.execute(() -> {
                            try {
                                // Check the real endpoint before recording a verified session.
                                if (verifyCalendarSessionQuickly()) {
                                    vault().saveAfterVerification();
                                    JSObject ready = new JSObject();
                                    ready.put("connected", true);
                                    notifyListeners("calendarSessionReady", ready);
                                }
                            } catch (Exception ignored) { }
                            handler.post(cleanup);
                        });
                    } else if (isOfficialJaccountPage(url)) {
                        // jAccount may redirect automatically using its existing SSO
                        // cookie several seconds AFTER onPageFinished. Do not tear
                        // the hidden WebView down before that redirect has a chance.
                        handler.postDelayed(() -> {
                            if (!finished.get() && isOfficialJaccountPage(silent.getUrl())) {
                                // No automatic approval: leave explicit consent for
                                // the visible calendar login fallback.
                                cleanup.run();
                            }
                        }, 6500);
                    }
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request,
                    android.webkit.WebResourceError error) {
                    if (request.isForMainFrame()) handler.post(cleanup);
                }
            });
            handler.postDelayed(cleanup, 20_000);
            silent.loadUrl("https://calendar.sjtu.edu.cn/login");
        });
    }

    @PluginMethod
    public void updateTodayWidget(PluginCall call) {
        try {
            JSArray incoming = call.getArray("items");
            TodayScheduleWidget.persist(getContext(),
                incoming == null ? new JSArray() : incoming,
                Boolean.TRUE.equals(call.getBoolean("clear", false)));
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("桌面课表更新失败：" + safeError(e));
        }
    }

    /** OEM launchers render our RemoteViews, while Android AppWidgetManager
     * controls binding. No photos/files/calendar runtime permission is needed:
     * the widget reads only our own private SharedPreferences. */
    @PluginMethod
    public void widgetStatus(PluginCall call) {
        try {
            JSObject status = TodayScheduleWidget.status(getContext());
            call.resolve(status);
        } catch (Exception e) {
            call.reject("读取桌面组件状态失败：" + safeError(e));
        }
    }

    @PluginMethod
    public void refreshTodayWidget(PluginCall call) {
        try {
            TodayScheduleWidget.refresh(getContext());
            call.resolve(TodayScheduleWidget.status(getContext()));
        } catch (Exception e) {
            call.reject("刷新桌面组件失败：" + safeError(e));
        }
    }

    /** Use public system settings rather than private/nonportable OEM APIs.
     * App battery management or autostart must be allowed by the user. */
    @PluginMethod
    public void openWidgetSettings(PluginCall call) {
        String section = call.getString("section", "app");
        getActivity().runOnUiThread(() -> {
            try {
                Intent settings;
                if ("battery".equals(section)) {
                    settings = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                } else {
                    settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    settings.setData(Uri.parse("package:" + getContext().getPackageName()));
                }
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    getActivity().startActivity(settings);
                } catch (ActivityNotFoundException unavailable) {
                    Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
                    getActivity().startActivity(fallback);
                }
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("无法打开系统设置：" + safeError(e));
            }
        });
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


    /**
     * A verified calendar session needs no full-screen login WebView. Probe a
     * single day only once with bounded timeouts before opening the login UI.
     * Never treat the mere existence of JSESSIONID as proof of authorization.
     */
    @PluginMethod
    public void openOfficialCalendar(PluginCall call) {
        if (hasCalendarSessionCookie() && System.currentTimeMillis() < calendarVerifiedUntil) {
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
            return;
        }
        if (hasCalendarSessionCookie()) {
            calendarAuthIo.execute(() -> {
                if (verifyCalendarSessionQuickly()) {
                    vault().saveAfterVerification();
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    call.resolve(result);
                } else {
                    showOfficialCalendarDialog(call);
                }
            });
            return;
        }
        showOfficialCalendarDialog(call);
    }

    private void showOfficialCalendarDialog(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            // Never keep an invisible SSO WebView in parallel with the explicit
            // login page. Its redirects compete for the same cookies and network.
            Runnable cancelSilent = cancelSilentCalendarSso;
            if (cancelSilent != null) cancelSilent.run();
            // calendar.sjtu.edu.cn has an independent SSO session. The WebView
            // and native HTTP client use the SAME CookieManager.
            Dialog dialog = new Dialog(getActivity(), R.style.SJTUGlassDialog);
            AtomicBoolean settled = new AtomicBoolean(false);
            AtomicBoolean checking = new AtomicBoolean(false);
            Handler handler = new Handler(Looper.getMainLooper());
            LinearLayout panel = new LinearLayout(getActivity());
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setBackgroundResource(R.drawable.sjtu_glass_native_surface);
            LinearLayout header = new LinearLayout(getActivity());
            header.setGravity(android.view.Gravity.CENTER_VERTICAL);
            TextView title = new TextView(getActivity());
            title.setText("交大课表");
            title.setPadding(dp(12), 0, 0, 0);
            header.addView(title, new LinearLayout.LayoutParams(0, dp(54), 1));
            Button done = new Button(getActivity());
            done.setText("完成同步");
            header.addView(done);
            Button close = new Button(getActivity());
            close.setText("×");
            header.addView(close);
            panel.addView(header);
            WebView browser = new WebView(getActivity());
            browser.getSettings().setJavaScriptEnabled(true);
            browser.getSettings().setDomStorageEnabled(true);
            browser.getSettings().setUseWideViewPort(true);
            browser.getSettings().setSupportMultipleWindows(true);
            browser.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
            panel.addView(browser, new LinearLayout.LayoutParams(-1, 0, 1));

            Runnable verify = () -> {
                if (!dialog.isShowing() || settled.get()) return;
                if (!hasCalendarSessionCookie()) {
                    Toast.makeText(getContext(),
                        "仍缺少正式课表 JSESSIONID，请在网页完成登录或授权",
                        Toast.LENGTH_SHORT).show();
                    return;
                }
                if (!checking.compareAndSet(false, true)) return;
                calendarAuthIo.execute(() -> {
                    boolean valid = false;
                    try {
                        valid = verifyCalendarSessionQuickly();
                        if (valid) vault().saveAfterVerification();
                        // The JavaScript caller reloads the calendar on result.ok.
                        // Do NOT also emit calendarSessionReady and trigger a second,
                        // competing network refresh on the same connection.
                    } catch (Exception ignored) { }
                    final boolean success = valid;
                    handler.post(() -> {
                        checking.set(false);
                        if (!dialog.isShowing() || settled.get()) return;
                        if (success) {
                            if (settled.compareAndSet(false, true)) {
                                JSObject result = new JSObject();
                                result.put("ok", true);
                                call.resolve(result);
                            }
                            dialog.dismiss();
                        } else {
                            Toast.makeText(getContext(),
                                "正式课表接口仍未授权，请完成网页认证后重试",
                                Toast.LENGTH_LONG).show();
                        }
                    });
                });
            };

            AtomicBoolean calendarAutoClicked = new AtomicBoolean(false);
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                    if ("https".equalsIgnoreCase(req.getUrl().getScheme())) return false;
                    if (shouldLaunchLoginApp(req.getUrl(), view.getUrl(), req.hasGesture())) {
                        openLoginAppLink(req.getUrl(), browser);
                    }
                    return true;
                }
                @Override public void onPageFinished(WebView view, String url) {
                    if (isOfficialJaccountPage(url)) {
                        activateMobileMode(view);
                        for (long delay : new long[]{650, 1700}) {
                            handler.postDelayed(() -> {
                                if (dialog.isShowing() && !settled.get()) {
                                    clickOfficialJiaowoban(browser, calendarAutoClicked, false);
                                }
                            }, delay);
                        }
                    } else if (url.startsWith("https://calendar.sjtu.edu.cn/") &&
                               hasCalendarSessionCookie()) {
                        // Don't require an extra tap once the independent SSO succeeds.
                        handler.postDelayed(verify, 550);
                    }
                }
            });
            browser.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onCreateWindow(WebView view, boolean isDialog,
                    boolean isUserGesture, Message resultMsg) {
                    if (!isUserGesture && !isOfficialJaccountPage(browser.getUrl())) return false;
                    WebView popup = new WebView(getActivity());
                    popup.setWebViewClient(new WebViewClient() {
                        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                            Uri uri = req.getUrl();
                            if ("https".equalsIgnoreCase(uri.getScheme())) browser.loadUrl(uri.toString());
                            else if (shouldLaunchLoginApp(uri, browser.getUrl(), true)) {
                                openLoginAppLink(uri, browser);
                            }
                            return true;
                        }
                        @Override public void onPageStarted(WebView v, String url,
                                                              android.graphics.Bitmap favicon) {
                            if (url.startsWith("https://")) browser.loadUrl(url);
                            else if (shouldLaunchLoginApp(Uri.parse(url), browser.getUrl(), true)) {
                                openLoginAppLink(Uri.parse(url), browser);
                            }
                        }
                    });
                    panel.addView(popup, new LinearLayout.LayoutParams(1, 1));
                    WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                    transport.setWebView(popup);
                    resultMsg.sendToTarget();
                    return true;
                }
            });
            close.setOnClickListener(v -> dialog.dismiss());
            done.setOnClickListener(v -> verify.run());
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
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() |
                                              WindowInsetsCompat.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            dialog.setOnDismissListener(d -> {
                browser.stopLoading();
                browser.destroy();
                if (settled.compareAndSet(false, true)) {
                    JSObject result = new JSObject();
                    result.put("ok", false);
                    call.resolve(result);
                }
            });
            dialog.show();
            Window shown = dialog.getWindow();
            if (shown != null) shown.setLayout(-1, -1);
            browser.loadUrl("https://calendar.sjtu.edu.cn/login");
        });
    }

    /**
     * One short, read-only authenticated JSON request to verify the actual
     * timetable API; do not fetch an entire month on the login critical path.
     * No retries or credential logging. Redirects/HTML are not authorization.
     */
    private boolean verifyCalendarSessionQuickly() {
        if (!hasCalendarSessionCookie()) return false;
        if (System.currentTimeMillis() < calendarVerifiedUntil) return true;
        HttpURLConnection connection = null;
        try {
            java.text.SimpleDateFormat dateFormat =
                new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
            dateFormat.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
            Calendar next = new GregorianCalendar(TimeZone.getTimeZone("Asia/Shanghai"), Locale.ROOT);
            String from = dateFormat.format(new java.util.Date());
            next.add(Calendar.DAY_OF_MONTH, 1);
            String until = dateFormat.format(next.getTime());
            String endpoint = "https://calendar.sjtu.edu.cn/api/event/list?startDate=" +
                URLEncoder.encode(from + " 00:00", "UTF-8") + "&endDate=" +
                URLEncoder.encode(until + " 00:00", "UTF-8") + "&weekly=true&ids=";
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5500);
            connection.setReadTimeout(6500);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Referer", "https://calendar.sjtu.edu.cn/ui/calendar");
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            connection.setRequestProperty("Cookie", CookieManager.getInstance()
                .getCookie("https://calendar.sjtu.edu.cn/"));
            if (connection.getResponseCode() != 200) return false;
            String type = connection.getContentType();
            if (type != null && type.toLowerCase(Locale.ROOT).contains("text/html")) return false;
            JSONObject response;
            try (InputStream input = connection.getInputStream()) {
                response = new JSONObject(readString(input));
            }
            if (response.optJSONObject("data") == null) return false;
            calendarVerifiedUntil = System.currentTimeMillis() + 10 * 60_000L;
            return true;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * Mirrors desktop exam-service.ts. Exam auth is independent of Canvas and
     * official calendar SSO: failed auth is NOT interpreted as zero exams.
     */
    @PluginMethod
    public void exams(PluginCall call) {
        boolean force = Boolean.TRUE.equals(call.getBoolean("force", false));
        examIo.execute(() -> {
            try {
                vault().restoreOnce();
                JSObject result = examService.fetch(force);
                if (result.optBoolean("connected", false)) vault().saveAfterVerification();
                call.resolve(result);
            } catch (Exception error) {
                call.reject("考试信息获取失败：" + safeError(error));
            }
        });
    }


    /** Reuse an existing school jAccount session in a tiny, temporary WebView.
     * No credential form is filled or consent button is auto-approved. If
     * authentication requires interaction, the visible portal action remains.
     * The worker never blocks Canvas/official course data fetches. */
    @PluginMethod
    public void resumeExamSession(PluginCall call) {
        if (!silentExamConnecting.compareAndSet(false, true)) {
            JSObject reply = new JSObject();
            reply.put("connected", false);
            call.resolve(reply);
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                vault().restoreOnce();
                String schoolCookie = CookieManager.getInstance()
                    .getCookie("https://jaccount.sjtu.edu.cn/");
                if (schoolCookie == null || schoolCookie.trim().isEmpty() ||
                    System.currentTimeMillis() - lastSilentExamAttempt < 4 * 60_000L) {
                    silentExamConnecting.set(false);
                    JSObject reply = new JSObject();
                    reply.put("connected", false);
                    call.resolve(reply);
                    return;
                }
                lastSilentExamAttempt = System.currentTimeMillis();
                trySilentExamSite(call, 0);
            } catch (Exception error) {
                silentExamConnecting.set(false);
                JSObject reply = new JSObject();
                reply.put("connected", false);
                call.resolve(reply);
            }
        });
    }

    private void trySilentExamSite(PluginCall call, int index) {
        if (index >= 2) {
            silentExamConnecting.set(false);
            JSObject reply = new JSObject();
            reply.put("connected", false);
            call.resolve(reply);
            return;
        }
        String base = index == 0 ? "https://j.sjtu.edu.cn" : "https://i.sjtu.edu.cn";
        String url = index == 0 ? base + "/app/ui/index" : base + "/jaccountlogin";
        Handler handler = new Handler(Looper.getMainLooper());
        try {
            FrameLayout host = getActivity().findViewById(android.R.id.content);
            if (host == null) throw new Exception("WebView host unavailable");
            WebView browser = new WebView(getActivity());
            browser.getSettings().setJavaScriptEnabled(true);
            browser.getSettings().setDomStorageEnabled(true);
            browser.getSettings().setSupportMultipleWindows(false);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
            // Attached to the activity so the Android WebView renderer is
            // actually scheduled, but 1x1 / transparent and non-interactive.
            browser.setAlpha(0.01f);
            browser.setFocusable(false);
            browser.setClickable(false);
            host.addView(browser, new FrameLayout.LayoutParams(1, 1));
            AtomicBoolean finished = new AtomicBoolean(false);
            Runnable cleanup = () -> {
                try {
                    browser.stopLoading();
                    host.removeView(browser);
                    browser.destroy();
                } catch (Exception ignored) { }
            };
            final Runnable[] timeout = new Runnable[1];
            Runnable next = () -> {
                if (!finished.compareAndSet(false, true)) return;
                handler.removeCallbacks(timeout[0]);
                cleanup.run();
                trySilentExamSite(call, index + 1);
            };
            timeout[0] = next;
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !"https".equalsIgnoreCase(request.getUrl().getScheme());
                }
                @Override public void onPageFinished(WebView view, String loaded) {
                    if (loaded == null || !loaded.startsWith(base + "/")) return;
                    if (loaded.contains("/login") || loaded.contains("oauth")) return;
                    handler.postDelayed(() -> {
                        if (!finished.compareAndSet(false, true)) return;
                        handler.removeCallbacks(timeout[0]);
                        cleanup.run();
                        examIo.execute(() -> {
                            try {
                                examService.invalidate();
                                JSObject exams = examService.fetch(true);
                                if (exams.optBoolean("connected", false)) {
                                    silentExamConnecting.set(false);
                                    JSObject reply = new JSObject();
                                    reply.put("connected", true);
                                    reply.put("source", exams.optString("source", ""));
                                    vault().saveAfterVerification();
                                    call.resolve(reply);
                                } else {
                                    getActivity().runOnUiThread(() ->
                                        trySilentExamSite(call, index + 1));
                                }
                            } catch (Exception error) {
                                getActivity().runOnUiThread(() ->
                                    trySilentExamSite(call, index + 1));
                            }
                        });
                    }, 850);
                }
            });
            handler.postDelayed(timeout[0], 9000);
            browser.loadUrl(url);
        } catch (Exception error) {
            trySilentExamSite(call, index + 1);
        }
    }

    /** A user-initiated SSO flow for the separate StudyAtSJTU/registrar portal.
     * It uses the same Android WebView CookieManager as the native exam API.
     * No jAccount credentials are collected or stored by this plugin.
     */
    @PluginMethod
    public void openExamPortal(PluginCall call) {
        String source = call.getString("source", "study");
        boolean registrar = "jiaowu".equals(source);
        String base = registrar ? "https://i.sjtu.edu.cn" : "https://j.sjtu.edu.cn";
        String url = registrar ? base + "/jaccountlogin" : base + "/app/ui/index";
        getActivity().runOnUiThread(() -> {
            Dialog dialog = new Dialog(getActivity(), R.style.SJTUGlassDialog);
            LinearLayout panel = new LinearLayout(getActivity());
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setBackgroundResource(R.drawable.sjtu_glass_native_surface);
            LinearLayout toolbar = new LinearLayout(getActivity());
            toolbar.setGravity(Gravity.CENTER_VERTICAL);
            TextView title = new TextView(getActivity());
            title.setText(registrar ? "教务考试安排" : "学在交大考试");
            title.setPadding(dp(12),0,0,0);
            toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(52), 1));
            TextView done = glassAction("完成连接",true);
            toolbar.addView(done);
            TextView close = glassAction("×", false);
            toolbar.addView(close);
            panel.addView(toolbar);
            WebView browser = new WebView(getActivity());
            browser.getSettings().setJavaScriptEnabled(true);
            browser.getSettings().setDomStorageEnabled(true);
            browser.getSettings().setSupportMultipleWindows(true);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
            panel.addView(browser, new LinearLayout.LayoutParams(-1,0,1));
            AtomicBoolean finished = new AtomicBoolean(false);
            AtomicBoolean verifying = new AtomicBoolean(false);
            Handler handler = new Handler(Looper.getMainLooper());
            Runnable verify = () -> {
                if (finished.get() || !dialog.isShowing()) return;
                if (!verifying.compareAndSet(false,true)) return;
                examIo.execute(() -> {
                    boolean good = false;
                    try {
                        examService.invalidate();
                        JSObject data = examService.fetch(true);
                        good = data.optBoolean("connected", false);
                        if (good) vault().saveAfterVerification();
                    } catch (Exception ignored) {}
                    final boolean ok = good;
                    handler.post(() -> {
                        verifying.set(false);
                        if (!dialog.isShowing() || finished.get()) return;
                        if (ok) {
                            if (finished.compareAndSet(false,true)) {
                                JSObject result = new JSObject();
                                result.put("ok",true);
                                call.resolve(result);
                            }
                            dialog.dismiss();
                        } else {
                            Toast.makeText(getContext(),
                                "考试服务尚未完成授权，请在页面中登录后重试",
                                Toast.LENGTH_LONG).show();
                        }
                    });
                });
            };
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if ("https".equalsIgnoreCase(request.getUrl().getScheme())) return false;
                    if (shouldLaunchLoginApp(request.getUrl(),view.getUrl(),request.hasGesture()))
                        openLoginAppLink(request.getUrl(), browser);
                    return true;
                }
                @Override public void onPageFinished(WebView view,String loaded) {
                    if (isOfficialJaccountPage(loaded)) activateMobileMode(view);
                    else if (loaded != null && loaded.startsWith(base + "/")) {
                        handler.postDelayed(verify,500);
                    }
                }
            });
            browser.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onCreateWindow(WebView view, boolean isDialog,
                        boolean isUserGesture, Message resultMsg) {
                    if (!isUserGesture && !isOfficialJaccountPage(browser.getUrl())) return false;
                    WebView popup = new WebView(getActivity());
                    popup.setWebViewClient(new WebViewClient() {
                        @Override public boolean shouldOverrideUrlLoading(WebView view,
                                WebResourceRequest request) {
                            Uri uri=request.getUrl();
                            if ("https".equalsIgnoreCase(uri.getScheme())) {
                                browser.loadUrl(uri.toString());
                            } else if (shouldLaunchLoginApp(uri,browser.getUrl(),true)) {
                                openLoginAppLink(uri,browser);
                            }
                            return true;
                        }
                        @Override public void onPageStarted(WebView view,String url,
                                android.graphics.Bitmap favicon) {
                            if (url.startsWith("https://"))browser.loadUrl(url);
                        }
                    });
                    panel.addView(popup,new LinearLayout.LayoutParams(1,1));
                    WebView.WebViewTransport transport=(WebView.WebViewTransport)resultMsg.obj;
                    transport.setWebView(popup);
                    resultMsg.sendToTarget();
                    return true;
                }
            });
            done.setOnClickListener(view -> verify.run());
            close.setOnClickListener(view -> dialog.dismiss());
            dialog.setContentView(panel);
            ViewCompat.setOnApplyWindowInsetsListener(panel, (view,insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() |
                    WindowInsetsCompat.Type.displayCutout());
                view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
                return insets;
            });
            dialog.setOnDismissListener(ignored -> {
                browser.stopLoading();
                browser.destroy();
                if (finished.compareAndSet(false,true)) {
                    JSObject result = new JSObject();
                    result.put("ok",false);
                    call.resolve(result);
                }
            });
            dialog.show();
            Window window = dialog.getWindow();
            if (window != null) window.setLayout(-1,-1);
            browser.loadUrl(url);
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
            result.put("location", item.optString("location", ""));
            String eventId = item.optString("eventId", "");
            boolean activity = eventId.startsWith("ACTIVITY") || item.optBoolean("claimIcon", false)
                || (item.has("recurrence") && item.optInt("recurrence", -1) == 0);
            result.put("type", activity ? "event" : "course");
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


    // Short-lived in-memory course context cache; the course page already fetches
    // this data. Avoid repeating course pagination on every day/week tap.
    private volatile long courseContextExpiresAt = 0L;
    private volatile java.util.List<String> courseContextCache = new java.util.ArrayList<>();
    private final Object courseContextLock = new Object();
    private final ExecutorService calendarIo = Executors.newFixedThreadPool(4);

    private java.util.List<String> getCalendarCourseIds() throws Exception {
        if (System.currentTimeMillis() < courseContextExpiresAt)
            return new java.util.ArrayList<>(courseContextCache);
        synchronized (courseContextLock) {
            if (System.currentTimeMillis() < courseContextExpiresAt)
                return new java.util.ArrayList<>(courseContextCache);
            JSONArray source = getAllPages(BASE +
                "/api/v1/courses?per_page=100&enrollment_state%5B%5D=active&enrollment_state%5B%5D=completed");
            java.util.ArrayList<String> ids = new java.util.ArrayList<>();
            for (int i=0; i<source.length(); i++) {
                JSONObject item=source.optJSONObject(i);
                if (item==null) continue;
                String id=item.optString("id", "");
                if (id.matches("[0-9]{1,20}")) ids.add(id);
            }
            courseContextCache = ids;
            courseContextExpiresAt = System.currentTimeMillis() + 10*60*1000L;
            return new java.util.ArrayList<>(ids);
        }
    }

    private static String nextWeekDay(String start) throws Exception {
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
        format.setLenient(false);
        Calendar calendar = new GregorianCalendar(TimeZone.getTimeZone("Asia/Shanghai"), Locale.ROOT);
        calendar.setTime(format.parse(start));
        calendar.add(Calendar.DAY_OF_MONTH, 7);
        return format.format(calendar.getTime());
    }

    private JSArray officialCalendarRange(String begin, String end) throws Exception {
        String url = "https://calendar.sjtu.edu.cn/api/event/list?startDate=" +
            URLEncoder.encode(begin + " 00:00", "UTF-8") + "&endDate=" +
            URLEncoder.encode(end + " 00:00", "UTF-8") + "&weekly=true&ids=";
        JSONObject data=getObject(url).optJSONObject("data");
        if (data == null) throw new Exception("正式课表尚未授权");
        JSONArray raw=data.optJSONArray("events");
        JSArray result=new JSArray();
        if (raw == null) return result;
        for(int i=0;i<raw.length();i++){
            JSONObject item=raw.optJSONObject(i);
            if(item==null)continue;
            String time=item.optString("startTime", "");
            if(time.isEmpty() || time.compareTo(begin)<0 || time.compareTo(end)>=0)continue;
            String id=item.optString("eventId", String.valueOf(i));
            JSObject entry=new JSObject();
            entry.put("id","official:"+id);
            entry.put("title",item.optString("title","课程"));
            entry.put("startTime",withShanghaiZone(time));
            entry.put("endTime",withShanghaiZone(item.optString("endTime",time)));
            entry.put("courseName",item.optString("location",""));
            entry.put("location",item.optString("location",""));
            boolean activity=id.startsWith("ACTIVITY") || item.optBoolean("claimIcon",false)
                || (item.has("recurrence")&&item.optInt("recurrence",-1)==0);
            entry.put("type",activity?"event":"course");
            result.put(entry);
        }
        return result;
    }

    /** Canvas timestamps are often UTC, while the schedule is Asia/Shanghai.
     * Comparing the raw ISO text with yyyy-MM-dd loses events near midnight,
     * particularly late-night deadlines on Sunday and 23:59 deadlines.
     * Normalize to the calendar's actual local day before week filtering. */
    private static String shanghaiDayFromApi(String value) {
        if (value == null || value.trim().isEmpty()) return "";
        String time = value.trim();
        if (time.matches("20[0-9]{2}-[0-9]{2}-[0-9]{2}")) return time;
        String[] formats = {
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mmXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd'T'HH:mmX",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm"
        };
        for (String pattern : formats) {
            try {
                java.text.SimpleDateFormat parser =
                    new java.text.SimpleDateFormat(pattern,Locale.ROOT);
                parser.setLenient(false);
                parser.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
                java.text.ParsePosition position = new java.text.ParsePosition(0);
                java.util.Date parsed = parser.parse(time,position);
                if(parsed==null || position.getIndex()!=time.length())continue;
                java.text.SimpleDateFormat local =
                    new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.ROOT);
                local.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
                return local.format(parsed);
            } catch(Exception ignored) { }
        }
        return time.length()>=10 ? time.substring(0,10) : "";
    }

    private static void addCanvasEvent(java.util.Map<String,JSObject> output,
                                        JSONObject item,String type,String courseName) {
        JSONObject assignment=item.optJSONObject("assignment");
        String date=item.optString("start_at", "");
        if ("assignment".equals(type)) {
            date=item.optString("due_at",date);
            if(assignment!=null)date=assignment.optString("due_at",date);
        }
        if(date.isEmpty())date=item.optString("due_at","");
        if(date.isEmpty())return;
        String title=item.optString("title","");
        if(title.isEmpty()&&assignment!=null)title=assignment.optString("name","");
        if(title.isEmpty())title=item.optString("name","未命名日程");
        String id=type+":"+(assignment==null?"":assignment.optString("id","")+":")
            +item.optString("id",title+date);
        JSObject entry=new JSObject();
        entry.put("id",id);
        entry.put("title",title);
        entry.put("startTime",date);
        entry.put("endTime",item.optString("end_at",date));
        entry.put("courseName",courseName.isEmpty()?item.optString("context_name",""):courseName);
        entry.put("location",item.optString("location_name",item.optString("location","")));
        entry.put("type",type);
        output.put(id,entry);
    }

    @PluginMethod
    public void calendarWeek(PluginCall call) {
        String begin=call.getString("weekStart","");
        if(!begin.matches("20[0-9]{2}-(0[1-9]|1[0-2])-[0-3][0-9]")){
            call.reject("周起始日期不合法");return;
        }
        io.execute(() -> {
            try {
                String end=nextWeekDay(begin);
                // Execute the two independent origins simultaneously. A missing
                // official SSO does not block Canvas assignments.
                java.util.concurrent.Future<JSArray> officialFuture=calendarIo.submit(
                    () -> officialCalendarRange(begin,end));
                java.util.concurrent.Future<java.util.List<String>> idsFuture=calendarIo.submit(
                    () -> getCalendarCourseIds());
                java.util.LinkedHashMap<String,JSObject> canvasItems=new java.util.LinkedHashMap<>();
                boolean calendarDenied=false;
                java.util.List<String> ids=new java.util.ArrayList<>();
                try { ids=idsFuture.get(); }
                catch(Exception ignored) {calendarDenied=true;}
                if(!ids.isEmpty()){
                    // All context codes included, but at most 2 requests per ~20
                    // courses rather than per-course assignment calls.
                    weekQueries:
                    for(int offset=0;offset<ids.size();offset+=20){
                        StringBuilder contexts=new StringBuilder();
                        for(int i=offset;i<Math.min(ids.size(),offset+20);i++)
                            contexts.append("&context_codes%5B%5D=course_").append(ids.get(i));
                        for(String type:new String[]{"assignment","event"}){
                            try{
                                JSONArray results=getAllPages(BASE+
                                    "/api/v1/calendar_events?per_page=100&type="+type+
                                    "&start_date="+begin+"&end_date="+end+contexts);
                                for(int i=0;i<results.length();i++){
                                    JSONObject item=results.optJSONObject(i);
                                    if(item!=null)addCanvasEvent(canvasItems,item,type,"");
                                }
                            }catch(Exception e){
                                calendarDenied=true;
                                if(safeError(e).contains("401") || safeError(e).contains("403"))break weekQueries;
                            }
                        }
                    }
                }
                // On a restricted calendar endpoint, show a fast upcoming list now.
                // Per-course assignment fallback is explicitly separated and
                // loaded progressively, never blocking the weekly view.
                if(calendarDenied){
                    try {
                        JSONArray upcoming=getAllPages(BASE+
                            "/api/v1/users/self/upcoming_events?per_page=100");
                        for(int i=0;i<upcoming.length();i++){
                            JSONObject item=upcoming.optJSONObject(i);
                            if(item==null)continue;
                            JSONObject assignment=item.optJSONObject("assignment");
                            String dt=item.optString("start_at",item.optString("due_at",""));
                            if(dt.isEmpty()&&assignment!=null)dt=assignment.optString("due_at","");
                            String localDate=shanghaiDayFromApi(dt);
                            if(localDate.compareTo(begin)<0 || localDate.compareTo(end)>=0)continue;
                            addCanvasEvent(canvasItems,item,assignment==null?"event":"assignment","");
                        }
                    }catch(Exception ignored){}
                }
                JSArray official=new JSArray();
                boolean officialOk=false;
                try{
                    // A bounded wait: the official source is allowed to be down
                    // without freezing the entire calendar.
                    official=officialFuture.get(3500,java.util.concurrent.TimeUnit.MILLISECONDS);
                    officialOk=true;
                    calendarVerifiedUntil = System.currentTimeMillis() + 10 * 60_000L;
                }catch(Exception ignored){officialFuture.cancel(true);}
                JSArray combined=new JSArray();
                for(int i=0;i<official.length();i++)combined.put(official.get(i));
                for(JSObject event:canvasItems.values())combined.put(event);
                JSObject result=new JSObject();
                result.put("items",combined);
                result.put("officialConnected",officialOk);
                result.put("authRequired",false);
                // Canvas calendar_events may omit due_at even with HTTP 200.
                // Supplement via each authorized course's assignments endpoint
                // in the background, including when the calendar API succeeded.
                result.put("needsSupplement",!ids.isEmpty());
                if(!officialOk && !calendarDenied)result.put("warning","正式课表未授权，可连接交大课表。");
                if(calendarDenied)result.put("warning","部分 Canvas 日历受限，正在补充课程作业。");
                call.resolve(result);
            }catch(Exception e){call.reject(safeError(e));}
        });
    }

    @PluginMethod
    public void calendarWeekSupplement(PluginCall call) {
        String begin=call.getString("weekStart","");
        if(!begin.matches("20[0-9]{2}-(0[1-9]|1[0-2])-[0-3][0-9]")){
            call.reject("周起始日期不合法");return;
        }
        io.execute(() -> {
            try {
                String end=nextWeekDay(begin);
                java.util.List<String> ids=getCalendarCourseIds();
                java.util.List<java.util.concurrent.Future<java.util.List<JSObject>>> futures=
                    new java.util.ArrayList<>();
                // Bounded concurrency prevents a restricted Canvas endpoint from
                // turning the primary calendar load into dozens of serial GETs.
                for(String id:ids){
                    futures.add(calendarIo.submit(() -> {
                        java.util.List<JSObject> list=new java.util.ArrayList<>();
                        try{
                            JSONArray raw=getAllPages(BASE+"/api/v1/courses/"+id+
                                "/assignments?per_page=100&order_by=due_at");
                            for(int i=0;i<raw.length();i++){
                                JSONObject a=raw.optJSONObject(i);
                                if(a==null)continue;
                                String due=a.optString("due_at","");
                                String localDue=shanghaiDayFromApi(due);
                                if(localDue.compareTo(begin)<0 || localDue.compareTo(end)>=0)continue;
                                JSObject entry=new JSObject();
                                entry.put("id","assignment:"+id+":"+a.optString("id",String.valueOf(i)));
                                entry.put("title",a.optString("name","作业截止"));
                                entry.put("startTime",due);
                                entry.put("endTime",due);
                                entry.put("courseName","");
                                entry.put("type","assignment");
                                list.add(entry);
                            }
                        }catch(Exception ignored){}
                        return list;
                    }));
                }
                JSArray events=new JSArray();
                for(java.util.concurrent.Future<java.util.List<JSObject>> future:futures){
                    try{
                        for(JSObject event:future.get(10,java.util.concurrent.TimeUnit.SECONDS))
                            events.put(event);
                    }catch(Exception ignored){future.cancel(true);}
                }
                JSObject result=new JSObject();
                result.put("items",events);
                call.resolve(result);
            }catch(Exception e){call.reject(safeError(e));}
        });
    }

    @PluginMethod
    public void calendar(PluginCall call) {
        String month = call.getString("month", "");
        if (!month.matches("20[0-9]{2}-(0[1-9]|1[0-2])")) { call.reject("月份格式不合法"); return; }
        io.execute(() -> {
            try {
                JSArray official = new JSArray();
                String officialWarning = "";
                boolean officialConnected = false;
                try {
                    official = officialCalendarEvents(month);
                    officialConnected = true;
                }
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
                    result.put("officialConnected", officialConnected);
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
                result.put("officialConnected", officialConnected);
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
            vault().restoreOnce();
            result.put("savedSessionEncrypted", vault().hasSavedSession());
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
                vault().saveAfterVerification();
                // Existing Canvas login: refresh the other service independently.
                if (!hasCalendarSessionCookie()) startSilentCalendarSso();
                JSObject result = new JSObject();
                result.put("loggedIn", true);
                result.put("name", profile.optString("name", ""));
                result.put("savedSessionEncrypted", vault().hasSavedSession());
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
                java.util.ArrayList<String> freshIds = new java.util.ArrayList<>();
                for (int n=0;n<items.length();n++) {
                    String id=items.getJSONObject(n).optString("id","");
                    if (id.matches("[0-9]{1,20}"))freshIds.add(id);
                }
                courseContextCache=freshIds;
                courseContextExpiresAt=System.currentTimeMillis()+10*60*1000L;
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
                File staging = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (staging == null) throw new Exception("手机存储不可用");
                File root = new File(staging, "SJTU Downloader");
                String publicFolder = "";
                // Preserve desktop-style folder organization, never trust raw path fragments.
                String term = call.getString("term", "");
                String courseName = call.getString("courseName", "");
                if (!term.trim().isEmpty()) {
                    String safeTerm = cleanName(term);
                    root = new File(root, safeTerm);
                    publicFolder += safeTerm + "/";
                }
                if (!courseName.trim().isEmpty()) {
                    String safeCourse = cleanName(courseName);
                    root = new File(root, safeCourse);
                    publicFolder += safeCourse + "/";
                }
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
                final JSObject result;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android 10+: publish through MediaStore, so the file is
                    // visible in the phone's normal Downloads folder, including
                    // Files by Google, OEM Files apps, and USB MTP.
                    result = publishPublicDownload(temp, name, publicFolder);
                    temp.delete();
                } else {
                    // Legacy fallback remains app-private (no unsafe broad storage
                    // permission); make this limitation explicit in the UI.
                    if (!temp.renameTo(target)) throw new Exception("保存文件失败");
                    result = new JSObject();
                    result.put("uri", target.toURI().toString());
                    result.put("fileName", target.getName());
                    result.put("savedPath", "Android/data/" + getContext().getPackageName()
                        + "/files/Download/SJTU Downloader/" + publicFolder + target.getName());
                    result.put("publicDownload", false);
                }
                progress(taskId, name, bytes, total);
                call.resolve(result);
            } catch (Exception e) {
                if (temp != null) temp.delete();
                call.reject(safeError(e));
            } finally { cancels.remove(taskId); }
        });
    }

    /** Atomically expose completed files in Android's public Download collection. */
    private JSObject publishPublicDownload(File source, String name, String subfolders) throws Exception {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new IOException("需要 Android 10 以上系统");
        String safeFolder = Environment.DIRECTORY_DOWNLOADS + "/SJTU Downloader/" + subfolders;
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues data = new ContentValues();
        String mime = URLConnection.guessContentTypeFromName(name);
        data.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        data.put(MediaStore.MediaColumns.MIME_TYPE,
            mime == null || mime.trim().isEmpty() ? "application/octet-stream" : mime);
        data.put(MediaStore.MediaColumns.RELATIVE_PATH, safeFolder);
        data.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri published = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, data);
        if (published == null) throw new IOException("系统下载目录创建文件失败");
        boolean finished = false;
        try {
            try (InputStream input = new FileInputStream(source);
                 OutputStream output = resolver.openOutputStream(published, "w")) {
                if (output == null) throw new IOException("无法写入系统下载目录");
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                output.flush();
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(published, ready, null, null) != 1) {
                throw new IOException("下载文件发布失败");
            }
            finished = true;
            String finalName = name;
            try (Cursor cursor = resolver.query(published,
                    new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                    finalName = cursor.getString(0);
                }
            } catch (Exception ignored) { /* The original filename remains valid. */ }
            JSObject result = new JSObject();
            result.put("uri", published.toString());
            result.put("fileName", finalName);
            result.put("savedPath", "下载/SJTU Downloader/" + subfolders + finalName);
            result.put("publicDownload", true);
            return result;
        } finally {
            if (!finished) resolver.delete(published, null, null);
        }
    }

    @PluginMethod
    public void openDownloadedFile(PluginCall call) {
        String value = call.getString("uri", "");
        if (!value.startsWith("content://media/")) {
            call.reject("只能打开本应用保存到系统下载目录的文件");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Uri target = Uri.parse(value);
                String mime = getContext().getContentResolver().getType(target);
                if (mime == null) mime = "application/octet-stream";
                Intent view = new Intent(Intent.ACTION_VIEW);
                view.setDataAndType(target, mime);
                view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(view, "打开已下载文件"));
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("找不到可以打开此文件的应用：" + safeError(e));
            }
        });
    }

    /** Move downloads produced by older beta releases out of Android/data.
        Imported items become visible in the phone's public Downloads folder. */
    @PluginMethod
    public void exportLegacyDownloads(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("此功能需要 Android 10 或更新系统");
            return;
        }
        io.execute(() -> {
            try {
                File staging = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                File oldRoot = staging == null ? null : new File(staging, "SJTU Downloader");
                int count = 0;
                int skipped = 0;
                if (oldRoot != null && oldRoot.isDirectory()) {
                    String prefix = oldRoot.getCanonicalPath() + File.separator;
                    java.util.ArrayDeque<File> pending = new java.util.ArrayDeque<>();
                    pending.add(oldRoot);
                    while (!pending.isEmpty()) {
                        File dir = pending.removeFirst();
                        File[] children = dir.listFiles();
                        if (children == null) continue;
                        for (File child : children) {
                            if (!child.getCanonicalPath().startsWith(prefix)) continue;
                            if (child.isDirectory()) {
                                pending.addLast(child);
                            } else if (child.isFile() && !child.getName().endsWith(".part")) {
                                String sub = dir.getCanonicalPath().substring(prefix.length())
                                    .replace(File.separatorChar, '/');
                                if (!sub.isEmpty()) sub += "/";
                                try {
                                    publishPublicDownload(child, child.getName(), sub);
                                    if (child.delete()) count++;
                                    else skipped++;
                                } catch (Exception e) { skipped++; }
                            }
                        }
                    }
                }
                JSObject result = new JSObject();
                result.put("count", count);
                result.put("skipped", skipped);
                result.put("savedPath", "下载/SJTU Downloader/");
                call.resolve(result);
            } catch (Exception e) { call.reject(safeError(e)); }
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
        courseContextExpiresAt=0L;
        courseContextCache=new java.util.ArrayList<>();
        examService.invalidate();

        io.execute(() -> {
            vault().clearSavedSession();
            getActivity().runOnUiThread(() -> {
                CookieManager.getInstance().removeAllCookies(removed -> {
                    CookieManager.getInstance().flush();
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    call.resolve(result);
                });
            });
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
        // The first authenticated request after process restart restores encrypted
        // session cookies before reading CookieManager for network headers.
        vault().restoreOnce();
        URL url = new URL(value);
        for (int i = 0; i < 8; i++) {
            if (!"https".equalsIgnoreCase(url.getProtocol())) throw new Exception("禁止非 HTTPS 请求");
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "SJTU Downloader Android/0.1");
            c.setRequestProperty("Accept", "application/json, */*");
            // A new request must not reuse an old VPN / campus-network TCP socket.
            c.setUseCaches(false);
            c.setRequestProperty("Connection", "close");
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

    private static final int API_MAX_ATTEMPTS = 3;

    /** Only retry idempotent JSON GET operations, never uploads or file-writing tasks. */
    private static boolean transientIOException(IOException e) {
        if (e instanceof SSLException || e instanceof UnknownHostException) return false;
        return e instanceof SocketException
            || e instanceof SocketTimeoutException
            || e instanceof ConnectException
            || e instanceof EOFException
            || e instanceof java.io.InterruptedIOException;
    }

    private static boolean transientHttpStatus(int code) {
        return code == 429 || code == 500 || code == 502 || code == 503 || code == 504;
    }

    private static void pauseApiRetry(int attempt) throws InterruptedException {
        // Short bounded exponential backoff: 600ms, 1200ms. Respect interruption.
        Thread.sleep(600L * (1L << attempt));
    }

    private static String canvasApiFailure(int code, String host) {
        String service = "calendar.sjtu.edu.cn".equalsIgnoreCase(host) ? "正式课表" : "Canvas";
        if (code == 401) return service + " 登录已失效（401），请重新认证";
        if (code == 403) return service + " 没有此资源的访问权限（403）";
        if (code == 404) return "此资源不存在或已被移除（404）";
        if (code == 429) return service + " 请求过于频繁（429），请稍后再试";
        if (code >= 500) return service + " 服务暂时不可用（" + code + "），请稍后重试";
        return service + " 请求失败（HTTP " + code + "）";
    }

    private static final class JsonReply {
        final String body;
        final String link;
        JsonReply(String body, String link) { this.body = body; this.link = link; }
    }

    /**
     * GET a Canvas/Calendar JSON page. Retries socket aborts (ECONNABORTED),
     * timeouts and temporary server errors with NEW connections. Never retries
     * auth errors (401/403), TLS certificate errors or malformed JSON.
     * No signed download URLs or credentials are exposed to the UI/log.
     */
    private JsonReply getJsonPage(String url, String referer) throws Exception {
        for (int attempt = 0; attempt < API_MAX_ATTEMPTS; attempt++) {
            HttpURLConnection c = null;
            try {
                c = connect(url, referer);
                int code = c.getResponseCode();
                if (code == 200) {
                    String type = c.getContentType();
                    if (type != null && type.toLowerCase(Locale.ROOT).contains("text/html")) {
                        throw new Exception("服务器返回登录网页而不是数据，请重新登录后再试");
                    }
                    String text;
                    try (InputStream in = c.getInputStream()) { text = readString(in); }
                    return new JsonReply(text, c.getHeaderField("Link"));
                }
                String message = canvasApiFailure(code, c.getURL().getHost());
                if (transientHttpStatus(code) && attempt < API_MAX_ATTEMPTS - 1) {
                    // A new connection is opened on every attempt.
                    c.disconnect();
                    c = null;
                    pauseApiRetry(attempt);
                    continue;
                }
                throw new Exception(message);
            } catch (IOException e) {
                if (!transientIOException(e)) {
                    if (e instanceof UnknownHostException) {
                        throw new Exception("无法解析学校服务器地址，请检查校园网或 VPN 连接");
                    }
                    if (e instanceof SSLException) {
                        throw new Exception("安全连接校验失败，请检查系统时间与网络证书");
                    }
                    throw e;
                }
                if (attempt < API_MAX_ATTEMPTS - 1) {
                    if (c != null) { c.disconnect(); c = null; }
                    pauseApiRetry(attempt);
                    continue;
                }
                throw new Exception("网络连接被中断，已自动重试 3 次。请检查校园网或 VPN，然后点击重试");
            } finally {
                if (c != null) c.disconnect();
            }
        }
        throw new Exception("网络请求未完成，请重试");
    }

    private JSONObject getObject(String url) throws Exception {
        String referer = url.startsWith("https://calendar.sjtu.edu.cn/")
            ? "https://calendar.sjtu.edu.cn/ui/calendar" : BASE;
        return new JSONObject(getJsonPage(url, referer).body);
    }

    private JSONArray getAllPages(String firstUrl) throws Exception {
        JSONArray combined = new JSONArray();
        String next = firstUrl;
        for (int page = 0; next != null && page < 100; page++) {
            if (!next.startsWith(BASE + "/api/v1/")) {
                throw new Exception("Canvas 翻页地址不合法");
            }
            JsonReply reply = getJsonPage(next, BASE);
            JSONArray batch = new JSONArray(reply.body);
            for (int i = 0; i < batch.length(); i++) combined.put(batch.get(i));
            next = null;
            if (reply.link != null) {
                for (String part : reply.link.split(",")) {
                    if (part.contains("rel=\"next\"")) {
                        int a = part.indexOf('<'), b = part.indexOf('>', a + 1);
                        if (a >= 0 && b > a) next = part.substring(a + 1, b);
                    }
                }
            }
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
