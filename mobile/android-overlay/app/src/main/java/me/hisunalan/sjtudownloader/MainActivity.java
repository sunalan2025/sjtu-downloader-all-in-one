package me.hisunalan.sjtudownloader;

import android.os.Bundle;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/** Keep a true edge-to-edge WebView; the React shell applies native inset paddings. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SjtuCanvasPlugin.class);
        super.onCreate(savedInstanceState);
        // When Android draws behind the status bar before the WebView paints,
        // show the same surface as the app rather than the default white window.
        final int canvas = Color.rgb(220, 234, 252);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS |
                               WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        getWindow().setBackgroundDrawable(new ColorDrawable(canvas));
        getWindow().getDecorView().setBackgroundColor(canvas);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // Match the CSS top edge even on OEMs that inset the WebView.
        getWindow().setStatusBarColor(canvas);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);
    }
}
