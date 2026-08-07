/**
 * 壳状态（桌面/移动共用）：房间动作、播放授权、播放接线。
 * 两壳通过断点互斥挂载，各自调用本 hook 组装 ShellValue——内核
 * （audio/renderer/client/roomStore）仍是组合根单例，壳只是消费者。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpBase } from '../../config';
import {
  api,
  getPersistedRoomId,
  nativeMediaSync,
  roomCredentials,
  roomStore,
  setLastRoom,
} from '../../app/session';
import { renderer } from '../../app/player';
import { syncMediaSession } from '../../app/mediasession';
import { yuzuMediaPlugin } from '../../app/nativemedia';
import { createNativeLyricsSync, type NativeLyricsSync } from '../../app/nativelyrics';
import { YuzuError } from '../../protocol/types';
import { pushOverlayCloser, removeOverlayCloser } from '../backbutton';
import { useIdentity, useRoomState } from '../hooks';
import { useToast } from '../toast';
import type { JoinResult, ShellValue } from '../shellContext';

/** ColorOS 锁屏歌词单例：原生端由插件+api 组装，浏览器为 null（no-op）。 */
const nativeLyrics: NativeLyricsSync | null = yuzuMediaPlugin
  ? createNativeLyricsSync(yuzuMediaPlugin, (trackRef) => api.lyrics(trackRef))
  : null;

/** 播放授权（controller/radio）：由服务端按 Principal / Room grant / policy 推导。 */
function useCapabilities(): { canControl: boolean; canRadio: boolean } {
  const state = useRoomState();
  const [canControl, setCanControl] = useState(false);
  const [canRadio, setCanRadio] = useState(false);
  const roomId = state.roomId;

  useEffect(() => {
    if (!roomId) {
      setCanControl(false);
      setCanRadio(false);
      return;
    }
    let cancelled = false;
    setCanControl(false);
    setCanRadio(false);
    api
      .roomCapabilities(roomId)
      .then((capabilities) => {
        if (cancelled) return;
        setCanControl(capabilities.controller);
        setCanRadio(capabilities.radio);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return { canControl, canRadio };
}

/** 播放接线：渲染、Media Session、1s tick、自动播放解锁（常驻壳层，页面切换不影响出声）。 */
function usePlaybackWiring(canControl: boolean): void {
  const state = useRoomState();
  const [personalPaused, setPersonalPaused] = useState(renderer.isPersonalPaused);

  useEffect(() => {
    renderer.render(state.playback);
  }, [state.playback]);

  // 媒体会话（锁屏/通知/蓝牙按键）= 本地收听控制：play/pause 是个人暂停/
  // 恢复跟随（渲染层静默，房间照走），不是房间级暂停——个人控制面不产生
  // 房间级副作用，听众也不再拿到死按钮。切歌无个人语义，保留房间级、仅
  // controller。播放态按本地可闻性上报（playing && !personalPaused）。
  // Web 版写 navigator.mediaSession；原生版推给前台服务，同一契约双写。
  useEffect(() => {
    const handlers = {
      onPlay: () => {
        if (renderer.isPersonalPaused) renderer.resumePersonal();
        setPersonalPaused(renderer.isPersonalPaused);
      },
      onPause: () => {
        if (!renderer.isPersonalPaused) renderer.pausePersonal();
        setPersonalPaused(renderer.isPersonalPaused);
      },
      ...(canControl
        ? {
            // 切歌是 controller 的房间级动作；seek 不再从系统控件注入（已禁用）
            onNextTrack: () => void roomStore.skip().catch(() => {}),
          }
        : {}),
    };
    const audible = { ...state.playback, playing: state.playback.playing && !personalPaused };
    syncMediaSession(audible, httpBase, handlers);
    nativeMediaSync?.sync(audible, httpBase, handlers);
  }, [canControl, state.playback, personalPaused]);

  useEffect(() => {
    const id = setInterval(() => {
      renderer.tick();
      setPersonalPaused(renderer.isPersonalPaused);
      // 播放期向原生会话推 1s 位置（serverNow 基准，与 UI 同钟）：ColorOS 对
      // PlaybackState 插值，但推送基准随 serverNow 刷新以抵消时钟漂移。
      // 暂停态不推（位置本就冻结）。
      const playback = roomStore.getState().playback;
      nativeMediaSync?.tick({
        ...playback,
        playing: playback.playing && !renderer.isPersonalPaused,
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ColorOS 锁屏歌词：曲目变化时由歌词桥处理（切歌清旧词 → 拉新词提交）。
  // 歌词与播放授权无关，所有听众都推；非原生平台 nativeLyrics 为 null。
  useEffect(() => {
    if (!nativeLyrics) return undefined;
    const handle = () => nativeLyrics.sync(roomStore.getState().playback.current);
    handle();
    return roomStore.subscribe(handle);
  }, []);

  // 浏览器自动播放限制：首次手势时补一次 play（判断交给渲染内核）
  useEffect(() => {
    const unlock = () => renderer.resumeAfterGesture();
    document.addEventListener('click', unlock);
    return () => document.removeEventListener('click', unlock);
  }, []);

  return undefined;
}

/** 组装 ShellValue：joinRoom/leaveRoom/nameOf/autoJoin + 抽屉开合状态。 */
export function useShellState(): ShellValue {
  const state = useRoomState();
  const identity = useIdentity();
  const { showError } = useToast();
  const { canControl, canRadio } = useCapabilities();
  usePlaybackWiring(canControl);

  const [queueOpen, setQueueOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);

  // Android 返回键：队列抽屉开时压入关闭栈（原生壳外为空转）
  useEffect(() => {
    if (!queueOpen) return;
    pushOverlayCloser('queue-drawer', () => setQueueOpen(false));
    return () => removeOverlayCloser('queue-drawer');
  }, [queueOpen]);

  const joinRoom = useCallback(
    async (targetId: string, password?: string): Promise<JoinResult> => {
      if (roomStore.getState().roomId === targetId) return 'joined';
      const credential = password ?? roomCredentials.get(targetId) ?? undefined;
      try {
        if (roomStore.getState().roomId) await roomStore.leave().catch(() => {});
        await roomStore.join(targetId, credential);
        roomCredentials.set(targetId, credential ?? '');
        setLastRoom({ id: targetId, password: credential });
        return 'joined';
      } catch (err: unknown) {
        const error = err instanceof YuzuError ? err : new YuzuError('unknown', String(err));
        if (error.code === 'forbidden') {
          // 凭据缺失/失效：丢弃记忆值，让调用方弹凭据表单
          roomCredentials.clear(targetId);
          return 'need_credential';
        }
        if (error.code === 'not_found') setLastRoom(null);
        showError(error);
        return 'failed';
      }
    },
    [showError],
  );

  const leaveRoom = useCallback(async () => {
    await roomStore.leave().catch(() => {});
    setLastRoom(null);
  }, []);

  // 自动入房（仅启动时一次）：上次房间 → 唯一房间 → 保持未入房空态
  const autoJoinTried = useRef(false);
  useEffect(() => {
    if (autoJoinTried.current) return;
    autoJoinTried.current = true;
    if (roomStore.getState().roomId) return;
    const last = getPersistedRoomId();
    if (last) {
      void joinRoom(last);
      return;
    }
    void api
      .listRooms()
      .then((rooms) => {
        if (rooms.length === 1 && !roomStore.getState().roomId) void joinRoom(rooms[0].id);
      })
      .catch(() => {});
  }, [joinRoom]);

  // ---------- requester 名字解析 ----------

  const nameOf = useMemo(() => {
    const names = new Map(state.listeners.map((l) => [l.id, l.name]));
    if (identity) names.set(identity.id, identity.name);
    return (id: string, snapshot?: string) => snapshot || names.get(id) || id;
  }, [state.listeners, identity]);

  return {
    canControl,
    canRadio,
    nameOf,
    joinRoom,
    leaveRoom,
    queueOpen,
    setQueueOpen,
    roomsOpen,
    setRoomsOpen,
  };
}
