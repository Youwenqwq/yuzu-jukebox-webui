import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry } from '../api/types';
import { api } from '../app/session';
import { coverSrc } from './cover';
import { CoverThumb } from './CoverThumb';
import { formatClock } from './format';
import { Dialog } from './primitives';

const HISTORY_LIMIT = 20;

/** 个人点歌历史（跨房间，requester 角色）：折叠在账户菜单里，随打开拉取。 */
export function MyHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    setHistory(null);
    setDenied(false);
    api
      .myHistory(0, HISTORY_LIMIT)
      .then((rows) => {
        if (!dead) setHistory(rows);
      })
      .catch(() => {
        // 无 requester 角色等拒绝：显示说明而非报错
        if (!dead) setDenied(true);
      });
    return () => {
      dead = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('lobby.myHistory')}>
      {denied ? (
        <p className="text-sm text-muted">{t('lobby.historyUnavailable')}</p>
      ) : history === null ? (
        <p className="text-sm text-faint">{t('common.loading')}</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-muted">{t('lobby.historyEmpty')}</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
          {history.map((entry) => (
            <li
              key={`${entry.track_ref}:${entry.ended_at}`}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-panel"
            >
              <CoverThumb
                src={coverSrc(`/api/v1/cover/${encodeURIComponent(entry.track_ref)}`)}
                className="h-10 w-10 rounded"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{entry.title}</div>
                <div className="mt-0.5 font-mono text-[11px] text-faint">
                  {formatClock(entry.ended_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
