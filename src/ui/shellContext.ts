import { createContext, useContext } from 'react';
import { YuzuError } from '../protocol/types';

/** 桌面/移动两壳共享的 Shell 上下文：房间动作 + 播放授权。 */
export type JoinResult = 'joined' | 'need_credential' | 'failed';

export interface ShellValue {
  canControl: boolean;
  /** 电台启停授权（policy.radio_control 推导，spec §4.7）；独立于 canControl */
  canRadio: boolean;
  /** requested_by 身份 ID → 显示名（条目快照优先，听众表次之，回退 ID） */
  nameOf: (id: string, snapshot?: string) => string;
  joinRoom: (roomId: string, password?: string) => Promise<JoinResult>;
  leaveRoom: () => Promise<void>;
  queueOpen: boolean;
  setQueueOpen: (open: boolean) => void;
  roomsOpen: boolean;
  setRoomsOpen: (open: boolean) => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new YuzuError('internal', 'useShell outside shell');
  return value;
}

/** 顶栏搜索 provider 的本机记忆：顶栏下拉写入，搜索页缺省读取。 */
export const SEARCH_PROVIDER_KEY = 'yuzu-search-provider';
