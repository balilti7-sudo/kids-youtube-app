package app.safetube.kids;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapacitorWebView;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaPlaybackPlugin.class);
        registerPlugin(ParentalControlPlugin.class);
        registerPlugin(SecureStoragePlugin.class);
        super.onCreate(savedInstanceState);
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        installSafeAreaInsets();
    }

    /**
     * Forward hardware / Bluetooth media keys to the active MediaSession while the
     * activity is in the foreground (steering-wheel next/prev/play when AA/BT maps keys here).
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event != null) {
            int code = event.getKeyCode();
            boolean mediaKey =
                code == KeyEvent.KEYCODE_MEDIA_PLAY
                    || code == KeyEvent.KEYCODE_MEDIA_PAUSE
                    || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                    || code == KeyEvent.KEYCODE_MEDIA_NEXT
                    || code == KeyEvent.KEYCODE_MEDIA_PREVIOUS
                    || code == KeyEvent.KEYCODE_MEDIA_STOP
                    || code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
                    || code == KeyEvent.KEYCODE_MEDIA_REWIND
                    || code == KeyEvent.KEYCODE_HEADSETHOOK;
            if (mediaKey && MediaPlaybackService.dispatchMediaKeyEvent(event)) {
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    /**
     * targetSdk 35+ draws edge-to-edge; push real system-bar insets into CSS vars
     * so fixed dialogs / bottom sheets clear the gesture nav pill.
     */
    private void installSafeAreaInsets() {
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            final WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView == null) return;

            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                int top = Math.max(0, bars.top);
                int bottom = Math.max(0, bars.bottom);
                int left = Math.max(0, bars.left);
                int right = Math.max(0, bars.right);
                // Keep a usable minimum when OEMs report 0 for gesture nav.
                if (bottom < 24) bottom = 24;

                String js = String.format(
                    Locale.US,
                    "(function(){try{"
                        + "var r=document.documentElement;"
                        + "r.style.setProperty('--sat','%dpx');"
                        + "r.style.setProperty('--sab','%dpx');"
                        + "r.style.setProperty('--sal','%dpx');"
                        + "r.style.setProperty('--sar','%dpx');"
                        + "if(window.__safetubeApplySafeArea)window.__safetubeApplySafeArea(%d,%d,%d,%d);"
                        + "}catch(e){}})();",
                    top, bottom, left, right,
                    top, bottom, left, right
                );
                webView.post(() -> {
                    try {
                        webView.evaluateJavascript(js, null);
                    } catch (Exception ignored) {
                        /* ignore */
                    }
                });
                return windowInsets;
            });
            ViewCompat.requestApplyInsets(webView);
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
