package app.safetube.kids;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import java.util.ArrayList;
import java.util.List;

/** Shared policy store for the Accessibility parental-control service. */
public final class ParentalControlPrefs {
    private static final String PREFS = "safetube_parental_control";
    private static final String KEY_BLOCK_YOUTUBE = "block_youtube";
    private static final String KEY_BROWSER_FILTER = "browser_filter";
    private static final String KEY_WHITELIST = "whitelist_json";
    /** Epoch ms until which browser site-filter enforcement is skipped (app-opened Custom Tabs). */
    private static final String KEY_BROWSER_BYPASS_UNTIL = "browser_bypass_until";

    private ParentalControlPrefs() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void apply(Context ctx, boolean blockYoutube, boolean browserFilter, List<String> whitelist) {
        JSONArray arr = new JSONArray();
        if (whitelist != null) {
            for (String host : whitelist) {
                if (host == null) continue;
                String n = normalizeHost(host);
                if (!n.isEmpty()) arr.put(n);
            }
        }
        prefs(ctx).edit()
            .putBoolean(KEY_BLOCK_YOUTUBE, blockYoutube)
            .putBoolean(KEY_BROWSER_FILTER, browserFilter)
            .putString(KEY_WHITELIST, arr.toString())
            .commit();
        // Wake the accessibility service so YouTube is blocked immediately (no wait for next event).
        ParentalControlService.nudgePolicyChanged();
    }

    /** Temporarily skip browser whitelist enforcement (SafeTube-opened login / Custom Tabs). */
    public static void allowBrowserBypass(Context ctx, long durationMs) {
        long ms = Math.max(0L, Math.min(durationMs, 10L * 60L * 1000L));
        long until = System.currentTimeMillis() + ms;
        prefs(ctx).edit().putLong(KEY_BROWSER_BYPASS_UNTIL, until).apply();
    }

    public static void clearBrowserBypass(Context ctx) {
        prefs(ctx).edit().putLong(KEY_BROWSER_BYPASS_UNTIL, 0L).apply();
    }

    public static boolean isBrowserBypassActive(Context ctx) {
        long until = prefs(ctx).getLong(KEY_BROWSER_BYPASS_UNTIL, 0L);
        return until > 0L && System.currentTimeMillis() < until;
    }

    public static boolean isBlockYoutube(Context ctx) {
        return prefs(ctx).getBoolean(KEY_BLOCK_YOUTUBE, false);
    }

    public static boolean isBrowserFilter(Context ctx) {
        return prefs(ctx).getBoolean(KEY_BROWSER_FILTER, false);
    }

    public static List<String> getWhitelist(Context ctx) {
        List<String> out = new ArrayList<>();
        String raw = prefs(ctx).getString(KEY_WHITELIST, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                String n = normalizeHost(arr.optString(i, ""));
                if (!n.isEmpty()) out.add(n);
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        return out;
    }

    public static String normalizeHost(String input) {
        if (input == null) return "";
        String s = input.trim().toLowerCase();
        if (s.isEmpty()) return "";
        // Accept full URLs from the parent UI.
        s = s.replaceFirst("^https?://", "");
        int slash = s.indexOf('/');
        if (slash >= 0) s = s.substring(0, slash);
        int q = s.indexOf('?');
        if (q >= 0) s = s.substring(0, q);
        if (s.startsWith("www.")) s = s.substring(4);
        // Drop trailing dots / ports for matching
        int colon = s.indexOf(':');
        if (colon > 0) s = s.substring(0, colon);
        while (s.endsWith(".")) s = s.substring(0, s.length() - 1);
        return s;
    }

    public static boolean hostAllowed(String host, List<String> whitelist) {
        String h = normalizeHost(host);
        if (h.isEmpty()) return false;
        if (whitelist == null || whitelist.isEmpty()) return false;
        for (String allowed : whitelist) {
            if (h.equals(allowed) || h.endsWith("." + allowed)) return true;
        }
        return false;
    }

    public static boolean isYoutubeHost(String host) {
        String h = normalizeHost(host);
        return h.equals("youtu.be")
            || h.equals("youtube.com")
            || h.endsWith(".youtube.com")
            || h.equals("youtube-nocookie.com")
            || h.endsWith(".youtube-nocookie.com")
            || h.equals("m.youtube.com")
            || h.equals("music.youtube.com")
            || h.equals("www.youtube.com")
            || h.equals("youtubekids.com")
            || h.endsWith(".youtubekids.com");
    }
}
