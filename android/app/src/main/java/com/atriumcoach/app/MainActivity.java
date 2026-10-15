package com.atriumcoach.app;

import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugins register before the bridge starts.
        registerPlugin(GalaxyPurchasesPlugin.class);
        super.onCreate(savedInstanceState);
        // The camera notch sits on a short edge in landscape: without this Android leaves a grey strip there.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }
        applySystemBars();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applySystemBars();
    }

    /**
     * Rooms filmed for a sideways phone fill the whole screen in landscape: the status and navigation bars
     * are hidden (a swipe from the edge shows them for a moment). Portrait keeps them, exactly as before.
     */
    private void applySystemBars() {
        Window window = getWindow();
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        boolean landscape = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        // Landscape draws under the notch and the hidden bars; portrait keeps its layout exactly as before.
        WindowCompat.setDecorFitsSystemWindows(window, !landscape);
        if (landscape) {
            bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            bars.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            bars.show(WindowInsetsCompat.Type.systemBars());
        }
    }
}
