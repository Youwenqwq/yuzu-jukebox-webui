import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { audio } from '../app/player';

/** 音量控制：图标按钮（点击 mute/取消静音）+ 滑杆。图标随静音态切换。 */
export function VolumeControl(props: { className?: string }): JSX.Element {
  const { t } = useTranslation();
  const [volume, setVolume] = useState(audio.volume);
  const [muted, setMuted] = useState(audio.muted);

  return (
    <div className={`flex items-center gap-1.5 ${props.className ?? ''}`}>
      <button
        title={muted ? t('room.unmute') : t('room.mute')}
        onClick={() => {
          audio.muted = !audio.muted;
          setMuted(audio.muted);
        }}
        className="w-8.5 h-8.5 grid place-items-center rounded-md text-muted hover:text-paper hover:bg-[var(--hover)]"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4">
          <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" />
          {muted ? (
            <path d="m22 9-6 6M16 9l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          ) : (
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          )}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          setVolume(v);
          audio.volume = v;
          if (v > 0 && audio.muted) {
            audio.muted = false;
            setMuted(false);
          }
        }}
        title={t('room.volume')}
        className="w-24"
      />
    </div>
  );
}
