package app.safetube.kids;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * googlevideo.com rejects WebView media after the first buffered chunk when the request
 * carries Capacitor's {@code Referer: https://localhost}. Re-issue those requests from the
 * device with YouTube's own Referer/Origin so playback stays on-device (phone ↔ CDN) and
 * subsequent Range requests keep returning 206 instead of silent 403 freezes.
 */
final class YoutubeMediaInterceptor {
    private static final String YOUTUBE_ORIGIN = "https://www.youtube.com";
    private static final String YOUTUBE_REFERER = "https://www.youtube.com/";
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private YoutubeMediaInterceptor() {}

    static WebResourceResponse maybeIntercept(WebResourceRequest request) {
        if (request == null) return null;
        Uri uri = request.getUrl();
        if (uri == null) return null;
        String host = uri.getHost();
        if (host == null) return null;
        String h = host.toLowerCase(Locale.US);
        boolean googleVideo = h.endsWith(".googlevideo.com") || h.equals("googlevideo.com");
        boolean youtubePlayback =
            (h.endsWith(".youtube.com") || h.equals("youtube.com"))
                && uri.getPath() != null
                && uri.getPath().contains("videoplayback");
        if (!googleVideo && !youtubePlayback) return null;
        if (!"GET".equalsIgnoreCase(request.getMethod())) return null;

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(uri.toString()).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestMethod("GET");

            Map<String, String> incoming = request.getRequestHeaders();
            if (incoming != null) {
                for (Map.Entry<String, String> e : incoming.entrySet()) {
                    if (e.getKey() == null || e.getValue() == null) continue;
                    String name = e.getKey();
                    if (equalsIgnore(name, "Referer")
                        || equalsIgnore(name, "Origin")
                        || equalsIgnore(name, "Host")
                        || equalsIgnore(name, "Connection")) {
                        continue;
                    }
                    conn.setRequestProperty(name, e.getValue());
                }
            }
            conn.setRequestProperty("Referer", YOUTUBE_REFERER);
            conn.setRequestProperty("Origin", YOUTUBE_ORIGIN);

            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) stream = new ByteArrayInputStream(new byte[0]);

            String mime = conn.getContentType();
            if (mime == null || mime.isEmpty()) {
                mime = googleVideo ? "video/mp4" : "application/octet-stream";
            }
            int semi = mime.indexOf(';');
            if (semi > 0) mime = mime.substring(0, semi).trim();

            Map<String, String> outHeaders = new HashMap<>();
            Map<String, List<String>> raw = conn.getHeaderFields();
            if (raw != null) {
                for (Map.Entry<String, List<String>> e : raw.entrySet()) {
                    if (e.getKey() == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                    outHeaders.put(e.getKey(), e.getValue().get(0));
                }
            }

            String reason = conn.getResponseMessage();
            if (reason == null || reason.isEmpty()) reason = code == 206 ? "Partial Content" : "OK";

            return new WebResourceResponse(mime, "UTF-8", code, reason, outHeaders, stream);
        } catch (Exception ignored) {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored2) {
                    /* ignore */
                }
            }
            // Fall back to the WebView's own request rather than failing closed.
            return null;
        }
    }

    private static boolean equalsIgnore(String a, String b) {
        return a != null && a.equalsIgnoreCase(b);
    }
}
