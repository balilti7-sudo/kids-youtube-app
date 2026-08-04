package app.safetube.kids;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "ParentalControl")
public class ParentalControlPlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("accessibilityEnabled", isAccessibilityEnabled());
        out.put("blockYoutube", ParentalControlPrefs.isBlockYoutube(getContext()));
        out.put("browserFilterEnabled", ParentalControlPrefs.isBrowserFilter(getContext()));
        JSArray wl = new JSArray();
        for (String h : ParentalControlPrefs.getWhitelist(getContext())) {
            wl.put(h);
        }
        out.put("whitelist", wl);
        call.resolve(out);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Unable to open accessibility settings", e);
        }
    }

    @PluginMethod
    public void applyPolicy(PluginCall call) {
        boolean blockYoutube = Boolean.TRUE.equals(call.getBoolean("blockYoutube", false));
        boolean browserFilter = Boolean.TRUE.equals(call.getBoolean("browserFilterEnabled", false));
        List<String> whitelist = new ArrayList<>();
        JSArray arr = call.getArray("whitelist");
        if (arr != null) {
            try {
                for (int i = 0; i < arr.length(); i++) {
                    Object v = arr.get(i);
                    if (v != null) whitelist.add(String.valueOf(v));
                }
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        ParentalControlPrefs.apply(getContext(), blockYoutube, browserFilter, whitelist);
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("accessibilityEnabled", isAccessibilityEnabled());
        call.resolve(out);
    }

    /**
     * Skip browser site-filter for a short window so SafeTube can open Chrome Custom Tabs
     * (Google sign-in) without the accessibility service falsely blocking them.
     */
    @PluginMethod
    public void allowBrowserBypass(PluginCall call) {
        Integer duration = call.getInt("durationMs", 180_000);
        long ms = duration != null ? duration.longValue() : 180_000L;
        ParentalControlPrefs.allowBrowserBypass(getContext(), ms);
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("until", System.currentTimeMillis() + Math.max(0L, Math.min(ms, 10L * 60L * 1000L)));
        call.resolve(out);
    }

    @PluginMethod
    public void clearBrowserBypass(PluginCall call) {
        ParentalControlPrefs.clearBrowserBypass(getContext());
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    private boolean isAccessibilityEnabled() {
        Context ctx = getContext();
        AccessibilityManager am = (AccessibilityManager) ctx.getSystemService(Context.ACCESSIBILITY_SERVICE);
        if (am == null) return false;
        String myService = ctx.getPackageName() + "/.ParentalControlService";
        String myServiceFq = ParentalControlService.class.getName();
        List<AccessibilityServiceInfo> enabled = am.getEnabledAccessibilityServiceList(
            AccessibilityServiceInfo.FEEDBACK_ALL_MASK
        );
        if (enabled == null) return false;
        for (AccessibilityServiceInfo info : enabled) {
            if (info == null || info.getId() == null) continue;
            String id = info.getId();
            if (id.equals(myService) || id.endsWith("/.ParentalControlService") || id.contains(myServiceFq)) {
                return true;
            }
        }
        // Fallback: settings secure string
        try {
            String setting = Settings.Secure.getString(
                ctx.getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            if (setting != null && setting.contains(ctx.getPackageName()) && setting.contains("ParentalControlService")) {
                return true;
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        return false;
    }
}
