package app.safetube.kids;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.accessibilityservice.AccessibilityService;

/**
 * Full-screen white block surface shown when a restricted app/site is opened.
 * Immediately also sends the user Home via the accessibility service.
 */
public class BlockedAppActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.setOnClickListener(v -> goHomeAndFinish());

        TextView label = new TextView(this);
        label.setText(R.string.blocked_by_safetube);
        label.setTextColor(Color.parseColor("#BBBBBB"));
        label.setTextSize(14f);
        label.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        root.addView(label, lp);
        setContentView(root);

        // Keep white screen briefly so YouTube/browser never shows content, then Home.
        handler.postDelayed(this::goHomeAndFinish, 900);
    }

    private void goHomeAndFinish() {
        try {
            ParentalControlService svc = ParentalControlService.getInstance();
            if (svc != null) {
                svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME);
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        goHomeAndFinish();
    }
}
