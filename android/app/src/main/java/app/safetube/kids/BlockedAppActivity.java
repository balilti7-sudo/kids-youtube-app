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
 * Full-screen block surface shown when a restricted app/site is opened.
 * Stays up briefly and repeatedly sends Home while YouTube (or another blocked
 * package) keeps trying to reclaim the foreground.
 */
public class BlockedAppActivity extends Activity {
    public static final String EXTRA_BLOCKED_PACKAGE = "blocked_package";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String blockedPackage = "";
    private int homePulses = 0;

    private final Runnable pulseHome = new Runnable() {
        @Override
        public void run() {
            goHome();
            homePulses++;
            if (homePulses < 8 && !isFinishing()) {
                handler.postDelayed(this, 350);
            } else if (!isFinishing()) {
                finish();
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        );

        if (getIntent() != null) {
            String pkg = getIntent().getStringExtra(EXTRA_BLOCKED_PACKAGE);
            if (pkg != null) blockedPackage = pkg;
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.setOnClickListener(v -> goHome());

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

        goHome();
        handler.postDelayed(pulseHome, 300);
        // Hard cap so we never leave a stuck white screen if enforcement already won.
        handler.postDelayed(this::finishSafely, 3200);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null) {
            String pkg = intent.getStringExtra(EXTRA_BLOCKED_PACKAGE);
            if (pkg != null) blockedPackage = pkg;
        }
        homePulses = 0;
        goHome();
    }

    private void goHome() {
        try {
            ParentalControlService svc = ParentalControlService.getInstance();
            if (svc != null) {
                svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME);
            }
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private void finishSafely() {
        if (!isFinishing()) finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        goHome();
    }
}
