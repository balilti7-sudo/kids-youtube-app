package app.safetube.kids;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Watches foreground apps. When parental policies are enabled:
 * - Strictly blocks YouTube family packages (Home + persistent white screen + poll)
 * - Blocks browser navigation outside the hostname whitelist (only when the
 *   address-bar host is confidently known — fail open otherwise)
 * - Also blocks youtube.com inside browsers when YouTube app block is on
 */
public class ParentalControlService extends AccessibilityService {
    private static ParentalControlService instance;

    private static final Set<String> YOUTUBE_PACKAGES = new HashSet<>(Arrays.asList(
        "com.google.android.youtube",
        "com.google.android.youtube.tv",
        "com.google.android.youtube.tvunplugged",
        "com.google.android.apps.youtube.kids",
        "com.google.android.apps.youtube.music",
        "com.google.android.apps.youtube.creator",
        "com.google.android.apps.youtube.mango", // YouTube Go
        "com.google.android.apps.youtube.unplugged",
        "com.vanced.android.youtube",
        "com.teamvanced.android.youtube",
        "app.revanced.android.youtube",
        "com.google.android.youtube.player"
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

    private static final long ENFORCE_POLL_MS = 280L;
    private static final long ENFORCE_MAX_MS = 12_000L;
    private static final long BLOCK_UI_COOLDOWN_MS = 450L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastBlockUiAt = 0L;
    private String enforcingPkg = null;
    private long enforceStartedAt = 0L;
    private boolean enforceLoopPosted = false;
    private Runnable pendingHostEval;

    private final Runnable enforceLoop = new Runnable() {
        @Override
        public void run() {
            enforceLoopPosted = false;
            if (!ParentalControlPrefs.isBlockYoutube(ParentalControlService.this)) {
                stopEnforcement();
                return;
            }
            String fg = resolveForegroundPackage();
            if (fg != null && isYoutubePackage(fg)) {
                enforcingPkg = fg;
                pushBlock(fg, false);
                scheduleEnforceLoop();
                return;
            }
            // Still within grace window after a YouTube open — keep watching briefly.
            if (enforcingPkg != null && System.currentTimeMillis() - enforceStartedAt < ENFORCE_MAX_MS) {
                scheduleEnforceLoop();
                return;
            }
            stopEnforcement();
        }
    };

    public static ParentalControlService getInstance() {
        return instance;
    }

    /** True for official YouTube family packages and common forks. */
    public static boolean isYoutubePackage(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        if (YOUTUBE_PACKAGES.contains(pkg)) return true;
        // Catch OEM / regional variants: com.google.android.youtube.* / apps.youtube.*
        return pkg.equals("com.google.android.youtube")
            || pkg.startsWith("com.google.android.youtube.")
            || pkg.startsWith("com.google.android.apps.youtube.")
            || (pkg.contains(".youtube")
                && (pkg.startsWith("com.google.")
                    || pkg.startsWith("app.revanced.")
                    || pkg.startsWith("com.vanced.")
                    || pkg.startsWith("com.teamvanced.")));
    }

    /** Called after policy prefs change so blocking starts without waiting for an event. */
    public static void nudgePolicyChanged() {
        ParentalControlService svc = instance;
        if (svc == null) return;
        svc.handler.post(svc::scanNow);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        // Re-apply immediately if the parent already enabled the toggle.
        handler.post(this::scanNow);
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        handler.removeCallbacksAndMessages(null);
        enforceLoopPosted = false;
        super.onDestroy();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        CharSequence pkgCs = event.getPackageName();
        String eventPkg = pkgCs != null ? pkgCs.toString() : null;
        if (eventPkg != null && eventPkg.equals(getPackageName())) {
            // Ignore our own UI except when evaluating after we leave it.
            return;
        }

        boolean blockYoutube = ParentalControlPrefs.isBlockYoutube(this);
        boolean browserFilter = ParentalControlPrefs.isBrowserFilter(this);
        if (!blockYoutube && !browserFilter) {
            stopEnforcement();
            return;
        }

        int type = event.getEventType();
        boolean interesting =
            type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                || type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                || type == AccessibilityEvent.TYPE_WINDOWS_CHANGED
                || type == AccessibilityEvent.TYPE_VIEW_FOCUSED;

        if (!interesting) return;

        if (blockYoutube) {
            String fg = eventPkg != null && isYoutubePackage(eventPkg)
                ? eventPkg
                : resolveForegroundPackage();
            if (fg != null && isYoutubePackage(fg)) {
                startEnforcement(fg);
                return;
            }
        }

        if (eventPkg == null || !BROWSER_PACKAGES.contains(eventPkg)) return;

        // App-initiated browser sessions (e.g. Google sign-in Custom Tab) temporarily skip site filter.
        if (ParentalControlPrefs.isBrowserBypassActive(this)) return;

        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            return;
        }

        scheduleBrowserEval(eventPkg, blockYoutube, browserFilter);
    }

    private void scanNow() {
        if (!ParentalControlPrefs.isBlockYoutube(this)) {
            stopEnforcement();
            return;
        }
        String fg = resolveForegroundPackage();
        if (fg != null && isYoutubePackage(fg)) {
            startEnforcement(fg);
        }
    }

    private void startEnforcement(String pkg) {
        enforcingPkg = pkg;
        enforceStartedAt = System.currentTimeMillis();
        pushBlock(pkg, true);
        scheduleEnforceLoop();
    }

    private void stopEnforcement() {
        enforcingPkg = null;
        enforceStartedAt = 0L;
        handler.removeCallbacks(enforceLoop);
        enforceLoopPosted = false;
    }

    private void scheduleEnforceLoop() {
        if (enforceLoopPosted) return;
        enforceLoopPosted = true;
        handler.postDelayed(enforceLoop, ENFORCE_POLL_MS);
    }

    /**
     * Best-effort foreground package from the active window tree / window list.
     * Needed because some OEMs omit packageName on WINDOWS_CHANGED events.
     */
    private String resolveForegroundPackage() {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) {
                try {
                    CharSequence pkg = root.getPackageName();
                    if (pkg != null && pkg.length() > 0) return pkg.toString();
                } finally {
                    root.recycle();
                }
            }
        } catch (Exception ignored) {
            /* ignore */
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                List<AccessibilityWindowInfo> windows = getWindows();
                if (windows != null) {
                    for (AccessibilityWindowInfo w : windows) {
                        if (w == null) continue;
                        try {
                            if (w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                            if (!w.isActive() && !w.isFocused()) continue;
                            AccessibilityNodeInfo root = w.getRoot();
                            if (root == null) continue;
                            try {
                                CharSequence pkg = root.getPackageName();
                                if (pkg != null && pkg.length() > 0) return pkg.toString();
                            } finally {
                                root.recycle();
                            }
                        } catch (Exception ignored) {
                            /* ignore */
                        }
                    }
                }
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        return null;
    }

    private void pushBlock(String pkg, boolean forceUi) {
        try {
            performGlobalAction(GLOBAL_ACTION_HOME);
        } catch (Exception ignored) {
            /* ignore */
        }

        long now = System.currentTimeMillis();
        if (!forceUi && now - lastBlockUiAt < BLOCK_UI_COOLDOWN_MS) return;
        lastBlockUiAt = now;

        try {
            Intent i = new Intent(this, BlockedAppActivity.class);
            i.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_NO_ANIMATION
                    | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
            );
            i.putExtra(BlockedAppActivity.EXTRA_BLOCKED_PACKAGE, pkg);
            startActivity(i);
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private void scheduleBrowserEval(String pkg, boolean blockYoutube, boolean browserFilter) {
        if (pendingHostEval != null) {
            handler.removeCallbacks(pendingHostEval);
        }
        pendingHostEval = () -> {
            pendingHostEval = null;
            String host = extractAddressBarHost();
            evaluateBrowserHost(pkg, host, blockYoutube, browserFilter);
        };
        handler.postDelayed(pendingHostEval, 350);
    }

    private void evaluateBrowserHost(String pkg, String host, boolean blockYoutube, boolean browserFilter) {
        if (host == null || host.isEmpty()) {
            return;
        }
        if (isInternalBrowserHost(host)) return;

        if (blockYoutube && ParentalControlPrefs.isYoutubeHost(host)) {
            startEnforcement(pkg);
            return;
        }
        if (browserFilter) {
            if (ParentalControlPrefs.isBrowserBypassActive(this)) return;
            List<String> whitelist = ParentalControlPrefs.getWhitelist(this);
            if (!ParentalControlPrefs.hostAllowed(host, whitelist)) {
                pushBlock(pkg, true);
            }
        }
    }

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
        if (s.contains(" ") && !s.contains("://")) return null;

        if (isInternalBrowserUrl(lower)) return null;

        Matcher m = URL_PATTERN.matcher(s);
        if (m.find()) {
            return ParentalControlPrefs.normalizeHost(m.group(1));
        }

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
            || h.endsWith(".googlechrome")
            || h.equals("googlechrome");
    }

    @Override
    public void onInterrupt() {
        /* no-op */
    }
}
