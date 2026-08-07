package dev.uwen.yuzujukebox;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.ServiceCompat;

/**
 * 播放保活前台服务：mediaPlayback 类型 + 播放期 partial wake lock。
 * 这是整个 Android 壳存在的第一理由——进程被 OEM 省电杀掉时
 * WebView 内的 <audio> 随之静默；有前台服务则进程与解码都被保留。
 * 通知内容完全镜像 MediaSessionManager 的当前状态（Refresher 回调驱动）。
 */
public class YuzuPlaybackService extends Service implements MediaSessionManager.Refresher {

    public static final String ACTION_START = "dev.uwen.yuzujukebox.action.START";
    public static final String ACTION_TOGGLE = "dev.uwen.yuzujukebox.action.TOGGLE";
    public static final String ACTION_NEXT = "dev.uwen.yuzujukebox.action.NEXT";
    public static final String ACTION_REFRESH = "dev.uwen.yuzujukebox.action.REFRESH";

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 941;

    private MediaSessionManager manager;
    private PowerManager.WakeLock wakeLock;
    private boolean foreground = false;

    @Override
    public void onCreate() {
        super.onCreate();
        manager = MediaSessionManager.getInstance(this);
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yuzu:playback");
        wakeLock.setReferenceCounted(false);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) {
            action = ACTION_REFRESH;
        }
        switch (action) {
            case ACTION_START:
                manager.setRefresher(this);
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    buildNotification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
                foreground = true;
                break;
            case ACTION_TOGGLE:
                manager.dispatchAction(manager.isPlaying() ? "pause" : "play");
                break;
            case ACTION_NEXT:
                manager.dispatchAction("next");
                break;
            default:
                break;
        }
        if (foreground) {
            onSessionChanged();
        }
        return START_STICKY;
    }

    /** 会话内容变更（元数据/播放态/封面）：就地刷新通知，唤醒锁跟随 playing。 */
    @Override
    public void onSessionChanged() {
        if (!foreground) {
            return;
        }
        NotificationManager notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        notificationManager.notify(NOTIFICATION_ID, buildNotification());
        if (manager.isPlaying()) {
            if (!wakeLock.isHeld()) {
                wakeLock.acquire();
            }
        } else if (wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    /** 用户划掉任务：WebView 已死，服务一并退出，避免幽灵保活。 */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        foreground = false;
        manager.setRefresher(null);
        manager.clear();
        if (wakeLock.isHeld()) {
            wakeLock.release();
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_playback),
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setShowBadge(false);
            NotificationManager notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            notificationManager.createNotificationChannel(channel);
        }
    }

    private PendingIntent serviceIntent(String action) {
        Intent intent = new Intent(this, YuzuPlaybackService.class).setAction(action);
        return PendingIntent.getService(
            this,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    // API 24-25 无通知渠道，只能走旧构造器（警告在此压注，不用 compat 是因为
    // MediaStyle 需要 framework MediaSession.Token，与 compat Style 不互通）
    @SuppressWarnings("deprecation")
    private Notification buildNotification() {
        Intent launch = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        boolean playing = manager.isPlaying();
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(manager.getTitle())
            .setContentText(manager.getArtist())
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(playing);
        if (manager.getArtwork() != null) {
            builder.setLargeIcon(manager.getArtwork());
        }

        Notification.Action toggle = new Notification.Action.Builder(
            Icon.createWithResource(
                this,
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play
            ),
            getString(playing ? R.string.notification_pause : R.string.notification_play),
            serviceIntent(ACTION_TOGGLE)
        ).build();
        Notification.Action next = new Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_media_next),
            getString(R.string.notification_next),
            serviceIntent(ACTION_NEXT)
        ).build();
        builder.addAction(toggle);
        builder.addAction(next);

        Notification.MediaStyle style = new Notification.MediaStyle()
            .setMediaSession(manager.getSessionToken())
            .setShowActionsInCompactView(0, 1);
        builder.setStyle(style);
        return builder.build();
    }
}
