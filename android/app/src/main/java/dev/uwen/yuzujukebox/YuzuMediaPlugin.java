package dev.uwen.yuzujukebox;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Web 侧媒体桥：JS 推送元数据/播放态，原生回发媒体动作事件。
 * 保活服务在「房间有当前曲目」期间常驻；电池优化白名单只做查询与跳转，
 * 授予与否由系统对话框决定。
 */
@CapacitorPlugin(name = "YuzuMedia")
public class YuzuMediaPlugin extends Plugin {

    private static final int REQ_POST_NOTIFICATIONS = 9411;

    private MediaSessionManager manager;

    @Override
    public void load() {
        manager = MediaSessionManager.getInstance(getContext());
        manager.setActionListener((action, positionMs) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            if (positionMs >= 0) {
                data.put("positionMs", positionMs);
            }
            notifyListeners("action", data);
        });
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        manager.setMetadata(
            nullToEmpty(call.getString("title")),
            nullToEmpty(call.getString("artist")),
            nullToEmpty(call.getString("album")),
            nullToEmpty(call.getString("artworkUrl")),
            numberAsLong(call, "durationMs", 0L)
        );
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        long positionMs = numberAsLong(call, "positionMs", 0L);
        float rate = call.getFloat("rate", 1f);
        manager.setPlaybackState(playing, positionMs, rate);
        call.resolve();
    }

    /** ColorOS 锁屏歌词：lyricInfo JSON 字符串或 null（切歌移除）。 */
    @PluginMethod
    public void setLyricInfo(PluginCall call) {
        manager.setLyricInfo(call.getString("lyricInfo"));
        call.resolve();
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        manager.clear();
        call.resolve();
    }

    @PluginMethod
    public void startKeepAlive(PluginCall call) {
        requestNotificationPermissionIfNeeded();
        Intent intent = new Intent(getContext(), YuzuPlaybackService.class)
            .setAction(YuzuPlaybackService.ACTION_START);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (RuntimeException ignored) {
            // 后台启动前台服务受限（API 31+）：本次保活失败不致命，
            // 播放状态推送到达时服务若已启动仍会刷新通知。
        }
        call.resolve();
    }

    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        // stopService 不受后台启动限制，直接停；清理由服务 onDestroy 完成
        getContext().stopService(new Intent(getContext(), YuzuPlaybackService.class));
        call.resolve();
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject ret = new JSObject();
        ret.put("granted", powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        try {
            Intent intent = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName())
            );
            getActivity().startActivity(intent);
        } catch (RuntimeException e) {
            // 部分 ROM 不支持该 Intent：回退到应用详情页手动设置
            try {
                Intent fallback = new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                getActivity().startActivity(fallback);
            } catch (RuntimeException ignored) {
                call.reject("无法打开电池优化设置");
                return;
            }
        }
        call.resolve();
    }

    /** API 33+ 通知需运行时授权；未授予时前台服务仍工作，只是通知不可见。 */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                getActivity(),
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                REQ_POST_NOTIFICATIONS
            );
        }
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    /**
     * PluginCall.getLong 只认 org.json 解析为 Long 的值；JS 侧 int 范围的数字
     * 会被 JSONObject 存成 Integer，getLong 直接回退默认值（曾导致位置与时长
     * 恒为 0、锁屏进度条缺失）。统一按 Number 提取，覆盖 Integer/Long/Double。
     */
    private static long numberAsLong(PluginCall call, String name, long fallback) {
        Object value = call.getData().opt(name);
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        return fallback;
    }
}
