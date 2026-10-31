package me.hisunalan.sjtudownloader;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SjtuCanvasPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
