package app.safetube.kids;

import android.net.Uri;
import androidx.annotation.Nullable;

/** Blocks top-level WebView navigation to YouTube watch/channel pages and external intents. */
final class SafeTubeUrlGuard {
    private SafeTubeUrlGuard() {}

    static boolean shouldBlockMainFrame(@Nullable Uri uri) {
        if (uri == null) return false;

        String scheme = uri.getScheme();
        if (scheme == null) return false;
        String lowerScheme = scheme.toLowerCase();
        if ("intent".equals(lowerScheme) || "vnd.youtube".equals(lowerScheme)) {
            return true;
        }
        if (!"http".equals(lowerScheme) && !"https".equals(lowerScheme)) {
            return false;
        }

        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase();

        if ("youtu.be".equals(host)) return true;
        if (!host.endsWith("youtube.com")) return false;

        String path = uri.getPath() != null ? uri.getPath().toLowerCase() : "";
        if (path.startsWith("/embed/") || path.startsWith("/iframe_api")) {
            return false;
        }
        return true;
    }
}
