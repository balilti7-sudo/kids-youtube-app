package app.safetube.kids;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Watches foreground apps. When parental policies are enabled:
 * - Blocks YouTube app packages (Home + white screen)
 * - Blocks browser navigation outside the hostname whitelist (only when the
 *   address-bar host is confidently known — fail open otherwise)
 * - Also blocks youtube.com inside browsers when YouTube app block is on
 */
public class ParentalControlService extends AccessibilityService {
    private static ParentalControlService instance;

    private static final Set<String> YOUTUBE_PACKAGES = new HashSet<>(Arrays.asList(
        "com.google.android.youtube",
        "com.google.android.youtube.tv",
        "com.google.android.apps.youtube.kids",
        "com.google.android.apps.youtube.music",
        "com.vanced.android.youtube",
        "com.teamvanced.android.youtube",
        "app.revanced.android.youtube"
    ));

    private static final Set<String> BROWSER_PACKAGES = new HashSet<>(Arrays.asList(
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
        "org.mozilla.firefox",
        "org.mozilla.firefox_beta",
        "org.mozilla.focus",
        "com.opera.browser",
        "com.opera.mini.native",
        "com.microsoft.emmx",
        "com.brave.browser",
        "com.sec.android.app.sbrowser",
        "com.huawei.browser",
        "com.android.browser",
        "com.mi.globalbrowser",
        "com.duckduckgo.mobile.android",
        "com.vivaldi.browser",
        "com.kiwibrowser.browser"
    ));

    /** Common address-bar / omnibox view IDs across popular browsers. */
    private static final String[] ADDRESS_BAR_VIEW_IDS = new String[] {
        "com.android.chrome:id/url_bar",
        "com.android.chrome:id/search_box_text",
        "com.chrome.beta:id/url_bar",
        "com.chrome.dev:id/url_bar",
        "com.chrome.canary:id/url_bar",
        "org.mozilla.firefox:id/url_bar_title",
        "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
        "org.mozilla.firefox_beta:id/url_bar_title",
        "org.mozilla.focus:id/display_url",
        "com.sec.android.app.sbrowser:id/location_bar_edit_text",
        "com.microsoft.emmx:id/url_bar",
        "com.opera.browser:id/url_field",
        "com.brave.browser:id/url_bar",
        "com.brave.browser:id/search_box_text",
        "com.duckduckgo.mobile.android:id/omnibarTextInput",
        "com.vivaldi.browser:id/url_bar",
        "com.kiwibrowser.browser:id/url_bar",
        "com.mi.globalbrowser:id/url",
        "com.huawei.browser:id/url_bar"
    };

    private static final Pattern URL_PATTERN = Pattern.compile(
        "(?i)\\b(?:https?://)?((?:[a-z0-9-]+\\.)+[a-z]{2,})(?:[:/\\s]|$)"
    );

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastBlockAt = 0L;
    private String lastBlockedPkg = "";
    private Runnable pendingHostEval;

    public static ParentalControlService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        CharSequence pkgCs = event.getPackageName();
        if (pkgCs == null) return;
        String pkg = pkgCs.toString();
        if (pkg.equals(getPackageName())) return;

        boolean blockYoutube = ParentalControlPrefs.isBlockYoutube(this);
        boolean browserFilter = ParentalControlPrefs.isBrowserFilter(this);
        if (!blockYoutube && !browserFilter) return;

        if (blockYoutube && YOUTUBE_PACKAGES.contains(pkg)) {
            triggerBlock(pkg);
            return;
        }

        if (!BROWSER_PACKAGES.contains(pkg)) return;

        // App-initiated browser sessions (e.g. Google sign-in Custom Tab) temporarily skip site filter.
        if (ParentalControlPrefs.isBrowserBypassActive(this)) return;

        // Only act on window changes / content updates — ignore noisy minor events.
        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            return;
        }

        scheduleBrowserEval(pkg, blockYoutube, browserFilter);
    }

    private void scheduleBrowserEval(String pkg, boolean blockYoutube, boolean browserFilter) {
        if (pendingHostEval != null) {
            handler.removeCallbacks(pendingHostEval);
        }
        // Debounce rapid content-changed storms; address bar often fills a moment later.
        pendingHostEval = () -> {
            pendingHostEval = null;
            String host = extractAddressBarHost();
            evaluateBrowserHost(pkg, host, blockYoutube, browserFilter);
        };
        handler.postDelayed(pendingHostEval, 350);
    }

    private void evaluateBrowserHost(String pkg, String host, boolean blockYoutube, boolean browserFilter) {
        if (host == null || host.isEmpty()) {
            // Fail open: unknown / loading / NTP / inaccessible URL bar must NOT lock the device.
            return;
        }
        if (isInternalBrowserHost(host)) return;

        if (blockYoutube && ParentalControlPrefs.isYoutubeHost(host)) {
            triggerBlock(pkg);
            return;
        }
        if (browserFilter) {
            if (ParentalControlPrefs.isBrowserBypassActive(this)) return;
            List<String> whitelist = ParentalControlPrefs.getWhitelist(this);
            if (!ParentalControlPrefs.hostAllowed(host, whitelist)) {
                triggerBlock(pkg);
            }
        }
    }

    private void triggerBlock(String pkg) {
        long now = System.currentTimeMillis();
        if (pkg.equals(lastBlockedPkg) && now - lastBlockAt < 700) return;
        lastBlockedPkg = pkg;
        lastBlockAt = now;

        try {
            performGlobalAction(GLOBAL_ACTION_HOME);
        } catch (Exception ignored) {
            /* ignore */
        }

        try {
            Intent i = new Intent(this, BlockedAppActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NO_ANIMATION
                | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
            startActivity(i);
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    /**
     * Resolve the current page host from the browser address bar only.
     * Never scans page body text (that caused false blocks from links/ads in the tree).
     */
    private String extractAddressBarHost() {
        AccessibilityNodeInfo root = null;
        try {
            root = getRootInActiveWindow();
            if (root == null) return null;

            for (String viewId : ADDRESS_BAR_VIEW_IDS) {
                List<AccessibilityNodeInfo> nodes = null;
                try {
                    nodes = root.findAccessibilityNodeInfosByViewId(viewId);
                    if (nodes == null) continue;
                    for (AccessibilityNodeInfo node : nodes) {
                        if (node == null) continue;
                        String host = hostFromAddressBarText(textOf(node));
                        if (host != null) return host;
                    }
                } catch (Exception ignored) {
                    /* ignore */
                } finally {
                    if (nodes != null) {
                        for (AccessibilityNodeInfo n : nodes) {
                            if (n != null) n.recycle();
                        }
                    }
                }
            }

            // Fallback: first editable field that looks like an omnibox URL (not page inputs).
            return findHostInEditableOmnibox(root, 0);
        } catch (Exception e) {
            return null;
        } finally {
            if (root != null) root.recycle();
        }
    }

    private String findHostInEditableOmnibox(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 12) return null;
        if (node.isEditable()) {
            String host = hostFromAddressBarText(textOf(node));
            if (host != null) return host;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = null;
            try {
                child = node.getChild(i);
                String host = findHostInEditableOmnibox(child, depth + 1);
                if (host != null) return host;
            } finally {
                if (child != null) child.recycle();
            }
        }
        return null;
    }

    private static String textOf(AccessibilityNodeInfo node) {
        if (node == null) return null;
        CharSequence text = node.getText();
        if (text != null && text.length() > 0) return text.toString();
        CharSequence desc = node.getContentDescription();
        if (desc != null && desc.length() > 0) return desc.toString();
        return null;
    }

    private String hostFromAddressBarText(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.length() < 3) return null;

        // Omnibox placeholders / search mode — not a navigated host.
        String lower = s.toLowerCase(Locale.US);
        if (lower.startsWith("search")
            || lower.contains("search or type")
            || lower.contains("type a url")
            || lower.contains("enter url")
            || lower.contains("address bar")
            || lower.contains("חיפוש")
            || lower.contains("חפש או הקלד")
            || lower.contains("הקלד כתובת")) {
            return null;
        }
        // Multi-word search queries are not hosts (allow "https://ex.com/a b" rarity via ://).
        if (s.contains(" ") && !s.contains("://")) return null;

        if (isInternalBrowserUrl(lower)) return null;

        Matcher m = URL_PATTERN.matcher(s);
        if (m.find()) {
            return ParentalControlPrefs.normalizeHost(m.group(1));
        }

        // Bare hostname typed in the omnibox (e.g. "wikipedia.org")
        if (lower.matches("^(?:www\\.)?(?:[a-z0-9-]+\\.)+[a-z]{2,}$")) {
            return ParentalControlPrefs.normalizeHost(lower);
        }
        return null;
    }

    private static boolean isInternalBrowserUrl(String lower) {
        return lower.startsWith("chrome://")
            || lower.startsWith("chrome-native://")
            || lower.startsWith("chrome-extension://")
            || lower.startsWith("about:")
            || lower.startsWith("edge://")
            || lower.startsWith("brave://")
            || lower.startsWith("opera://")
            || lower.startsWith("samsunginternet://")
            || lower.startsWith("content://")
            || lower.startsWith("file://")
            || lower.equals("newtab")
            || lower.equals("ntp");
    }

    private static boolean isInternalBrowserHost(String host) {
        String h = ParentalControlPrefs.normalizeHost(host);
        return h.isEmpty()
            || h.equals("newtab")
            || h.equals("ntp")
            // Chrome sometimes exposes these as the "host" of internal pages.
            || h.endsWith(".googlechrome")
            || h.equals("googlechrome");
    }

    @Override
    public void onInterrupt() {
        /* no-op */
    }
}
