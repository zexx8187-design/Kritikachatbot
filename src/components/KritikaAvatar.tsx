import { useState } from 'react';

interface KritikaAvatarProps {
  name?: string;
  size?: 'sm' | 'md' | 'lg';
}

const AVATAR_SRC = '/src/assets/images/kritika_avatar_1795010032632.jpg';

export function KritikaAvatar({ name = 'Kritika', size = 'md' }: KritikaAvatarProps) {
  const [failed, setFailed] = useState(false);

  const dims =
    size === 'lg'
      ? 'w-20 h-20 text-2xl'
      : size === 'sm'
      ? 'w-9 h-9 text-sm'
      : 'w-12 h-12 text-base';

  if (failed) {
    return (
      <div
        className={`${dims} rounded-2xl bg-gradient-to-br from-rose-500 to-amber-500 text-white font-semibold flex items-center justify-center shrink-0 select-none`}
        aria-label={`${name} avatar`}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={AVATAR_SRC}
      alt={`${name} persona portrait`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${dims} rounded-2xl object-cover shrink-0 border border-stone-200 bg-stone-100`}
    />
  );
}
