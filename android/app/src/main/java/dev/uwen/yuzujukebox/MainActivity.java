package dev.uwen.yuzujukebox;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App 内插件不会被自动发现，且注册必须先于 super.onCreate（v4 起）
        registerPlugin(YuzuMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
