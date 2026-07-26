import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAccent, applyScheme, currentAccent, currentScheme } from '../app/theme';

const PRESETS: Array<[string, string]> = [
  ['柚子黄', '#E3B93C'],
  ['蜜柑', '#E0863C'],
  ['青柚', '#9BBE4A'],
  ['黑胶红', '#D05A4E'],
  ['深夜蓝', '#6A8FD8'],
  ['紫罗兰', '#A67FD4'],
];

export default function ThemeControls() {
  const { t } = useTranslation();
  const [scheme, setScheme] = useState(currentScheme());
  const [accent, setAccent] = useState(currentAccent());
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2.5 relative">
      <button
        title={t('theme.switchScheme')}
        onClick={() => {
          const next = scheme === 'dark' ? 'light' : 'dark';
          applyScheme(next);
          setScheme(next);
        }}
        className="w-8 h-8 grid place-items-center rounded-full border border-hairline text-muted hover:text-paper hover:border-faint"
      >
        {scheme === 'dark' ? '☾' : '☀'}
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[13px] text-muted border border-hairline rounded-full px-3 py-1.5 hover:text-paper hover:border-faint"
      >
        <span className="w-3 h-3 rounded-full" style={{ background: accent }} />
        {t('theme.accent')}
      </button>

      {open && (
        <div className="absolute top-10 right-0 z-50 w-64 bg-panel-2 border border-hairline rounded-lg p-4 shadow-xl">
          <div className="flex gap-2.5 mb-3.5">
            {PRESETS.map(([name, hex]) => (
              <button
                key={hex}
                title={name}
                onClick={() => {
                  applyAccent(hex);
                  setAccent(hex);
                }}
                className={`w-6.5 h-6.5 rounded-full border-2 ${accent === hex ? 'border-paper' : 'border-transparent'}`}
                style={{ background: hex }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2.5 text-xs text-muted">
            <input
              type="color"
              value={accent}
              onChange={(e) => {
                applyAccent(e.target.value);
                setAccent(e.target.value);
              }}
              className="w-8 h-6 border border-hairline rounded bg-panel cursor-pointer"
            />
            {t('theme.custom')}
          </label>
        </div>
      )}
    </div>
  );
}
