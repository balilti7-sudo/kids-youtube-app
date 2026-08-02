package app.safetube.kids;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.CapacitorWebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MediaPlayback")
public class MediaPlaybackPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            CapacitorWebView.allowBackgroundMedia = true;

            String title = call.getString("title", "SafeTube");
            String artist = call.getString("artist", "מתנגן עכשיו");

            Intent intent = new Intent(getContext(), MediaPlaybackService.class);
            intent.putExtra(MediaPlaybackService.EXTRA_TITLE, title);
            intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, artist);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }

            // Immediately keep WebView alive in case the user backgrounds right away.
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().onResume();
                    getBridge().getWebView().resumeTimers();
                }
            } catch (Exception ignored) {
                /* ignore */
            }
        } catch (Exception ignored) {
            /* ignore — foreground playback must keep working */
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
}
