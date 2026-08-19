package app.safetube.kids;

import android.content.Context;
import android.content.SharedPreferences;

/** Kid UI display prefs synced from the WebView (thumbnail filtering). */
final class ChildDisplayPrefs {
    private static final String PREFS = "safetube_child_display";
    private static final String KEY_HIDE_THUMBNAILS = "hide_thumbnails";

    private ChildDisplayPrefs() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void setHideThumbnails(Context ctx, boolean hide) {
        prefs(ctx).edit().putBoolean(KEY_HIDE_THUMBNAILS, hide).apply();
    }

    static boolean isHideThumbnails(Context ctx) {
        return prefs(ctx).getBoolean(KEY_HIDE_THUMBNAILS, false);
    }
}
