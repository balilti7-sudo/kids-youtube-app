package app.safetube.kids;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MediaPlayback")
public class MediaPlaybackPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        // Never gate playback on permissions or dialogs — just best-effort FGS.
        try {
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
        } catch (Exception ignored) {
            /* ignore — foreground playback must keep working */
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
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
