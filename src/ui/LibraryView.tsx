/**
 * 移动端曲库页：歌单列表（共享 LibraryList）。桌面端曲库在侧栏，
 * 此页是移动端 TabBar 的落地；导入/管理走桌面端（移动端不带管理功能）。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import type { PlaylistInfo } from '../api/types';
import { api } from '../app/session';
import { LibraryList } from './LibraryList';

export default function LibraryView(): JSX.Element {
  const { t } = useTranslation();
  const location = useLocation();
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);

  // 挂载 + 路由变化时刷新：管理端导入/删除后回来即最新
  useEffect(() => {
    let dead = false;
    api
      .listPlaylists()
      .then((list) => {
        if (!dead) setPlaylists(list);
      })
      .catch(() => {
        if (!dead) setPlaylists([]);
      });
    return () => {
      dead = true;
    };
  }, [location.pathname]);

  return (
    <div className="view-enter px-3 pt-4 pb-6">
      <h1 className="mb-3 px-1 font-display text-xl font-semibold">{t('shell.library')}</h1>
      <LibraryList playlists={playlists} />
    </div>
  );
}
