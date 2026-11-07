package me.hisunalan.sjtudownloader;

import org.junit.Test;
import static org.junit.Assert.*;

/** A network outage must never be interpreted as a signed-out session. */
public class SessionFailurePolicyTest {
    @Test public void onlyAuthenticationFailuresExpireTheAccount() {
        for(int code:new int[]{401,403})
            assertTrue(SjtuCanvasPlugin.canvasApiException(code,"oc.sjtu.edu.cn") instanceof SjtuCanvasPlugin.CanvasAuthException);
        for(int code:new int[]{404,408,429,500,502,503,504})
            assertFalse(SjtuCanvasPlugin.canvasApiException(code,"oc.sjtu.edu.cn") instanceof SjtuCanvasPlugin.CanvasAuthException);
    }
}
