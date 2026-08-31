package app.safetube.kids;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.getcapacitor.CapacitorWebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MediaPlayback")
public class MediaPlaybackPlugin extends Plugin {
    private static volatile MediaPlaybackPlugin instance;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /**
     * Forward MediaSession / notification / Bluetooth transport commands into JS.
     * Also nudges the WebView so Chromium can resume media when backgrounded.
     */
    public static void emitMediaAction(String action, Long seekToMs) {
        MediaPlaybackPlugin plugin = instance;
        if (plugin == null) return;
        plugin.mainHandler.post(() -> {
            try {
                plugin.keepWebViewAlive();
                JSObject data = new JSObject();
                data.put("action", action);
                if (seekToMs != null) data.put("seekToMs", seekToMs);
                plugin.notifyListeners("mediaAction", data);

                // Hard fallback when listeners are not yet registered (cold background).
                // Prefer __safetubeYtPlayer (iframe postMessage bridge on Android) then <video>.
                String js =
                    "(function(){try{"
                        + "var d={action:" + jsString(action)
                        + (seekToMs != null ? (",seekToMs:" + seekToMs) : "")
                        + "};"
                        + "if(window.__safetubeMediaAction)window.__safetubeMediaAction(d);"
                        + "var yp=window.__safetubeYtPlayer;"
                        + "if(yp){"
                        + "if(d.action==='play'){yp.play()}"
                        + "else if(d.action==='pause'){yp.pause()}"
                        + "else if(d.action==='seekto'&&typeof d.seekToMs==='number'){yp.seekToMs(d.seekToMs)}"
                        + "else if(d.action==='seekforward'){yp.seekForwardMs(d.seekToMs||10000)}"
                        + "else if(d.action==='seekbackward'){yp.seekBackwardMs(d.seekToMs||10000)}"
                        // next/previous handled by __safetubeMediaAction → CleanPlayer queue
                        + "return;"
                        + "}"
                        + "var v=document.querySelector('video[data-safetube-bg=\"1\"]');"
                        + "if(!v)v=document.querySelector('video');"
                        + "if(!v)return;"
                        + "if(d.action==='play'){v.play().catch(function(){})}"
                        + "else if(d.action==='pause'){v.pause()}"
                        + "else if(d.action==='seekto'&&typeof d.seekToMs==='number'){v.currentTime=d.seekToMs/1000}"
                        + "else if(d.action==='seekforward'){v.currentTime=Math.min((v.duration||1e9),v.currentTime+((d.seekToMs||10000)/1000))}"
                        + "else if(d.action==='seekbackward'){v.currentTime=Math.max(0,v.currentTime-((d.seekToMs||10000)/1000))}"
                        + "}catch(e){}})();";
                WebView webView = plugin.getBridge() != null ? plugin.getBridge().getWebView() : null;
                if (webView != null) webView.evaluateJavascript(js, null);
            } catch (Exception ignored) {
                /* ignore */
            }
        });
    }

    private static String jsString(String value) {
        if (value == null) return "''";
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    private void keepWebViewAlive() {
        try {
            CapacitorWebView.allowBackgroundMedia = true;
            if (getBridge() == null || getBridge().getWebView() == null) return;
            getBridge().getWebView().onResume();
            getBridge().getWebView().resumeTimers();
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        try {
            CapacitorWebView.allowBackgroundMedia = true;

            String title = call.getString("title", "SafeTube");
            String artist = call.getString("artist", "מתנגן עכשיו");
            Double durationMs = call.getDouble("durationMs");
            Double positionMs = call.getDouble("positionMs");
            Boolean playing = call.getBoolean("playing", true);
            String artworkUrl = call.getString("artworkUrl", null);
            Boolean canSkipNext = call.getBoolean("canSkipNext", true);
            Boolean canSkipPrev = call.getBoolean("canSkipPrev", true);

            Intent intent = new Intent(getContext(), MediaPlaybackService.class);
            intent.putExtra(MediaPlaybackService.EXTRA_TITLE, title);
            intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, artist);
            if (durationMs != null) intent.putExtra(MediaPlaybackService.EXTRA_DURATION_MS, durationMs.longValue());
            if (positionMs != null) intent.putExtra(MediaPlaybackService.EXTRA_POSITION_MS, positionMs.longValue());
            if (playing != null) intent.putExtra(MediaPlaybackService.EXTRA_PLAYING, playing);
            if (artworkUrl != null) intent.putExtra(MediaPlaybackService.EXTRA_ARTWORK_URL, artworkUrl);
            if (canSkipNext != null) intent.putExtra(MediaPlaybackService.EXTRA_CAN_SKIP_NEXT, canSkipNext);
            if (canSkipPrev != null) intent.putExtra(MediaPlaybackService.EXTRA_CAN_SKIP_PREV, canSkipPrev);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }

            keepWebViewAlive();
        } catch (Exception ignored) {
            /* ignore — foreground playback must keep working */
        }
        call.resolve();
    }

    @PluginMethod
    public void updateSession(PluginCall call) {
        try {
            String title = call.getString("title", null);
            String artist = call.getString("artist", null);
            Double durationMs = call.getDouble("durationMs");
            Double positionMs = call.getDouble("positionMs");
            Boolean playing = call.getBoolean("playing", null);
            String artworkUrl = call.getString("artworkUrl", null);
            Boolean canSkipNext = call.getBoolean("canSkipNext", null);
            Boolean canSkipPrev = call.getBoolean("canSkipPrev", null);

            if (MediaPlaybackService.isActive()) {
                MediaPlaybackService.updateFromPlugin(
                    title,
                    artist,
                    durationMs != null ? durationMs.longValue() : -1L,
                    positionMs != null ? positionMs.longValue() : -1L,
                    playing != null ? playing : true,
                    artworkUrl,
                    canSkipNext != null ? canSkipNext : true,
                    canSkipPrev != null ? canSkipPrev : true
                );
            } else {
                // Cold path — start service with full metadata.
                Intent intent = new Intent(getContext(), MediaPlaybackService.class);
                intent.setAction(MediaPlaybackService.ACTION_UPDATE);
                if (title != null) intent.putExtra(MediaPlaybackService.EXTRA_TITLE, title);
                if (artist != null) intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, artist);
                if (durationMs != null) intent.putExtra(MediaPlaybackService.EXTRA_DURATION_MS, durationMs.longValue());
                if (positionMs != null) intent.putExtra(MediaPlaybackService.EXTRA_POSITION_MS, positionMs.longValue());
                if (playing != null) intent.putExtra(MediaPlaybackService.EXTRA_PLAYING, playing);
                if (artworkUrl != null) intent.putExtra(MediaPlaybackService.EXTRA_ARTWORK_URL, artworkUrl);
                if (canSkipNext != null) intent.putExtra(MediaPlaybackService.EXTRA_CAN_SKIP_NEXT, canSkipNext);
                if (canSkipPrev != null) intent.putExtra(MediaPlaybackService.EXTRA_CAN_SKIP_PREV, canSkipPrev);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(intent);
                } else {
                    getContext().startService(intent);
                }
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        CapacitorWebView.allowBackgroundMedia = false;
        try {
            Intent intent = new Intent(getContext(), MediaPlaybackService.class);
            intent.setAction(MediaPlaybackService.ACTION_STOP);
            getContext().startService(intent);
            getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
        } catch (Exception ignored) {
            /* ignore */
        }
        call.resolve();
    }

    /** Raise / lower / toggle-mute STREAM_MUSIC (YouTube iframe + Media Bridge). */
    @PluginMethod
    public void adjustVolume(PluginCall call) {
        String direction = call.getString("direction", "raise");
        try {
            android.media.AudioManager am =
                (android.media.AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
            if (am != null) {
                int adj = android.media.AudioManager.ADJUST_RAISE;
                if ("lower".equalsIgnoreCase(direction)) {
                    adj = android.media.AudioManager.ADJUST_LOWER;
                } else if ("mute".equalsIgnoreCase(direction) || "toggleMute".equalsIgnoreCase(direction)) {
                    adj = android.media.AudioManager.ADJUST_TOGGLE_MUTE;
                }
                am.adjustStreamVolume(
                    android.media.AudioManager.STREAM_MUSIC,
                    adj,
                    android.media.AudioManager.FLAG_SHOW_UI
                );
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        call.resolve();
    }

    /**
     * Fullscreen theater orientation owner. WebView {@code screen.orientation.lock}
     * is unreliable in Capacitor; Activity lock is the smallest reliable path.
     * mode: "landscape" | "portrait" | "unlocked"
     */
    @PluginMethod
    public void setOrientationLock(PluginCall call) {
        String mode = call.getString("mode", "unlocked");
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        final int orientation;
        if ("landscape".equalsIgnoreCase(mode)) {
            orientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else if ("portrait".equalsIgnoreCase(mode)) {
            orientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        } else {
            orientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
        activity.runOnUiThread(
            () -> {
                try {
                    activity.setRequestedOrientation(orientation);
                } catch (Exception ignored) {
                    /* ignore — expand still works without lock */
                }
                call.resolve();
            }
        );
    }
}
