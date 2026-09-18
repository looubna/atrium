import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'ghost' | 'icon'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children?: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'h-10 gap-2 rounded-xl bg-jade-500 px-4 text-[13px] font-semibold text-ink-900 ' +
    'hover:bg-jade-400 active:scale-[0.985] ' +
    'shadow-[0_6px_20px_-6px_rgba(52,211,153,0.6)] ' +
    'disabled:bg-white/8 disabled:text-faint disabled:shadow-none',
  ghost:
    'h-10 gap-2 rounded-xl border border-white/10 bg-white/4 px-3.5 text-[13px] font-medium ' +
    'text-mist hover:border-white/20 hover:bg-white/8 hover:text-chalk active:scale-[0.985]',
  icon:
    'size-9 rounded-xl border border-white/10 bg-white/4 text-mist ' +
    'hover:border-white/20 hover:bg-white/8 hover:text-chalk active:scale-95',
}

export function Button({ variant = 'ghost', className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap',
        'transition-all duration-200 ease-[var(--ease-out-expo)]',
        'outline-none focus-visible:ring-2 focus-visible:ring-jade-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
        'disabled:pointer-events-none',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
