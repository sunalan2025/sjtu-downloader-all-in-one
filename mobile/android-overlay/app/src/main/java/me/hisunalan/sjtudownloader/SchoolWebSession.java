package me.hisunalan.sjtudownloader;

import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

/** One school jAccount WebView profile across Canvas, exams and calendar.
 * Each origin still receives its own SSO cookie; never copy Canvas cookies
 * into the registrar domain or store passwords in app preferences.
 */
final class SchoolWebSession {
    private SchoolWebSession(){}

    static void configure(WebView browser) {
        WebSettings settings=browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUserAgentString(
            "Mozilla/5.0 (Linux; Android "+android.os.Build.VERSION.RELEASE+
            "; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) "+
            "Chrome/131.0.0.0 Mobile Safari/537.36");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser,true);
    }

    static void flush(){CookieManager.getInstance().flush();}

    static String cookie(String url) {
        String jar=CookieManager.getInstance().getCookie(url);
        return jar==null?"":jar.trim();
    }
}
