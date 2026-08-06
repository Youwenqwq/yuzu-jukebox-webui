import { useState, type JSX } from 'react';
import { Disc3 } from 'lucide-react';

/**
 * 封面缩略图：代理路径 404（源站无图）时降级为图标占位，不显示破图。
 * className 需自带尺寸（如 h-12 w-12 rounded）。
 */
export function CoverThumb({
  src,
  alt = '',
  className,
}: {
  src: string;
  alt?: string;
  className: string;
}): JSX.Element {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className={`grid flex-none place-items-center bg-panel-2 text-faint ${className}`}>
        <Disc3 className="h-1/2 w-1/2" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`flex-none object-cover ${className}`}
    />
  );
}
