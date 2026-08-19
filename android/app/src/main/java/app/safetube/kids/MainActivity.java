package app.safetube.kids;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapacitorWebView;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    public static final String EXTRA_YOUTUBE_BLOCKED = "safetube_youtube_blocked";
    public static final String EXTRA_BROWSER_BLOCKED = "safetube_browser_blocked";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaPlaybackPlugin.class);
        registerPlugin(ParentalControlPlugin.class);
        registerPlugin(SecureStoragePlugin.class);
        registerPlugin(BiometricUnlockPlugin.class);
        registerPlugin(ChildDisplayPlugin.class);
        super.onCreate(savedInstanceState);
        handleParentalBlockIntent(getIntent());
        try {
            if (bridge != null && bridge.getWebView() != null) {
                installSafeTubeWebViewGuards(bridge);
                WebView webView = bridge.getWebView();
                webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
                CookieManager cookies = CookieManager.getInstance();
                cookies.setAcceptCookie(true);
                cookies.setAcceptThirdPartyCookies(webView, true);
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        installSafeAreaInsets();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleParentalBlockIntent(intent);
    }

    /** Parental control redirected here after blocking YouTube or a non-whitelisted browser site. */
    private void handleParentalBlockIntent(android.content.Intent intent) {
        if (intent == null) return;
        if (intent.getBooleanExtra(EXTRA_YOUTUBE_BLOCKED, false)) {
            intent.removeExtra(EXTRA_YOUTUBE_BLOCKED);
            notifyParentalBlockInWebView("__safetubeOnYoutubeAppBlocked");
            return;
        }
        if (intent.getBooleanExtra(EXTRA_BROWSER_BLOCKED, false)) {
            intent.removeExtra(EXTRA_BROWSER_BLOCKED);
            notifyParentalBlockInWebView("__safetubeOnBrowserSiteBlocked");
        }
    }

    private void notifyParentalBlockInWebView(String callbackName) {
        try {
            if (bridge == null || bridge.getWebView() == null) return;
            bridge
                .getWebView()
                .post(
                    () -> {
                        try {
                            bridge
                                .getWebView()
                                .evaluateJavascript(
                                    "(function(){try{"
                                        + "if(window." + callbackName + ")window." + callbackName + "();"
                                        + "}catch(e){}})();",
                                    null
                                );
                        } catch (Exception ignored) {
                            /* ignore */
                        }
                    }
                );
        } catch (Exception ignored) {
            /* ignore */
        }
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
        pauseWebViewMedia();
    }

    @Override
    public void onStop() {
        super.onStop();
        pauseWebViewMedia();
    }

    /**
     * Block main-frame navigation to YouTube watch/channel pages and popups from the embed player.
     * Delegates to Capacitor's WebView clients so plugins and routing keep working.
     */
    private void installSafeTubeWebViewGuards(Bridge bridge) {
        WebView webView = bridge.getWebView();
        if (webView == null) return;

        webView.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    WebResourceResponse blocked = SafeTubeImageFilter.maybeBlock(getApplicationContext(), request);
                    if (blocked != null) return blocked;
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                @SuppressWarnings("deprecation")
                public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                    return super.shouldInterceptRequest(view, url);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (
                        request != null
                            && request.isForMainFrame()
                            && SafeTubeUrlGuard.shouldBlockMainFrame(request.getUrl())
                    ) {
                        return true;
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }

                @Override
                @SuppressWarnings("deprecation")
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    if (SafeTubeUrlGuard.shouldBlockMainFrame(android.net.Uri.parse(url))) {
                        return true;
                    }
                    return super.shouldOverrideUrlLoading(view, url);
                }
            }
        );

        webView.setWebChromeClient(
            new BridgeWebChromeClient(bridge) {
                @Override
                public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    android.os.Message resultMsg
                ) {
                    // YouTube embed logo / title opens a new window — stay inside SafeTube.
                    return false;
                }
            }
        );
    }

    /**
     * Stop WebView media when the app is backgrounded or the screen is locked.
     */
    private void pauseWebViewMedia() {
        try {
            CapacitorWebView.allowBackgroundMedia = false;
            if (bridge == null) return;
            WebView webView = bridge.getWebView();
            if (webView == null) return;
            webView.evaluateJavascript(
                "(function(){try{"
                    + "if(window.__safetubePauseAllPlayback)window.__safetubePauseAllPlayback();"
                    + "var v=document.querySelector('video');"
                    + "if(v&&!v.paused&&!v.ended)v.pause();"
                    + "if(window.__safetubeYtPlayer)window.__safetubeYtPlayer.pause();"
                    + "}catch(e){}})();",
                null
            );
        } catch (Exception ignored) {
            /* ignore */
        }
    }
}
