package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.webkit.CookieManager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Uses a synthetic session cookie, never any real SJTU credentials. */
@RunWith(AndroidJUnit4.class)
public class SessionCookieVaultTest {
    private static final String URL = "https://calendar.sjtu.edu.cn/";

    @Test
    public void encryptedSessionSurvivesVaultRecreationAndLogoutClearsIt() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        CookieManager manager = CookieManager.getInstance();
        String token = "sjtu_test_" + System.nanoTime();
        SessionCookieVault first = new SessionCookieVault(context);
        try {
            manager.setCookie(URL, "JSESSIONID=" + token + "; Path=/; Secure; HttpOnly");
            manager.flush();
            assertTrue("Synthetic cookie must exist before capture",
                hasSession(manager, token));

            first.saveAfterVerification();
            String sealed = context.getSharedPreferences(
                "sjtu_android_session_v1", Context.MODE_PRIVATE)
                .getString("sealed_session", "");
            assertFalse("Encrypted session must be stored", sealed.isEmpty());
            assertFalse("Secret must not be stored in plaintext", sealed.contains(token));

            manager.setCookie(URL, "JSESSIONID=; Path=/; Max-Age=0; Secure; HttpOnly");
            manager.flush();
            assertFalse("Cookie should be absent before restore", hasSession(manager, token));

            // New vault object simulates app process recreation reading encrypted prefs.
            SessionCookieVault reopened = new SessionCookieVault(context);
            reopened.restoreOnce();
            assertTrue("Session cookie should be restored after restart",
                hasSession(manager, token));

            reopened.clearSavedSession();
            manager.setCookie(URL, "JSESSIONID=; Path=/; Max-Age=0; Secure; HttpOnly");
            manager.flush();
            new SessionCookieVault(context).restoreOnce();
            assertFalse("Explicit logout must not restore old session",
                hasSession(manager, token));
        } finally {
            first.clearSavedSession();
            manager.setCookie(URL, "JSESSIONID=; Path=/; Max-Age=0; Secure; HttpOnly");
            manager.flush();
        }
    }

    /** A Canvas-only test does not catch exam-site /app cookies or CAS TGC. */
    @Test
    public void examPathAndCentralSsoCookiesSurviveProcessRecreation() {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        CookieManager manager=CookieManager.getInstance();
        String exam="test_exam_"+System.nanoTime();
        String cas="test_cas_"+System.nanoTime();
        String examUrl="https://j.sjtu.edu.cn/app/stu/exam/semester/list";
        String casUrl="https://jaccount.sjtu.edu.cn/";
        SessionCookieVault vault=new SessionCookieVault(context);
        try {
            manager.setCookie(examUrl,"SESSION="+exam+"; Path=/app; Secure; HttpOnly");
            manager.setCookie(casUrl,"CASTGC="+cas+"; Path=/; Secure; HttpOnly");
            manager.flush();
            assertTrue(manager.getCookie(examUrl).contains("SESSION="+exam));
            assertFalse("The site root is NOT where exam session cookies live",
                String.valueOf(manager.getCookie("https://j.sjtu.edu.cn/"))
                    .contains("SESSION="+exam));
            vault.saveAfterVerification();
            String sealed=context.getSharedPreferences(
                "sjtu_android_session_v1",Context.MODE_PRIVATE)
                .getString("sealed_session","");
            assertFalse(sealed.contains(exam));
            assertFalse(sealed.contains(cas));

            manager.setCookie(examUrl,"SESSION=; Max-Age=0; Path=/app; Secure; HttpOnly");
            manager.setCookie(casUrl,"CASTGC=; Max-Age=0; Path=/; Secure; HttpOnly");
            manager.flush();
            new SessionCookieVault(context).restoreOnce();
            assertTrue("Path-scoped study exam session must recover",
                manager.getCookie(examUrl).contains("SESSION="+exam));
            assertTrue("CAS SSO login ticket must recover",
                manager.getCookie(casUrl).contains("CASTGC="+cas));
        } finally {
            vault.clearSavedSession();
            manager.setCookie(examUrl,"SESSION=; Max-Age=0; Path=/app; Secure; HttpOnly");
            manager.setCookie(casUrl,"CASTGC=; Max-Age=0; Path=/; Secure; HttpOnly");
            manager.flush();
        }
    }

    @Test
    public void pathScopedJAccountTicketRestoresWithoutTouchingPasswords() {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        CookieManager manager=CookieManager.getInstance();
        String token="ja_test_"+System.nanoTime();
        String url="https://jaccount.sjtu.edu.cn/jaccount/jalogin";
        SessionCookieVault vault=new SessionCookieVault(context);
        try {
            manager.setCookie(url,"JAAuthCookie="+token+
                "; Path=/jaccount/; Secure; HttpOnly");
            manager.flush();
            assertTrue(manager.getCookie(url).contains("JAAuthCookie="+token));
            assertFalse(String.valueOf(manager.getCookie(
                "https://jaccount.sjtu.edu.cn/")).contains("JAAuthCookie="+token));
            vault.saveAfterVerification();
            manager.setCookie(url,"JAAuthCookie=; Max-Age=0; Path=/jaccount/; Secure; HttpOnly");
            manager.flush();
            assertFalse(String.valueOf(manager.getCookie(url)).contains("JAAuthCookie="+token));
            new SessionCookieVault(context).restoreOnce();
            assertTrue(manager.getCookie(url).contains("JAAuthCookie="+token));
        }finally{
            vault.clearSavedSession();
            manager.setCookie(url,"JAAuthCookie=; Max-Age=0; Path=/jaccount/; Secure; HttpOnly");
            manager.flush();
        }
    }

    private static boolean hasSession(CookieManager manager, String token) {
        String jar = manager.getCookie(URL);
        return jar != null && jar.contains("JSESSIONID=" + token);
    }
}
