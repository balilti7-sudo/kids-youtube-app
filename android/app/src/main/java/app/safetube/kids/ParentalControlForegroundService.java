package app.safetube.kids;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;

/**
 * Keeps SafeTube in a foreground process while YouTube blocking is active so Android
 * is less likely to kill the accessibility enforcement path.
 */
public class ParentalControlForegroundService extends Service {
    static final String ACTION_SYNC = "app.safetube.kids.action.PARENTAL_FG_SYNC";
    private static final String CHANNEL_ID = "safetube_parental_control";
    private static final int NOTIFICATION_ID = 41001;
    private static final long POLL_MS = 420L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable pollLoop =
        new Runnable() {
            @Override
            public void run() {
                if (!ParentalControlPrefs.isBlockYoutube(ParentalControlForegroundService.this)) {
                    stopSelfSafely();
                    return;
                }
                ParentalControlService.nudgePolicyChanged();
                handler.postDelayed(this, POLL_MS);
            }
        };

    /** Start or refresh the foreground watchdog when YouTube block is enabled. */
    public static void sync(Context ctx) {
        if (ctx == null) return;
        Context app = ctx.getApplicationContext();
        if (!ParentalControlPrefs.isBlockYoutube(app)) {
            stop(app);
            return;
        }
        try {
            Intent i = new Intent(app, ParentalControlForegroundService.class);
            i.setAction(ACTION_SYNC);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                app.startForegroundService(i);
            } else {
                app.startService(i);
            }
        } catch (Exception ignored) {
            /* ignore — accessibility path still works */
        }
    }

    public static void stop(Context ctx) {
        if (ctx == null) return;
        try {
            ctx.getApplicationContext().stopService(new Intent(ctx, ParentalControlForegroundService.class));
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!ParentalControlPrefs.isBlockYoutube(this)) {
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {
                stopSelfSafely();
                return START_NOT_STICKY;
            }
        }

        handler.removeCallbacks(pollLoop);
        handler.post(pollLoop);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopSelfSafely() {
        handler.removeCallbacksAndMessages(null);
        try {
            stopForeground(true);
        } catch (Exception ignored) {
            /* ignore */
        }
        stopSelf();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel =
            new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.parental_control_notification_channel),
                NotificationManager.IMPORTANCE_LOW
            );
        channel.setDescription(getString(R.string.parental_control_notification_channel_desc));
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi =
            PendingIntent.getActivity(
                this,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.parental_control_notification_title))
            .setContentText(getString(R.string.parental_control_notification_body))
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }
}
