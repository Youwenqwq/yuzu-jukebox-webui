package dev.uwen.yuzujukebox;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 进程级媒体会话单例：Capacitor 插件与前台服务共享同一份
 * 元数据/播放态/封面。动作来源有两个——系统 MediaSession 回调
 * （蓝牙/锁屏）与通知按钮——统一经 dispatchAction 派发给 JS 监听器。
 * 所有会话变更都 post 到主线程，避免桥线程直接操作 MediaSession。
 */
public class MediaSessionManager {

    /** 媒体动作出口：由插件注入，转发为 JS 事件。seek 动作携带 positionMs，其余为 -1。 */
    public interface ActionListener {
        void onMediaAction(String action, long positionMs);
    }

    /** 会话内容变更通知：由前台服务注入，用于刷新通知与唤醒锁。 */
    public interface Refresher {
        void onSessionChanged();
    }

    private static MediaSessionManager instance;

    public static synchronized MediaSessionManager getInstance(Context context) {
        if (instance == null) {
            instance = new MediaSessionManager(context.getApplicationContext());
        }
        return instance;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private final MediaSession session;

    private ActionListener actionListener;
    private Refresher refresher;

    private String title = "";
    private String artist = "";
    private String album = "";
    private String artworkUrl = "";
    private long durationMs = 0;
    private Bitmap artwork;
    /** 锁屏歌词（ColorOS lyricInfo JSON，协议见 docs）。空 = 无歌词，不写进 metadata。 */
    private String lyricInfo = "";
    /** 封面加载序号：异步回写时丢弃过期结果（切歌快于下载）。 */
    private int artworkSeq = 0;

    private boolean playing = false;

    private MediaSessionManager(Context context) {
        session = new MediaSession(context, "YuzuJukebox");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                dispatchAction("play");
            }

            @Override
            public void onPause() {
                dispatchAction("pause");
            }

            @Override
            public void onSkipToNext() {
                dispatchAction("next");
            }

            @Override
            public void onSeekTo(final long pos) {
                dispatchSeek(pos);
            }
        });
    }

    void setActionListener(ActionListener listener) {
        this.actionListener = listener;
    }

    void setRefresher(Refresher refresher) {
        this.refresher = refresher;
    }

    boolean isPlaying() {
        return playing;
    }

    String getTitle() {
        return title;
    }

    String getArtist() {
        return artist;
    }

    Bitmap getArtwork() {
        return artwork;
    }

    MediaSession.Token getSessionToken() {
        return session.getSessionToken();
    }

    /** 动作统一入口：通知按钮与系统回调都走这里，保证 JS 侧只收一种事件。 */
    void dispatchAction(final String action) {
        main.post(() -> {
            if (actionListener != null) {
                actionListener.onMediaAction(action, -1);
            }
        });
    }

    /** 锁屏进度条拖拽：携带目标位置（ms），是否受理由 JS 侧按控制权限决定。 */
    void dispatchSeek(final long positionMs) {
        main.post(() -> {
            if (actionListener != null) {
                actionListener.onMediaAction("seek", positionMs);
            }
        });
    }

    void setMetadata(final String title, final String artist, final String album, final String artworkUrl, final long durationMs) {
        main.post(() -> {
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.durationMs = durationMs;
            if (!artworkUrl.equals(this.artworkUrl)) {
                this.artworkUrl = artworkUrl;
                loadArtwork();
            }
            pushMetadata();
            notifyChanged();
        });
    }

    private void loadArtwork() {
        final String url = this.artworkUrl;
        final int seq = ++artworkSeq;
        artwork = null;
        if (url.isEmpty()) {
            return;
        }
        artworkExecutor.execute(() -> {
            Bitmap decoded = null;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                decoded = BitmapFactory.decodeStream(conn.getInputStream());
            } catch (Exception ignored) {
                // 封面加载失败不致命：通知与会话仅退回无图状态
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
            final Bitmap result = decoded;
            main.post(() -> {
                if (seq != artworkSeq) {
                    return;
                }
                artwork = result;
                pushMetadata();
                notifyChanged();
            });
        });
    }

    private void pushMetadata() {
        MediaMetadata.Builder builder = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) {
            builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        }
        if (!lyricInfo.isEmpty()) {
            builder.putString("lyricInfo", lyricInfo);
        }
        session.setMetadata(builder.build());
    }

    /** 锁屏歌词：完整 lyricInfo JSON（含时间轴 LRC）或 null 移除（切歌先清旧歌词）。
     *  事件驱动提交，勿周期推送；播放进度由 PlaybackState 提供。 */
    void setLyricInfo(final String lyricInfo) {
        main.post(() -> {
            this.lyricInfo = lyricInfo == null ? "" : lyricInfo;
            pushMetadata();
            notifyChanged();
        });
    }

    void setPlaybackState(final boolean playing, final long positionMs, final float rate) {
        main.post(() -> {
            this.playing = playing;
            PlaybackState.Builder builder = new PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY
                        | PlaybackState.ACTION_PAUSE
                        | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT
                        | PlaybackState.ACTION_SEEK_TO
                )
                .setState(
                    playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                    positionMs,
                    rate,
                    SystemClock.elapsedRealtime()
                );
            session.setPlaybackState(builder.build());
            session.setActive(true);
            notifyChanged();
        });
    }

    /** 离房/停止：会话归零并失活，媒体按钮不再路由到本 App。 */
    void clear() {
        main.post(() -> {
            playing = false;
            lyricInfo = "";
            session.setActive(false);
            session.setMetadata(null);
            session.setPlaybackState(
                new PlaybackState.Builder().setState(PlaybackState.STATE_NONE, 0, 0f).build()
            );
            notifyChanged();
        });
    }

    private void notifyChanged() {
        if (refresher != null) {
            refresher.onSessionChanged();
        }
    }
}
