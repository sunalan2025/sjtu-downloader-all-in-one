package me.hisunalan.sjtudownloader;

import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

import java.lang.reflect.Method;
import java.io.IOException;
import java.io.EOFException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import javax.net.ssl.SSLHandshakeException;

@RunWith(AndroidJUnit4.class)
public class CanvasRetryPolicyTest {
    private static boolean retryNetwork(IOException error) throws Exception {
        Method method = SjtuCanvasPlugin.class.getDeclaredMethod("transientIOException", IOException.class);
        method.setAccessible(true);
        return (Boolean) method.invoke(null, error);
    }

    private static boolean retryStatus(int status) throws Exception {
        Method method = SjtuCanvasPlugin.class.getDeclaredMethod("transientHttpStatus", int.class);
        method.setAccessible(true);
        return (Boolean) method.invoke(null, status);
    }

    @Test public void socketAbortAndTimeoutAreRetriable() throws Exception {
        assertTrue(retryNetwork(new SocketException("Software caused connection abort")));
        assertTrue(retryNetwork(new SocketTimeoutException("Read timed out")));
        assertTrue(retryNetwork(new EOFException("unexpected EOF")));
    }

    @Test public void permissionAndTlsErrorsAreNeverRetried() throws Exception {
        assertFalse(retryStatus(401));
        assertFalse(retryStatus(403));
        assertFalse(retryStatus(404));
        assertFalse(retryNetwork(new SSLHandshakeException("untrusted certificate")));
        assertFalse(retryNetwork(new UnknownHostException("offline")));
    }

    @Test public void temporaryServerFailuresAreRetried() throws Exception {
        for (int code : new int[]{429, 500, 502, 503, 504}) {
            assertTrue("expected retry for " + code, retryStatus(code));
        }
        assertFalse(retryStatus(400));
    }
}
