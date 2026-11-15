import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ChipProps {
  active: boolean
  onClick: () => void
  count?: number
  title?: string
  children?: ReactNode
  /** With an icon, the label is hidden on narrow screens (it stays the accessible name). */
  icon?: ReactNode
  label?: string
  /** Animate the active pill between chips (only one chip per page may use it). */
  morph?: boolean
  /** A toggle instead of a link-like filter. */
  pressed?: boolean
}

export function Chip({ active, onClick, count, title, children, icon, label, morph = true, pressed }: ChipProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={title ?? label}
        aria-label={label}
        aria-current={pressed === undefined && active ? 'page' : undefined}
        aria-pressed={pressed}
        style={active && morph ? { viewTransitionName: 'chip-active' } : undefined}
        className={cn(
          'relative flex h-9 items-center gap-2 rounded-full px-4 text-sm outline-none max-sm:px-3 focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(pointer:coarse)]:h-10',
          active ? 'font-medium text-primary-foreground' : 'text-foreground/75 hover:bg-accent hover:text-foreground',
        )}
      >
        {active && <span aria-hidden className="absolute inset-0 rounded-full bg-primary" />}
        {icon && <span className="relative [&_svg]:size-4">{icon}</span>}
        <span className={cn('relative', icon && 'max-sm:hidden')}>{children ?? label}</span>
        {!!count && <span className={cn('relative text-xs tabular-nums', active ? 'opacity-75' : 'text-muted-foreground')}>{count}</span>}
      </button>
    </li>
  )
}
