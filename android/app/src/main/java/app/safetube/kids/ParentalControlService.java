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
 * - Blocks browser navigation outside the hostname whitelist
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

    private static final Pattern URL_PATTERN = Pattern.compile(
        "(?i)\\b(?:https?://)?((?:[a-z0-9-]+\\.)+[a-z]{2,})(?:[:/\\s]|$)"
    );

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastBlockAt = 0L;
    private String lastBlockedPkg = "";

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

        // Always inspect browser URL when either policy needs it.
        String host = extractHostFromEvent(event);
        if (host == null || host.isEmpty()) {
            // Content may not be ready yet — retry shortly once.
            handler.postDelayed(() -> {
                String retryHost = extractHostFromRoot();
                evaluateBrowserHost(pkg, retryHost, blockYoutube, browserFilter);
            }, 250);
            return;
        }
        evaluateBrowserHost(pkg, host, blockYoutube, browserFilter);
    }

    private void evaluateBrowserHost(String pkg, String host, boolean blockYoutube, boolean browserFilter) {
        if (host == null || host.isEmpty()) {
            // Unknown page while filter is on → block (deny-by-default).
            if (browserFilter) triggerBlock(pkg);
            return;
        }
        if (blockYoutube && ParentalControlPrefs.isYoutubeHost(host)) {
            triggerBlock(pkg);
            return;
        }
        if (browserFilter) {
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

    private String extractHostFromEvent(AccessibilityEvent event) {
        AccessibilityNodeInfo root = null;
        try {
            root = getRootInActiveWindow();
            if (root != null) {
                String fromRoot = findHostInNode(root, 0);
                if (fromRoot != null) return fromRoot;
            }
        } catch (Exception ignored) {
            /* ignore */
        } finally {
            if (root != null) root.recycle();
        }

        if (event.getText() != null) {
            for (CharSequence cs : event.getText()) {
                String host = hostFromText(cs != null ? cs.toString() : null);
                if (host != null) return host;
            }
        }
        return null;
    }

    private String extractHostFromRoot() {
        AccessibilityNodeInfo root = null;
        try {
            root = getRootInActiveWindow();
            if (root == null) return null;
            return findHostInNode(root, 0);
        } catch (Exception e) {
            return null;
        } finally {
            if (root != null) root.recycle();
        }
    }

    private String findHostInNode(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 18) return null;

        CharSequence text = node.getText();
        String host = hostFromText(text != null ? text.toString() : null);
        if (host != null) return host;

        CharSequence desc = node.getContentDescription();
        host = hostFromText(desc != null ? desc.toString() : null);
        if (host != null) return host;

        // Prefer editable URL bars (Chrome address field).
        if (node.isEditable()) {
            host = hostFromText(text != null ? text.toString() : null);
            if (host != null) return host;
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = null;
            try {
                child = node.getChild(i);
                host = findHostInNode(child, depth + 1);
                if (host != null) return host;
            } finally {
                if (child != null) child.recycle();
            }
        }
        return null;
    }

    private String hostFromText(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.length() < 3) return null;
        // Skip obvious non-URLs
        if (s.contains(" ") && !s.contains("://") && !s.contains(".")) return null;

        Matcher m = URL_PATTERN.matcher(s);
        if (m.find()) {
            return ParentalControlPrefs.normalizeHost(m.group(1));
        }

        // Bare hostname typed in the omnibox (e.g. "wikipedia.org")
        String lower = s.toLowerCase(Locale.US);
        if (lower.matches("^(?:www\\.)?(?:[a-z0-9-]+\\.)+[a-z]{2,}$")) {
            return ParentalControlPrefs.normalizeHost(lower);
        }
        return null;
    }

    @Override
    public void onInterrupt() {
        /* no-op */
    }
}
