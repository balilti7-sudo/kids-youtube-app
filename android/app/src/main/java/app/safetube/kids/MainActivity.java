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
     * Capacitor's default onPause pauses the WebView timers/media. Resume them so HTML5
     * {@code <video>} keeps playing when the screen turns off or another app is opened.
     * Pair with {@link MediaPlaybackService} so Android does not kill the process.
     */
    @Override
    public void onPause() {
        super.onPause();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().onResume();
            bridge.getWebView().resumeTimers();
        }
    }
}
