package app.safetube.kids;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Capacitor pauses WebView timers on onPause. Resume timers so HTML5 media can keep
     * playing when the screen turns off or another app is opened. Do NOT call
     * WebView.onResume() here — that fights the Activity lifecycle and can stall playback.
     */
    @Override
    public void onPause() {
        super.onPause();
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().resumeTimers();
            }
        } catch (Exception ignored) {
            /* ignore */
        }
    }
}
