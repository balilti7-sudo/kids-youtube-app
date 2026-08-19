package app.safetube.kids;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.annotation.Nullable;
import java.io.ByteArrayInputStream;
import java.util.Locale;
import java.util.Map;

/**
 * Blocks YouTube CDN image requests from the SafeTube app shell only.
 * Embed iframe resources (Referer: youtube.com) are left alone so playback stays stable.
 */
final class SafeTubeImageFilter {
    private static final byte[] EMPTY_PNG =
        new byte[] {
            (byte) 0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
            0x00,
            0x00,
            0x00,
            0x0d,
            0x49,
            0x48,
            0x44,
            0x52,
            0x00,
            0x00,
            0x00,
            0x01,
            0x00,
            0x00,
            0x00,
            0x01,
            0x08,
            0x06,
            0x00,
            0x00,
            0x00,
            0x1f,
            0x15,
            (byte) 0xc4,
            (byte) 0x89,
            0x00,
            0x00,
            0x00,
            0x0a,
            0x49,
            0x44,
            0x41,
            0x54,
            0x78,
            (byte) 0xda,
            0x63,
            0x60,
            0x00,
            0x00,
            0x00,
            0x02,
            0x00,
            0x01,
            (byte) 0xe2,
            0x21,
            (byte) 0xbc,
            0x33,
            0x00,
            0x00,
            0x00,
            0x00,
            0x49,
            0x45,
            0x4e,
            0x44,
            (byte) 0xae,
            0x42,
            0x60,
            (byte) 0x82
        };

    private SafeTubeImageFilter() {}

    @Nullable
    static WebResourceResponse maybeBlock(Context ctx, @Nullable WebResourceRequest request) {
        if (ctx == null || request == null || request.getUrl() == null) return null;
        if (!ChildDisplayPrefs.isHideThumbnails(ctx)) return null;
        if (request.isForMainFrame()) return null;

        Uri uri = request.getUrl();
        if (!isYoutubeImageHost(uri.getHost())) return null;
        if (isEmbedReferer(request.getRequestHeaders())) return null;

        return new WebResourceResponse("image/png", null, new ByteArrayInputStream(EMPTY_PNG));
    }

    private static boolean isYoutubeImageHost(@Nullable String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.US);
        return h.contains("ytimg.com")
            || h.contains("ggpht.com")
            || h.contains("googleusercontent.com")
            || h.equals("img.youtube.com");
    }

    private static boolean isEmbedReferer(@Nullable Map<String, String> headers) {
        if (headers == null || headers.isEmpty()) return false;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) continue;
            if (!"referer".equalsIgnoreCase(entry.getKey())) continue;
            String ref = entry.getValue().toLowerCase(Locale.US);
            if (ref.contains("youtube.com") || ref.contains("youtu.be")) return true;
        }
        return false;
    }
}
