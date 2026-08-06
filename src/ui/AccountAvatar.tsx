import { useState } from 'react';
import type { Identity } from '../protocol/types';

/** 账户头像：OIDC avatar 链接可用时直引（外部 CDN，非代理路径），失败/缺失回退首字母。 */
export function AccountAvatar({ identity }: { identity: Identity }) {
  const [broken, setBroken] = useState(false);
  if (!identity.avatar || broken) {
    return (
      <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent-soft text-xs font-medium text-accent">
        {identity.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={identity.avatar}
      alt=""
      onError={() => setBroken(true)}
      className="h-7 w-7 flex-none rounded-full object-cover"
    />
  );
}
