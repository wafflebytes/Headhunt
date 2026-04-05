import { HugeiconsIcon } from '@hugeicons/react';

import { cn } from '@/lib/utils';

type HugeIconProps = {
  icon: any;
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  className?: string;
} & Record<string, any>;

export function HugeIcon({
  icon,
  size = 18,
  color = 'currentColor',
  strokeWidth = 1.8,
  className,
  ...props
}: HugeIconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={cn('shrink-0', className)}
      {...props}
    />
  );
}
