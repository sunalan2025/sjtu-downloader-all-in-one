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

    private static boolean hasSession(CookieManager manager, String token) {
        String jar = manager.getCookie(URL);
        return jar != null && jar.contains("JSESSIONID=" + token);
    }
}
