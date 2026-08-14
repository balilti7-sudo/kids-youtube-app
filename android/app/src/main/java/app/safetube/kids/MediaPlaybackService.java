package app.safetube.kids;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.ResultReceiver;
import android.os.SystemClock;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.view.KeyEvent;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground media service with a real {@link MediaSessionCompat} so lock screen,
 * Bluetooth AVRCP (car / headset), Android Auto "Now Playing", and system media
 * controls can drive playback. Extends {@link MediaBrowserServiceCompat} so car
 * platforms can bind to the active session.
 *
 * Transport commands are forwarded into the Capacitor WebView via {@link MediaPlaybackPlugin}.
 * Hardware volume keys adjust {@link AudioManager#STREAM_MUSIC} (hands-free safe).
 */
public class MediaPlaybackService extends MediaBrowserServiceCompat
    implements AudioManager.OnAudioFocusChangeListener {

    public static final String CHANNEL_ID = "safetube_playback";
    public static final int NOTIFICATION_ID = 4401;
    private static final String MEDIA_ROOT_ID = "safetube_root";
    private static final String MEDIA_NOW_PLAYING_ID = "safetube_now_playing";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_DURATION_MS = "durationMs";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_ARTWORK_URL = "artworkUrl";
    public static final String EXTRA_CAN_SKIP_NEXT = "canSkipNext";
    public static final String EXTRA_CAN_SKIP_PREV = "canSkipPrev";

    public static final String ACTION_STOP = "app.safetube.kids.STOP_PLAYBACK";
    public static final String ACTION_UPDATE = "app.safetube.kids.UPDATE_SESSION";
    public static final String ACTION_PLAY = "app.safetube.kids.MEDIA_PLAY";
    public static final String ACTION_PAUSE = "app.safetube.kids.MEDIA_PAUSE";
    public static final String ACTION_NEXT = "app.safetube.kids.MEDIA_NEXT";
    public static final String ACTION_PREV = "app.safetube.kids.MEDIA_PREV";
    public static final String ACTION_FF = "app.safetube.kids.MEDIA_FF";
    public static final String ACTION_REW = "app.safetube.kids.MEDIA_REW";

    private static final long SEEK_STEP_MS = 10_000L;

    private static volatile boolean active = false;
    private static volatile MediaPlaybackService instance;

    private PowerManager.WakeLock wakeLock;
    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();

    private String title = "SafeTube";
    private String artist = "מתנגן עכשיו";
    private String artworkUrl = null;
    private long durationMs = 0L;
    private long positionMs = 0L;
    private boolean playing = true;
    private boolean canSkipNext = true;
    private boolean canSkipPrev = true;
    private Bitmap artworkBitmap = null;
    private String loadedArtworkUrl = null;

    public static boolean isActive() {
        return active;
    }

    /** Push live metadata / playback state from the Capacitor plugin. */
    public static void updateFromPlugin(
        String title,
        String artist,
        long durationMs,
        long positionMs,
        boolean playing,
        String artworkUrl,
        boolean canSkipNext,
        boolean canSkipPrev
    ) {
        MediaPlaybackService svc = instance;
        if (svc == null) return;
        svc.mainHandler.post(() ->
            svc.applySessionUpdate(title, artist, durationMs, positionMs, playing, artworkUrl, canSkipNext, canSkipPrev)
        );
    }

    /** Route Activity / headset key events into the active MediaSession when possible. */
    public static boolean dispatchMediaKeyEvent(@Nullable KeyEvent event) {
        if (event == null) return false;
        MediaPlaybackService svc = instance;
        if (svc == null || svc.mediaSession == null || !active) return false;
        try {
            return svc.mediaSession.getController().dispatchMediaButtonEvent(event);
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);

        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SafeTube:MediaPlayback");
            wakeLock.setReferenceCounted(false);
        }

        ComponentName mediaButtonReceiver = new ComponentName(this, MediaButtonReceiver.class);
        mediaSession = new MediaSessionCompat(this, "SafeTubeMedia", mediaButtonReceiver, null);
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        Intent mediaButtonIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        mediaButtonIntent.setClass(this, MediaButtonReceiver.class);
        PendingIntent mediaButtonPendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            mediaButtonIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        mediaSession.setMediaButtonReceiver(mediaButtonPendingIntent);

        Intent sessionActivity = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (sessionActivity == null) {
            sessionActivity = new Intent(this, MainActivity.class);
        }
        sessionActivity.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivityPi = PendingIntent.getActivity(
            this,
            1,
            sessionActivity,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        mediaSession.setSessionActivity(sessionActivityPi);

        // Route car / Bluetooth absolute volume to the music stream (hands-free volume rocker).
        try {
            mediaSession.setPlaybackToLocal(AudioManager.STREAM_MUSIC);
        } catch (Exception ignored) {
            /* ignore on older devices */
        }

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                requestAudioFocus();
                emit("play", null);
                playing = true;
                publishPlaybackState();
                refreshNotification();
                notifyChildrenChanged(MEDIA_ROOT_ID);
            }

            @Override
            public void onPause() {
                emit("pause", null);
                playing = false;
                publishPlaybackState();
                refreshNotification();
                notifyChildrenChanged(MEDIA_ROOT_ID);
            }

            @Override
            public void onStop() {
                emit("pause", null);
                playing = false;
                abandonAudioFocus();
                stopPlayback();
            }

            @Override
            public void onSkipToNext() {
                emit("next", null);
            }

            @Override
            public void onSkipToPrevious() {
                emit("previous", null);
            }

            @Override
            public void onSeekTo(long pos) {
                positionMs = Math.max(0L, pos);
                emit("seekto", positionMs);
                publishPlaybackState();
            }

            @Override
            public void onFastForward() {
                long next = positionMs + SEEK_STEP_MS;
                if (durationMs > 0) next = Math.min(next, durationMs);
                positionMs = next;
                emit("seekforward", SEEK_STEP_MS);
                publishPlaybackState();
            }

            @Override
            public void onRewind() {
                positionMs = Math.max(0L, positionMs - SEEK_STEP_MS);
                emit("seekbackward", SEEK_STEP_MS);
                publishPlaybackState();
            }

            @Override
            public boolean onMediaButtonEvent(Intent mediaButtonEvent) {
                if (mediaButtonEvent == null) return super.onMediaButtonEvent(mediaButtonEvent);
                KeyEvent key = mediaButtonEvent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                if (key == null) return super.onMediaButtonEvent(mediaButtonEvent);
                if (key.getAction() != KeyEvent.ACTION_DOWN) {
                    return true;
                }
                // Prefer explicit handling so stubborn head units / BT stacks stay reliable.
                switch (key.getKeyCode()) {
                    case KeyEvent.KEYCODE_MEDIA_PLAY:
                        onPlay();
                        return true;
                    case KeyEvent.KEYCODE_MEDIA_PAUSE:
                        onPause();
                        return true;
                    case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                    case KeyEvent.KEYCODE_HEADSETHOOK:
                        if (playing) onPause();
                        else onPlay();
                        return true;
                    case KeyEvent.KEYCODE_MEDIA_STOP:
                        onStop();
                        return true;
                    case KeyEvent.KEYCODE_MEDIA_NEXT:
                        onSkipToNext();
                        return true;
                    case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                        onSkipToPrevious();
                        return true;
                    case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                        onFastForward();
                        return true;
                    case KeyEvent.KEYCODE_MEDIA_REWIND:
                        onRewind();
                        return true;
                    case KeyEvent.KEYCODE_VOLUME_UP:
                        adjustMusicVolume(AudioManager.ADJUST_RAISE);
                        return true;
                    case KeyEvent.KEYCODE_VOLUME_DOWN:
                        adjustMusicVolume(AudioManager.ADJUST_LOWER);
                        return true;
                    case KeyEvent.KEYCODE_VOLUME_MUTE:
                        adjustMusicVolume(AudioManager.ADJUST_TOGGLE_MUTE);
                        return true;
                    default:
                        return super.onMediaButtonEvent(mediaButtonEvent);
                }
            }

            @Override
            public void onCommand(String command, Bundle extras, ResultReceiver cb) {
                // Some OEM / car stacks send custom volume commands.
                if ("android.media.session.command.ADJUST_VOLUME".equals(command) && extras != null) {
                    int direction = extras.getInt("android.media.VOLUME_CONTROL_DIRECTION", 0);
                    if (direction > 0) adjustMusicVolume(AudioManager.ADJUST_RAISE);
                    else if (direction < 0) adjustMusicVolume(AudioManager.ADJUST_LOWER);
                    if (cb != null) cb.send(0, null);
                    return;
                }
                super.onCommand(command, extras, cb);
            }
        });

        setSessionToken(mediaSession.getSessionToken());
        mediaSession.setActive(true);
        publishMetadata();
        publishPlaybackState();
    }

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        // Allow Android Auto / system UI / Bluetooth stacks to browse the active session.
        return new BrowserRoot(MEDIA_ROOT_ID, null);
    }

    @Override
    public void onLoadChildren(
        @NonNull String parentId,
        @NonNull Result<List<MediaBrowserCompat.MediaItem>> result
    ) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (MEDIA_ROOT_ID.equals(parentId) && active) {
            MediaMetadataCompat meta = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, MEDIA_NOW_PLAYING_ID)
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, Math.max(0L, durationMs))
                .build();
            items.add(
                new MediaBrowserCompat.MediaItem(
                    meta.getDescription(),
                    MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
                )
            );
        }
        result.sendResult(items);
    }

    private void adjustMusicVolume(int direction) {
        if (audioManager == null) return;
        try {
            audioManager.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                direction,
                AudioManager.FLAG_SHOW_UI
            );
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_STICKY;
        }

        // MediaButtonReceiver forwards ACTION_MEDIA_BUTTON here when the session is alive.
        MediaButtonReceiver.handleIntent(mediaSession, intent);

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopPlayback();
            return START_NOT_STICKY;
        }

        if (ACTION_PLAY.equals(action)) {
            if (mediaSession != null && mediaSession.getController() != null) {
                mediaSession.getController().getTransportControls().play();
            }
            return START_STICKY;
        }
        if (ACTION_PAUSE.equals(action)) {
            if (mediaSession != null && mediaSession.getController() != null) {
                mediaSession.getController().getTransportControls().pause();
            }
            return START_STICKY;
        }
        if (ACTION_NEXT.equals(action)) {
            if (mediaSession != null && mediaSession.getController() != null) {
                mediaSession.getController().getTransportControls().skipToNext();
            } else {
                emit("next", null);
            }
            return START_STICKY;
        }
        if (ACTION_PREV.equals(action)) {
            if (mediaSession != null && mediaSession.getController() != null) {
                mediaSession.getController().getTransportControls().skipToPrevious();
            } else {
                emit("previous", null);
            }
            return START_STICKY;
        }
        if (ACTION_FF.equals(action)) {
            if (mediaSession != null) mediaSession.getController().getTransportControls().fastForward();
            return START_STICKY;
        }
        if (ACTION_REW.equals(action)) {
            if (mediaSession != null) mediaSession.getController().getTransportControls().rewind();
            return START_STICKY;
        }

        if (ACTION_UPDATE.equals(action)) {
            applySessionUpdate(
                intent.getStringExtra(EXTRA_TITLE),
                intent.getStringExtra(EXTRA_ARTIST),
                intent.getLongExtra(EXTRA_DURATION_MS, durationMs),
                intent.getLongExtra(EXTRA_POSITION_MS, positionMs),
                intent.getBooleanExtra(EXTRA_PLAYING, playing),
                intent.getStringExtra(EXTRA_ARTWORK_URL),
                intent.getBooleanExtra(EXTRA_CAN_SKIP_NEXT, canSkipNext),
                intent.getBooleanExtra(EXTRA_CAN_SKIP_PREV, canSkipPrev)
            );
            return START_STICKY;
        }

        String nextTitle = intent.getStringExtra(EXTRA_TITLE);
        String nextArtist = intent.getStringExtra(EXTRA_ARTIST);
        if (nextTitle != null && !nextTitle.isEmpty()) title = nextTitle;
        if (nextArtist != null && !nextArtist.isEmpty()) artist = nextArtist;
        if (intent.hasExtra(EXTRA_DURATION_MS)) durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L);
        if (intent.hasExtra(EXTRA_POSITION_MS)) positionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L);
        if (intent.hasExtra(EXTRA_PLAYING)) playing = intent.getBooleanExtra(EXTRA_PLAYING, true);
        if (intent.hasExtra(EXTRA_ARTWORK_URL)) artworkUrl = intent.getStringExtra(EXTRA_ARTWORK_URL);
        if (intent.hasExtra(EXTRA_CAN_SKIP_NEXT)) canSkipNext = intent.getBooleanExtra(EXTRA_CAN_SKIP_NEXT, true);
        if (intent.hasExtra(EXTRA_CAN_SKIP_PREV)) canSkipPrev = intent.getBooleanExtra(EXTRA_CAN_SKIP_PREV, true);

        active = true;
        requestAudioFocus();
        acquireWakeLock();
        if (mediaSession != null) {
            try {
                mediaSession.setActive(true);
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        publishMetadata();
        publishPlaybackState();
        maybeLoadArtwork();
        notifyChildrenChanged(MEDIA_ROOT_ID);

        try {
            Notification notification = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            active = false;
            stopSelf();
            return START_NOT_STICKY;
        }

        return START_STICKY;
    }

    private void applySessionUpdate(
        String nextTitle,
        String nextArtist,
        long nextDurationMs,
        long nextPositionMs,
        boolean nextPlaying,
        String nextArtworkUrl,
        boolean nextCanSkipNext,
        boolean nextCanSkipPrev
    ) {
        boolean metaChanged = false;
        boolean playingChanged = nextPlaying != playing;
        boolean artworkChanged = false;

        if (nextTitle != null && !nextTitle.isEmpty() && !nextTitle.equals(title)) {
            title = nextTitle;
            metaChanged = true;
        }
        if (nextArtist != null && !nextArtist.isEmpty() && !nextArtist.equals(artist)) {
            artist = nextArtist;
            metaChanged = true;
        }
        if (nextDurationMs >= 0 && nextDurationMs != durationMs) {
            durationMs = nextDurationMs;
            metaChanged = true;
        }
        if (nextPositionMs >= 0) positionMs = nextPositionMs;
        if (nextCanSkipNext != canSkipNext) {
            canSkipNext = nextCanSkipNext;
            metaChanged = true;
        }
        if (nextCanSkipPrev != canSkipPrev) {
            canSkipPrev = nextCanSkipPrev;
            metaChanged = true;
        }
        if (nextArtworkUrl != null) {
            String normalized = nextArtworkUrl.isEmpty() ? null : nextArtworkUrl;
            if (normalized == null ? artworkUrl != null : !normalized.equals(artworkUrl)) {
                artworkUrl = normalized;
                artworkChanged = true;
                metaChanged = true;
            }
        }

        playing = nextPlaying;

        if (playingChanged && playing) {
            requestAudioFocus();
        }

        if (metaChanged) {
            publishMetadata();
            notifyChildrenChanged(MEDIA_ROOT_ID);
        }
        publishPlaybackState();
        if (artworkChanged) {
            maybeLoadArtwork();
        }
        if (metaChanged || playingChanged) {
            refreshNotification();
        }
    }

    private void emit(String action, Long seekToMs) {
        MediaPlaybackPlugin.emitMediaAction(action, seekToMs);
    }

    private void publishMetadata() {
        if (mediaSession == null) return;
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, MEDIA_NOW_PLAYING_ID)
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "SafeTube Kids")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, Math.max(0L, durationMs));

        if (artworkUrl != null && !artworkUrl.isEmpty()) {
            meta.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, artworkUrl);
            meta.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, artworkUrl);
            try {
                meta.putString(MediaMetadataCompat.METADATA_KEY_ART_URI, artworkUrl);
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        if (artworkBitmap != null && !artworkBitmap.isRecycled()) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artworkBitmap);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artworkBitmap);
        }
        try {
            mediaSession.setMetadata(meta.build());
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private void publishPlaybackState() {
        if (mediaSession == null) return;
        long actions =
            PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_STOP
                | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_FAST_FORWARD
                | PlaybackStateCompat.ACTION_REWIND;
        if (canSkipNext) actions |= PlaybackStateCompat.ACTION_SKIP_TO_NEXT;
        if (canSkipPrev) actions |= PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;

        int state = playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, positionMs, playing ? 1.0f : 0f, SystemClock.elapsedRealtime())
            .build();
        try {
            mediaSession.setPlaybackState(playbackState);
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private void maybeLoadArtwork() {
        final String url = artworkUrl;
        if (url == null || url.isEmpty()) return;
        if (url.equals(loadedArtworkUrl) && artworkBitmap != null) return;
        artworkExecutor.execute(() -> {
            Bitmap bmp = downloadBitmap(url, 512);
            if (bmp == null) return;
            mainHandler.post(() -> {
                if (artworkBitmap != null && artworkBitmap != bmp && !artworkBitmap.isRecycled()) {
                    artworkBitmap.recycle();
                }
                artworkBitmap = bmp;
                loadedArtworkUrl = url;
                publishMetadata();
                refreshNotification();
            });
        });
    }

    private static Bitmap downloadBitmap(String urlStr, int maxEdge) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();
            if (conn.getResponseCode() != 200) return null;
            try (InputStream in = conn.getInputStream()) {
                Bitmap raw = BitmapFactory.decodeStream(in);
                if (raw == null) return null;
                int w = raw.getWidth();
                int h = raw.getHeight();
                int edge = Math.max(w, h);
                if (edge <= maxEdge) return raw;
                float scale = maxEdge / (float) edge;
                Bitmap scaled = Bitmap.createScaledBitmap(
                    raw,
                    Math.max(1, Math.round(w * scale)),
                    Math.max(1, Math.round(h * scale)),
                    true
                );
                if (scaled != raw) raw.recycle();
                return scaled;
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private boolean requestAudioFocus() {
        if (audioManager == null) return false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequest == null) {
                    audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(
                            new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                                .build()
                        )
                        .setOnAudioFocusChangeListener(this)
                        .setAcceptsDelayedFocusGain(true)
                        .build();
                }
                int res = audioManager.requestAudioFocus(audioFocusRequest);
                return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                    || res == AudioManager.AUDIOFOCUS_REQUEST_DELAYED;
            }
            @SuppressWarnings("deprecation")
            int res = audioManager.requestAudioFocus(
                this,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
            return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } catch (Exception e) {
            return false;
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                @SuppressWarnings("deprecation")
                int ignored = audioManager.abandonAudioFocus(this);
            }
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    @Override
    public void onAudioFocusChange(int focusChange) {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                emit("pause", null);
                playing = false;
                publishPlaybackState();
                refreshNotification();
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                /* keep playing — system volume ducking is enough */
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                emit("play", null);
                playing = true;
                publishPlaybackState();
                refreshNotification();
                break;
            default:
                break;
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(4 * 60 * 60 * 1000L);
            }
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private void stopPlayback() {
        active = false;
        abandonAudioFocus();
        releaseWakeLock();
        try {
            if (mediaSession != null) mediaSession.setActive(false);
        } catch (Exception ignored) {
            /* ignore */
        }
        try {
            notifyChildrenChanged(MEDIA_ROOT_ID);
        } catch (Exception ignored) {
            /* ignore */
        }
        try {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {
            /* ignore */
        }
        stopSelf();
    }

    private PendingIntent serviceAction(String action, int requestCode) {
        Intent i = new Intent(this, MediaPlaybackService.class);
        i.setAction(action);
        return PendingIntent.getService(
            this,
            requestCode,
            i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void refreshNotification() {
        if (!active) return;
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private Notification buildNotification() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launch != null ? launch : new Intent(this, MainActivity.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);

        if (artworkBitmap != null && !artworkBitmap.isRecycled()) {
            builder.setLargeIcon(artworkBitmap);
        }

        builder.addAction(new NotificationCompat.Action(
            android.R.drawable.ic_media_previous,
            "Previous",
            serviceAction(ACTION_PREV, 11)
        ));
        if (playing) {
            builder.addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_pause,
                "Pause",
                serviceAction(ACTION_PAUSE, 12)
            ));
        } else {
            builder.addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_play,
                "Play",
                serviceAction(ACTION_PLAY, 13)
            ));
        }
        builder.addAction(new NotificationCompat.Action(
            android.R.drawable.ic_media_next,
            "Next",
            serviceAction(ACTION_NEXT, 14)
        ));

        if (mediaSession != null) {
            builder.setStyle(
                new MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
                    .setCancelButtonIntent(serviceAction(ACTION_STOP, 15))
                    .setShowCancelButton(true)
            );
        }

        return builder.build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "SafeTube Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("System media controls for SafeTube playback");
        channel.setShowBadge(false);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        active = false;
        if (instance == this) instance = null;
        abandonAudioFocus();
        releaseWakeLock();
        artworkExecutor.shutdownNow();
        try {
            if (mediaSession != null) {
                mediaSession.setActive(false);
                mediaSession.release();
                mediaSession = null;
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        if (artworkBitmap != null && !artworkBitmap.isRecycled()) {
            artworkBitmap.recycle();
            artworkBitmap = null;
        }
        super.onDestroy();
    }
}
