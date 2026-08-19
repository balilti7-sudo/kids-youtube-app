package app.safetube.kids;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ChildDisplay")
public class ChildDisplayPlugin extends Plugin {

    @PluginMethod
    public void setHideThumbnails(PluginCall call) {
        Boolean hide = call.getBoolean("hide", false);
        ChildDisplayPrefs.setHideThumbnails(getContext(), Boolean.TRUE.equals(hide));
        call.resolve();
    }
}
