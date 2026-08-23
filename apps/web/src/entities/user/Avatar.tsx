import { useEffect, useState } from 'react';
import { cn } from '../../shared/lib/cn.ts';

const sizes = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-11 w-11 text-lg',
  lg: 'h-12 w-12 text-lg',
  xl: 'h-24 w-24 text-4xl',
} as const;

export function Avatar({
  userId,
  name,
  version = 0,
  size = 'md',
  speaking = false,
  className,
}: {
  userId: number;
  name: string;
  version?: number;
  size?: keyof typeof sizes;
  speaking?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [userId, version]);

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 font-display font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
        sizes[size],
        speaking && 'ring-2 ring-emerald-400',
        className,
      )}
    >
      {!failed && version > 0 ? (
        <img
          src={`/api/users/${userId}/avatar?v=${version}`}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        name[0]?.toUpperCase()
      )}
    </div>
  );
}
