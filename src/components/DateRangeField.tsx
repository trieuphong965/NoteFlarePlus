import { useMemo, useState } from 'react'
import { Popover } from 'radix-ui'
import { DayPicker } from 'react-day-picker'
import { enUS, ja, vi } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import { CalendarDays, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { addDays, dayOf, holidayOf, todayIso, weekdayOf } from '@/lib/tasks'
import { dateLocale, useI18n } from '@/i18n'

const LOCALES = { en: enUS, ja, vi }

/** Local-midnight Date for an ISO day, as DayPicker works in local time. */
const toDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const toIso = (d: Date) => todayIso(d)

interface Props {
  start: string | null
  end: string | null
  /** One day only (milestones). */
  single?: boolean
  onChange: (start: string | null, end: string | null) => void
  placeholder?: string
  /** Accessible name of the trigger. */
  label: string
}

/**
 * A date (range) field that opens a calendar: first tap picks the start, second the end.
 * Weekends and Japanese public holidays are coloured like the chart.
 */
export function DateRangeField({ start, end, single, onChange, placeholder, label }: Props) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  // In range mode: which end the next tap sets.
  const [step, setStep] = useState<'start' | 'end'>('start')
  const [month, setMonth] = useState<Date>(() => toDate(start ?? end ?? todayIso()))

  const fmt = useMemo(() => new Intl.DateTimeFormat(dateLocale(), { month: 'numeric', day: 'numeric', weekday: 'short' }), [lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const show = (iso: string | null) => (iso ? fmt.format(toDate(iso)) : '…')
  const text = single ? (end ? show(end) : '') : start || end ? `${show(start)} ~ ${show(end)}` : ''

  const pick = (d: Date) => {
    const iso = toIso(d)
    if (single) {
      onChange(iso, iso)
      setOpen(false)
      return
    }
    if (step === 'start') {
      onChange(iso, null)
      setStep('end')
      return
    }
    // Second tap: the end, or a new start if it's before the current one.
    if (start && iso < start) onChange(iso, start)
    else onChange(start ?? iso, iso)
    setStep('start')
    setOpen(false)
  }

  const quick = (days: number) => {
    const s = start ?? todayIso()
    onChange(s, addDays(s, days - 1))
    setStep('start')
    setOpen(false)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setStep('start')
          setMonth(toDate(start ?? end ?? todayIso()))
        }
      }}
    >
      <div className="relative">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-surface pr-9 pl-3 text-left text-sm tabular-nums outline-none hover:border-foreground/30 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-primary"
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn('truncate', !text && 'text-muted-foreground')}>{text || placeholder}</span>
          </button>
        </Popover.Trigger>
        {(start || end) && (
          <button
            type="button"
            aria-label={t('kt.clear')}
            title={t('kt.clear')}
            onClick={() => onChange(null, null)}
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          // Short windows: the calendar scrolls instead of running off screen.
          style={{ maxHeight: 'var(--radix-popover-content-available-height)' }}
          className="z-[60] overflow-y-auto overscroll-contain rounded-xl border bg-background p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
            {single ? t('kt.pickDay') : step === 'start' ? t('kt.pickStart') : t('kt.pickEnd')}
          </p>
          <DayPicker
            mode="range"
            locale={LOCALES[lang]}
            month={month}
            onMonthChange={setMonth}
            selected={single ? (end ? { from: toDate(end), to: toDate(end) } : undefined) : start ? { from: toDate(start), to: end ? toDate(end) : undefined } : undefined}
            onDayClick={pick}
            today={toDate(todayIso())}
            modifiers={{
              holiday: (d) => !!holidayOf(dayOf(toIso(d))),
              sunday: (d) => weekdayOf(dayOf(toIso(d))) === 0,
              saturday: (d) => weekdayOf(dayOf(toIso(d))) === 6,
            }}
            modifiersClassNames={{ holiday: 'kt-holiday', sunday: 'kt-holiday', saturday: 'kt-saturday' }}
            className="kt-daypicker"
          />
          <div className="flex flex-wrap gap-1.5 border-t pt-2">
            <QuickButton
              onClick={() => {
                const today = todayIso()
                if (single) onChange(today, today)
                else onChange(today, end && end >= today ? end : null)
                setStep(single ? 'start' : 'end')
                setMonth(toDate(today))
                if (single) setOpen(false)
              }}
            >
              {t('kt.today')}
            </QuickButton>
            {!single &&
              [
                [5, t('kt.quickDays', { n: 5 })],
                [7, t('kt.quickWeek')],
                [14, t('kt.quickWeeks', { n: 2 })],
                [30, t('kt.quickMonth')],
              ].map(([n, l]) => (
                <QuickButton key={n} onClick={() => quick(Number(n))}>
                  {l}
                </QuickButton>
              ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function QuickButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-8 rounded-full border px-3 text-xs hover:bg-accent [@media(pointer:coarse)]:h-9">
      {children}
    </button>
  )
}
