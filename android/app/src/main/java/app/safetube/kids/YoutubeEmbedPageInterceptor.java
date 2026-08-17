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
 * YouTube's embed HTML returns error 153 when the request Referer is Capacitor's
 * {@code https://localhost}. Re-fetch only {@code /embed/…} documents (never googlevideo
 * media / Range streams) with a YouTube Referer so the iframe fallback can play.
 */
final class YoutubeEmbedPageInterceptor {
    private static final String YOUTUBE_ORIGIN = "https://www.youtube.com";
    private static final String YOUTUBE_REFERER = "https://www.youtube.com/";
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 20_000;

    private YoutubeEmbedPageInterceptor() {}

    static WebResourceResponse maybeIntercept(WebResourceRequest request) {
        if (request == null) return null;
        if (!"GET".equalsIgnoreCase(request.getMethod())) return null;
        Uri uri = request.getUrl();
        if (uri == null) return null;
        String host = uri.getHost();
        if (host == null) return null;
        String h = host.toLowerCase(Locale.US);
        boolean youtubeHost =
            h.equals("youtube.com")
                || h.endsWith(".youtube.com")
                || h.equals("youtube-nocookie.com")
                || h.endsWith(".youtube-nocookie.com");
        if (!youtubeHost) return null;
        String path = uri.getPath();
        if (path == null || !path.contains("/embed/")) return null;

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
            if (mime == null || mime.isEmpty()) mime = "text/html";
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

            String encoding = conn.getContentEncoding();
            return new WebResourceResponse(mime, encoding, code, statusMessage(code), outHeaders, stream);
        } catch (Exception ignored) {
            if (conn != null) conn.disconnect();
            return null;
        }
    }

    private static boolean equalsIgnore(String a, String b) {
        return a != null && a.equalsIgnoreCase(b);
    }

    private static String statusMessage(int code) {
        if (code == 200) return "OK";
        if (code == 301) return "Moved Permanently";
        if (code == 302) return "Found";
        if (code == 403) return "Forbidden";
        if (code == 404) return "Not Found";
        return "OK";
    }
}
