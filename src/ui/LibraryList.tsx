import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { ListMusic } from 'lucide-react';
import type { PlaylistInfo } from '../api/types';
import { coverSrc } from './cover';

/** 歌单封面：后端 cover_url 恒为代理路径，缺失时图标占位。 */
export function PlaylistCover({ playlist }: { playlist: PlaylistInfo }) {
  if (playlist.cover_url) {
    return (
      <img src={coverSrc(playlist.cover_url)} alt="" className="h-10 w-10 flex-none rounded object-cover" />
    );
  }
  return (
    <span className="grid h-10 w-10 flex-none place-items-center rounded bg-panel-2 text-faint">
      <ListMusic className="h-4 w-4" />
    </span>
  );
}

/** 曲库歌单列表：桌面侧栏与移动端曲库页共用（NavLink 行：封面 + 名称 + 副行）。 */
export function LibraryList({ playlists }: { playlists: PlaylistInfo[] | null }) {
  const { t } = useTranslation();

  if (playlists === null) {
    return <div className="px-2 py-1 text-[12.5px] text-faint">{t('shell.libraryLoading')}</div>;
  }
  if (playlists.length === 0) {
    return <div className="px-2 py-1 text-[12.5px] text-muted">{t('shell.libraryEmpty')}</div>;
  }
  return (
    <nav className="flex flex-col gap-0.5">
      {playlists.map((playlist) => (
        <NavLink
          key={playlist.id}
          to={`/playlist/${playlist.id}`}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors ${
              isActive ? 'bg-panel-2' : 'hover:bg-panel'
            }`
          }
        >
          <PlaylistCover playlist={playlist} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-paper">{playlist.name}</span>
            <span className="block truncate text-[11px] text-faint">
              {playlist.bound_provider
                ? t('shell.libraryBound', { provider: playlist.bound_provider })
                : t('shell.libraryTracks', { count: playlist.track_count })}
            </span>
          </span>
        </NavLink>
      ))}
    </nav>
  );
}
