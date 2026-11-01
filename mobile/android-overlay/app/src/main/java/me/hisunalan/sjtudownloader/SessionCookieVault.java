package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Locale;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Encrypted recovery of *verified* SJTU session cookies between Android process restarts.
 *
 * Never stores jAccount passwords. Limit recovery to the explicitly verified SJTU services
 * and session-identity cookies; other WebView cookies use the standard persistent jar.
 * Backend token validity still controls access.
 */
final class SessionCookieVault {
    private static final String[] HOSTS = {
        "oc.sjtu.edu.cn", "calendar.sjtu.edu.cn",
        "j.sjtu.edu.cn", "i.sjtu.edu.cn"
    };
    private static final String PREF_FILE = "sjtu_android_session_v1";
    private static final String PREF_VALUE = "sealed_session";
    private static final String KEY_ALIAS = "sjtu_session_aes_gcm_v1";
    private static final String SEAL = "SJTU_DOWNLOADER_SESSION_V1";
    private static final int MAX_VALUE = 12 * 1024;
    private final Context appContext;
    private boolean restored = false;

    SessionCookieVault(Context context) {
        appContext = context.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return appContext.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
    }

    private SecretKey secretKey(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
        }
        if (!create) return null;
        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private static boolean isSessionName(String name) {
        String key = name.toLowerCase(Locale.ROOT);
        return key.contains("session") || key.equals("jsessionid");
    }

    private static String sessionPairs(String jar) {
        if (jar == null || jar.isEmpty()) return "";
        StringBuilder pairs = new StringBuilder();
        for (String part : jar.split(";")) {
            String cookie = part.trim();
            int sep = cookie.indexOf('=');
            if (sep <= 0) continue;
            String name = cookie.substring(0, sep).trim();
            String value = cookie.substring(sep + 1).trim();
            if (!name.matches("[A-Za-z0-9_.$-]{1,80}") || value.length() > MAX_VALUE ||
                value.indexOf(13) >= 0 || value.indexOf(10) >= 0 || !isSessionName(name)) continue;
            if (pairs.length() > 0) pairs.append("; ");
            pairs.append(name).append('=').append(value);
        }
        return pairs.toString();
    }

    /**
     * Only call after an authenticated Canvas profile or official calendar response.
     * All saved data remains AES/GCM encrypted in app-private preferences.
     */
    synchronized void saveAfterVerification() {
        try {
            CookieManager cookies = CookieManager.getInstance();
            cookies.flush();
            JSONObject selected = new JSONObject();
            for (String host : HOSTS) {
                String pairs = sessionPairs(cookies.getCookie("https://" + host + "/"));
                if (!pairs.isEmpty()) selected.put(host, pairs);
            }
            if (selected.length() == 0) return;
            byte[] data = selected.toString().getBytes(StandardCharsets.UTF_8);
            if (data.length > 32 * 1024) return;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey(true));
            cipher.updateAAD(SEAL.getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(data);
            JSONObject envelope = new JSONObject();
            envelope.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
            envelope.put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP));
            prefs().edit().putString(PREF_VALUE, envelope.toString()).commit();
        } catch (Exception ignored) {
            // Fail closed: never save plaintext cookies or leak credentials to logs.
        }
    }

    /**
     * Called before initial profile check; avoid overwriting cookies refreshed by WebView.
     * No network calls, and no credentials are exposed to JavaScript.
     */
    synchronized void restoreOnce() {
        if (restored) return;
        restored = true;
        String stored = prefs().getString(PREF_VALUE, null);
        if (stored == null || stored.isEmpty()) return;
        try {
            JSONObject envelope = new JSONObject(stored);
            byte[] iv = Base64.decode(envelope.getString("iv"), Base64.DEFAULT);
            byte[] encrypted = Base64.decode(envelope.getString("data"), Base64.DEFAULT);
            if (iv.length != 12 || encrypted.length > 40 * 1024) throw new Exception("Invalid session");
            SecretKey key = secretKey(false);
            if (key == null) throw new Exception("No Android Keystore key");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            cipher.updateAAD(SEAL.getBytes(StandardCharsets.UTF_8));
            JSONObject selected = new JSONObject(
                new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));
            CookieManager manager = CookieManager.getInstance();
            for (String host : HOSTS) {
                String current = sessionPairs(manager.getCookie("https://" + host + "/"));
                String[] saved = selected.optString(host, "").split(";");
                for (String part : saved) {
                    String pair = part.trim();
                    int sep = pair.indexOf('=');
                    if (sep < 1) continue;
                    String name = pair.substring(0, sep).trim();
                    String value = pair.substring(sep + 1);
                    if (!name.matches("[A-Za-z0-9_.$-]{1,80}") ||
                        value.length() > MAX_VALUE || !isSessionName(name)) continue;
                    // Never replace a newer session already present in the WebView jar.
                    if (containsName(current, name)) continue;
                    manager.setCookie("https://" + host + "/", name + "=" + value +
                        "; Path=/; Secure; HttpOnly");
                }
            }
            manager.flush();
        } catch (Exception ignored) {
            // Backup may have restored ciphertext without the Keystore key.
            prefs().edit().remove(PREF_VALUE).apply();
        }
    }

    private static boolean containsName(String pairs, String name) {
        for (String pair : pairs.split(";")) {
            int sep = pair.indexOf('=');
            if (sep > 0 && pair.substring(0, sep).trim().equals(name)) return true;
        }
        return false;
    }

    synchronized boolean hasSavedSession() {
        return prefs().contains(PREF_VALUE);
    }

    synchronized void clearSavedSession() {
        prefs().edit().remove(PREF_VALUE).commit();
        restored = true;
    }
}
