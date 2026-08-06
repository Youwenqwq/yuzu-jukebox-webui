import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Palette, Sun } from 'lucide-react';
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
    <div className="relative flex items-center gap-2.5">
      <button
        title={t('theme.switchScheme')}
        onClick={() => {
          const next = scheme === 'dark' ? 'light' : 'dark';
          applyScheme(next);
          setScheme(next);
        }}
        className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-[var(--hover)] hover:text-paper"
      >
        {scheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>
      <button
        title={t('theme.accent')}
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-[var(--hover)] hover:text-paper"
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div className="menu-content absolute top-9 right-0 z-50 w-64 rounded-lg border border-hairline bg-panel-2 p-4">
          <div className="mb-3.5 flex gap-2.5">
            {PRESETS.map(([name, hex]) => (
              <button
                key={hex}
                title={name}
                onClick={() => {
                  applyAccent(hex);
                  setAccent(hex);
                }}
                className={`h-6.5 w-6.5 rounded-full border-2 ${accent === hex ? 'border-paper' : 'border-transparent'}`}
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
              className="h-6 w-8 cursor-pointer rounded border border-hairline bg-panel"
            />
            {t('theme.custom')}
          </label>
        </div>
      )}
    </div>
  );
}
