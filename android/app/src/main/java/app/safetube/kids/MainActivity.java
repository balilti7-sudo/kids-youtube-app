package app.safetube.kids;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapacitorWebView;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaPlaybackPlugin.class);
        registerPlugin(ParentalControlPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
            }
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewMediaAlive();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewMediaAlive();
    }

    /**
     * Capacitor/Cordova keep JS timers when KeepRunning=true, but Chromium still
     * suspends media when the window is not visible. Re-resume the WebView and
     * nudge &lt;video&gt;.play() whenever our media FGS is active.
     */
    private void keepWebViewMediaAlive() {
        if (!MediaPlaybackService.isActive() && !CapacitorWebView.allowBackgroundMedia) return;
        try {
            if (bridge == null) return;
            WebView webView = bridge.getWebView();
            if (webView == null) return;
            webView.onResume();
            webView.resumeTimers();
            webView.evaluateJavascript(
                "(function(){try{var v=document.querySelector('video');"
                    + "if(v&&v.paused&&!v.ended&&v.getAttribute('data-safetube-bg')==='1')"
                    + "{v.play().catch(function(){})}}catch(e){}})();",
                null
            );
        } catch (Exception ignored) {
            /* ignore */
        }
    }
}
