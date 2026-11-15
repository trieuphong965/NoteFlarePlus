import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Crosshair, Plus, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Note, NotePatch } from '@/lib/notes'
import {
  addDays,
  buildRows,
  dayOf,
  holidayOf,
  inazumaPoint,
  isLate,
  isOffDay,
  isoOf,
  newTaskNote,
  noteToTask,
  subtreeIds,
  taskToNotePatch,
  todayIso,
  visibleRows,
  weekdayOf,
  type Row,
  type Task,
} from '@/lib/tasks'
import { dateLocale, useI18n } from '@/i18n'
import { colorVar } from './noteColors'
import { TaskDialog } from './TaskDialog'
import { Chip } from './Chip'

type Scale = 'day' | 'week' | 'month'
const DAY_W: Record<Scale, number> = { day: 28, week: 11, month: 4 }
const ROW_H = 36
const HEAD_H = 48
const PREFS_KEY = 'noteflare:koutei'

interface Prefs {
  scale: Scale
  inazuma: boolean
  collapsed: string[]
}

function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return {
      scale: p.scale === 'week' || p.scale === 'month' ? p.scale : 'day',
      inazuma: p.inazuma !== false,
      collapsed: Array.isArray(p.collapsed) ? p.collapsed : [],
    }
  } catch {
    return { scale: 'day', inazuma: true, collapsed: [] }
  }
}

interface Store {
  notes: Note[]
  loading: boolean
  upsert: (n: Note, opts?: { immediate?: boolean }) => void
  update: (id: string, patch: NotePatch, opts?: { immediate?: boolean }) => void
  flush: (id?: string) => void
  discard: (id: string) => void
}

interface Drag {
  id: string
  mode: 'move' | 'end' | 'start'
  x0: number
  dd: number
  moved: boolean
}

export function Koutei({ store, taskNotes, query, navSlot }: { store: Store; taskNotes: Note[]; query: string; navSlot: HTMLElement | null }) {
  const { t } = useI18n()
  const [prefs, setPrefsState] = useState(readPrefs)
  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        /* per-device only */
      }
      return next
    })
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed])
  const dayW = DAY_W[prefs.scale]

  const tasks = useMemo(() => taskNotes.map(noteToTask), [taskNotes])
  const rows = useMemo(() => buildRows(tasks), [tasks])
  const shown = useMemo(() => visibleRows(rows, collapsed, query), [rows, collapsed, query])

  const [today, setToday] = useState(() => dayOf(todayIso()))
  useEffect(() => {
    const timer = setInterval(() => setToday(dayOf(todayIso())), 60_000)
    return () => clearInterval(timer)
  }, [])

  const narrow = useNarrow()
  const leftW = narrow ? 190 : 420

  // ---------------------------------------------------------------- range
  const [first, last] = useMemo(() => {
    const days = [today]
    for (const r of rows) for (const d of [r.planStart, r.planEnd, r.actualStart, r.actualEnd]) if (d) days.push(dayOf(d))
    let a = Math.min(...days) - 7
    a -= (weekdayOf(a) + 6) % 7 // back to Monday
    const minDays = Math.ceil(1600 / dayW)
    const b = Math.max(Math.max(...days) + 28, a + minDays)
    return [a, b]
  }, [rows, today, dayW])
  const nDays = last - first + 1
  const width = nDays * dayW
  const xOf = useCallback((day: number) => (day - first) * dayW, [first, dayW])
  const todayX = xOf(today) + dayW / 2

  // ---------------------------------------------------------------- scrolling
  const scroller = useRef<HTMLDivElement>(null)
  const scrollToToday = useCallback(
    (smooth = false) => {
      const el = scroller.current
      if (!el) return
      el.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - leftW) / 3), behavior: smooth ? 'smooth' : 'auto' })
    },
    [todayX, leftW],
  )
  // On first render and whenever the scale changes, start around today.
  const scrolledFor = useRef<string>('')
  useLayoutEffect(() => {
    const key = `${prefs.scale}:${leftW}`
    if (store.loading || !scroller.current || scrolledFor.current === key) return
    scrolledFor.current = key
    scrollToToday()
  }, [store.loading, prefs.scale, leftW, scrollToToday, rows.length > 0])

  // ---------------------------------------------------------------- editing
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null)
  const editRow = editing ? (rows.find((r) => r.task.id === editing.id) ?? null) : null

  const save = useCallback(
    (task: Task) => {
      store.update(task.id, taskToNotePatch(task))
      store.flush(task.id)
    },
    [store],
  )

  const create = (fields: Partial<Task>, open = true) => {
    const siblings = tasks.filter((x) => (x.parentId ?? null) === (fields.parentId ?? null))
    const position = siblings.reduce((m, x) => Math.max(m, x.position), 0) + 1
    const parent = fields.parentId ? rows.find((r) => r.task.id === fields.parentId) : null
    // A sub-task starts where its parent does, so it lands in view.
    const start = parent?.planStart && parent.planStart > todayIso() ? parent.planStart : todayIso()
    const note = newTaskNote({ planStart: start, planEnd: addDays(start, 4), ...fields, position })
    store.upsert(note, { immediate: !open })
    if (fields.parentId && collapsed.has(fields.parentId)) setPrefs({ collapsed: prefs.collapsed.filter((c) => c !== fields.parentId) })
    if (open) setEditing({ id: note.id, isNew: true })
  }

  const remove = (task: Task) => {
    const ids = subtreeIds(tasks, task.id)
    const now = Date.now()
    for (const id of ids) store.update(id, { trashedAt: now }, { immediate: true })
    setEditing(null)
    toast(ids.length > 1 ? t('kt.deletedMany', { n: ids.length }) : t('kt.deleted'), {
      action: {
        label: t('common.undo'),
        onClick: () => ids.forEach((id) => store.update(id, { trashedAt: null }, { immediate: true })),
      },
    })
  }

  /** Resolved parent of every row (an orphan's missing parent counts as top level). */
  const parentOf = useMemo(() => {
    const m = new Map<string, string | null>()
    const stack: Row[] = []
    for (const r of rows) {
      stack.length = r.depth
      m.set(r.task.id, r.depth ? stack[r.depth - 1].task.id : null)
      stack[r.depth] = r
    }
    return m
  }, [rows])

  const move = (task: Task, dir: -1 | 1) => {
    const p = parentOf.get(task.id)
    const sibs = rows.filter((r) => parentOf.get(r.task.id) === p).map((r) => r.task)
    const i = sibs.findIndex((s) => s.id === task.id)
    const other = sibs[i + dir]
    if (!other) return
    const [a, b] = other.position === task.position ? [other.position + dir * 1e-3, task.position] : [other.position, task.position]
    store.update(task.id, { position: a }, { immediate: true })
    store.update(other.id, { position: b }, { immediate: true })
  }

  // ---------------------------------------------------------------- dragging bars
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const startDrag = (e: ReactPointerEvent, row: Row, mode: Drag['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const d: Drag = { id: row.task.id, mode, x0: e.clientX, dd: 0, moved: false }
    // Touch: a tap opens the task; dragging would fight with scrolling.
    if (e.pointerType === 'touch' || row.hasChildren) {
      dragRef.current = { ...d, mode: 'move' }
      return
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = d
    setDrag(d)
  }
  const onDragMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d || !drag) return
    const dd = Math.round((e.clientX - d.x0) / dayW)
    const moved = d.moved || Math.abs(e.clientX - d.x0) > 3
    if (dd !== d.dd || moved !== d.moved) {
      dragRef.current = { ...d, dd, moved }
      setDrag(dragRef.current)
    }
  }
  const endDrag = (row: Row) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d) return
    if (!d.moved || !d.dd) {
      if (!d.moved) setEditing({ id: row.task.id, isNew: false })
      return
    }
    const next = shifted(row.task, d)
    save(next)
  }

  const lateCount = useMemo(() => rows.filter((r) => !r.hasChildren && isLate(r, today)).length, [rows, today])

  const dialog = (
        <TaskDialog
          row={editRow}
          rows={rows}
          isNew={!!editing?.isNew}
          onClose={() => {
            // A new task closed without a name is dropped, like an empty new note.
            if (editing?.isNew && editRow && !editRow.task.name.trim()) store.discard(editRow.task.id)
            setEditing(null)
          }}
          onSave={(task) => {
            save(task)
            setEditing(null)
          }}
          onDelete={remove}
          onAddChild={(task) => create({ parentId: task.id })}
          onMove={move}
        />
  )

  // ---------------------------------------------------------------- layout
  // The card fills the window below the header; the page itself doesn't scroll.
  const sectionRef = useRef<HTMLElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const fit = () => {
      const el = sectionRef.current
      if (el) setHeight(Math.max(320, window.innerHeight - el.getBoundingClientRect().top - window.scrollY))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [navSlot, narrow, store.loading, rows.length > 0, shown.length > 0, !!query.trim()])

  // ---------------------------------------------------------------- render
  const toolbar = (
    <nav aria-label={t('kt.scale')} className="mx-auto flex max-w-[84rem] items-center gap-2 px-3 pb-3 sm:px-6">
      <ul className="flex gap-1 sm:gap-2">
        {(['day', 'week', 'month'] as const).map((s) => (
          <Chip key={s} active={prefs.scale === s} onClick={() => setPrefs({ scale: s })}>
            {t(s === 'day' ? 'kt.scaleDay' : s === 'week' ? 'kt.scaleWeek' : 'kt.scaleMonth')}
          </Chip>
        ))}
      </ul>
      <ul className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {lateCount > 0 && (
          <li className="flex h-9 items-center gap-1.5 rounded-full bg-destructive/10 px-3 text-sm font-medium text-destructive [@media(pointer:coarse)]:h-10">
            <span className="size-1.5 rounded-full bg-destructive" />
            {t('kt.lateCount', { n: lateCount })}
          </li>
        )}
        <Chip active={false} onClick={() => scrollToToday(true)} icon={<Crosshair />} label={t('kt.today')} />
        <Chip active={prefs.inazuma} pressed={prefs.inazuma} morph={false} onClick={() => setPrefs({ inazuma: !prefs.inazuma })} icon={<Zap />} label={t('kt.inazuma')} />
      </ul>
    </nav>
  )
  const nav = navSlot ? createPortal(toolbar, navSlot) : null
  const fab = (
    <button
      type="button"
      onClick={() => create({})}
      className={cn(
        'group fixed right-[calc(1.25rem+env(safe-area-inset-right))] bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-30 flex h-14 items-center gap-2 rounded-2xl bg-primary pr-5 pl-4 font-medium text-primary-foreground outline-none sm:right-[calc(2rem+env(safe-area-inset-right))] sm:bottom-[calc(2rem+env(safe-area-inset-bottom))]',
        'shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--primary)_80%,transparent)] transition-[transform,box-shadow] duration-200 ease-[var(--ease-out)]',
        'hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-10px_color-mix(in_oklab,var(--flare)_70%,transparent)] active:translate-y-0 active:scale-[0.97]',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        '[html[data-keyboard=open]_&]:pointer-events-none [html[data-keyboard=open]_&]:opacity-0',
      )}
    >
      <Plus className="size-5 transition-transform duration-300 ease-[var(--ease-spring)] group-hover:rotate-90" />
      {t('kt.add')}
    </button>
  )

  if (store.loading)
    return (
      <>
        {nav}
        <main role="status" aria-live="polite" className="mx-auto max-w-[84rem] px-3 pt-6 sm:px-6">
          <span className="sr-only">{t('common.loading')}</span>
          <div aria-hidden className="grid gap-3">
            {[56, 36, 36, 36, 36, 36].map((h, i) => (
              <div key={i} className="skeleton rounded-2xl border" style={{ height: h, animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        </main>
      </>
    )

  // Nothing yet: the same quiet empty state as the notes view.
  if (!rows.length || (query.trim() && !shown.length))
    return (
      <>
        {nav}
        <main className="mx-auto max-w-[84rem] px-3 pt-6 pb-32 sm:px-6">
          <div className="mt-24 flex flex-col items-center gap-4 text-center">
            <p className="max-w-sm text-muted-foreground">{query.trim() ? t('kt.emptySearch', { q: query.trim() }) : t('kt.empty')}</p>
            {!query.trim() && (
              <Button variant="outline" onClick={() => create({})}>
                <Plus /> {t('kt.emptyButton')}
              </Button>
            )}
          </div>
        </main>
        {fab}
        {dialog}
      </>
    )

  const bodyH = shown.length * ROW_H

  return (
    <>
      {nav}
      <section ref={sectionRef} className="mx-auto flex max-w-[84rem] flex-col px-3 pt-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-[calc(6.75rem+env(safe-area-inset-bottom))]" style={{ height }}>
        {query.trim() && (
          <p role="status" className="mb-3 px-1 text-sm text-muted-foreground">
            {t('kt.results', { n: shown.length })}
          </p>
        )}
        <div className="paper relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_10px_24px_-16px_rgb(0_0_0/0.25)]">
          <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-x-contain" onPointerMove={onDragMove}>
            <div className="relative flex flex-col" style={{ width: leftW + width, minHeight: '100%' }}>
              {/* ------------------------------------------------ header */}
              <div className="sticky top-0 z-20 flex shrink-0 border-b bg-surface" style={{ height: HEAD_H }}>
                <div className="sticky left-0 z-10 flex items-end border-r bg-surface text-xs font-medium text-muted-foreground" style={{ width: leftW, minWidth: leftW }}>
                  <LeftCols narrow={narrow} header />
                </div>
                <TimeHeader first={first} nDays={nDays} dayW={dayW} scale={prefs.scale} today={today} stickyLeft={leftW} />
              </div>

              {/* ------------------------------------------------ calendar background */}
              <div aria-hidden className="pointer-events-none absolute bottom-0 z-0" style={{ left: leftW, top: HEAD_H, width }}>
                <CalendarBackdrop first={first} nDays={nDays} dayW={dayW} scale={prefs.scale} />
                <div className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-primary/70" style={{ left: todayX }} />
              </div>

              {/* ------------------------------------------------ rows */}
              <div className="relative z-[1] flex flex-1 flex-col">
                {shown.map((r) => {
                  const late = !r.hasChildren && isLate(r, today)
                  return (
                    <div key={r.task.id} className="group flex shrink-0 hover:bg-foreground/[0.035]" style={{ height: ROW_H }}>
                      <button
                        type="button"
                        onClick={() => setEditing({ id: r.task.id, isNew: false })}
                        className="sticky left-0 z-10 flex items-center border-r border-b border-b-border/60 bg-surface text-left text-sm outline-none group-hover:bg-[color-mix(in_oklab,var(--surface),var(--foreground)_3.5%)] focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                        style={{ width: leftW, minWidth: leftW }}
                      >
                        <LeftCols
                          narrow={narrow}
                          row={r}
                          late={late}
                          collapsed={collapsed.has(r.task.id)}
                          onToggle={() => setPrefs({ collapsed: collapsed.has(r.task.id) ? prefs.collapsed.filter((c) => c !== r.task.id) : [...prefs.collapsed, r.task.id] })}
                        />
                      </button>
                      <div className="relative border-b border-b-border/40" style={{ width }}>
                        <Bars
                          row={drag?.id === r.task.id ? rolled(r, shifted(r.task, drag)) : r}
                          xOf={xOf}
                          dayW={dayW}
                          today={today}
                          late={late}
                          dragging={drag?.id === r.task.id}
                          onPointerDown={(e, mode) => startDrag(e, r, mode)}
                          onPointerUp={() => endDrag(r)}
                        />
                      </div>
                    </div>
                  )
                })}

                <QuickAdd leftW={leftW} onAdd={(name) => create({ name }, false)} />

                {/* The task column continues to the bottom, so the calendar never shows through it. */}
                <div className="sticky left-0 z-10 flex-1 border-r bg-surface" style={{ width: leftW }} />
              </div>

              {/* ------------------------------------------------ progress line */}
              {prefs.inazuma && shown.length > 0 && (
                <svg aria-hidden className="pointer-events-none absolute z-[2] overflow-visible" style={{ left: leftW, top: HEAD_H, width, height: bodyH }}>
                  <polyline
                    fill="none"
                    stroke="var(--destructive)"
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                    points={[
                      `${todayX},0`,
                      ...shown.map((r, i) => {
                        const p = inazumaPoint(r, today)
                        return `${p === null ? todayX : xOf(0) + p * dayW},${i * ROW_H + ROW_H / 2}`
                      }),
                      `${todayX},${bodyH}`,
                    ].join(' ')}
                  />
                </svg>
              )}
            </div>
          </div>
          <Legend inazuma={prefs.inazuma} />
        </div>
      </section>
      {fab}
      {dialog}
    </>
  )
}

/** The task with a drag applied. */
function shifted(task: Task, d: Pick<Drag, 'mode' | 'dd'>): Task {
  if (!task.planStart || !task.planEnd || !d.dd) return task
  const s = dayOf(task.planStart)
  const e = dayOf(task.planEnd)
  if (d.mode === 'move' || task.milestone) return { ...task, planStart: isoOf(s + d.dd), planEnd: isoOf(e + d.dd) }
  if (d.mode === 'end') return { ...task, planEnd: isoOf(Math.max(s, e + d.dd)) }
  return { ...task, planStart: isoOf(Math.min(e, s + d.dd)) }
}

/** Short month/day in the app language: 11/26, 26/11. */
const md = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

const rolled = (r: Row, task: Task): Row => ({ ...r, task, planStart: task.planStart, planEnd: task.planEnd })

// ------------------------------------------------------------------ left columns

function LeftCols({
  narrow,
  header,
  row,
  late,
  collapsed,
  onToggle,
}: {
  narrow: boolean
  header?: boolean
  row?: Row
  late?: boolean
  collapsed?: boolean
  onToggle?: () => void
}) {
  const { t } = useI18n()
  const cell = 'shrink-0 truncate px-2'
  if (header || !row)
    return (
      <div className="flex w-full items-center pb-2">
        {!narrow && <span className={cn(cell, 'w-14')}>WBS</span>}
        <span className={cn(cell, 'flex-1')}>{t('kt.colName')}</span>
        {!narrow && <span className={cn(cell, 'w-24')}>{t('kt.colOwner')}</span>}
        {!narrow && <span className={cn(cell, 'w-20 text-right')}>{t('kt.colProgress')}</span>}
      </div>
    )
  const task = row.task
  return (
    <div className="flex w-full min-w-0 items-center">
      {!narrow && <span className={cn(cell, 'w-14 font-mono text-xs text-muted-foreground')}>{row.wbs}</span>}
      <span className="flex min-w-0 flex-1 items-center gap-1 pr-2" style={{ paddingLeft: narrow ? 8 + row.depth * 10 : row.depth * 14 }}>
        {row.hasChildren ? (
          <span
            role="button"
            aria-label={collapsed ? t('kt.expand') : t('kt.collapse')}
            onClick={(e) => {
              e.stopPropagation()
              onToggle?.()
            }}
            className="-ml-1 grid size-6 shrink-0 place-items-center rounded hover:bg-foreground/10"
          >
            <ChevronRight className={cn('size-4 transition-transform duration-200', !collapsed && 'rotate-90')} />
          </span>
        ) : (
          <span className="size-2.5 shrink-0 rounded-full border" style={{ background: colorVar(task.color) }} />
        )}
        <span className={cn('truncate', row.hasChildren && 'font-semibold', !task.name && 'text-muted-foreground italic')}>
          {task.milestone && '◆ '}
          {task.name || t('kt.untitled')}
        </span>
        {narrow && <span className={cn('ml-auto shrink-0 text-xs tabular-nums', late ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{row.progress}%</span>}
      </span>
      {!narrow && <span className={cn(cell, 'w-24 text-muted-foreground')}>{task.owner}</span>}
      {!narrow && (
        <span className={cn(cell, 'w-20 text-right tabular-nums', late ? 'font-semibold text-destructive' : row.progress === 100 ? 'text-success' : '')}>
          {row.progress}%
        </span>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ bars

function Bars({
  row,
  xOf,
  dayW,
  today,
  late,
  dragging,
  onPointerDown,
  onPointerUp,
}: {
  row: Row
  xOf: (d: number) => number
  dayW: number
  today: number
  late: boolean
  dragging: boolean
  onPointerDown: (e: ReactPointerEvent, mode: Drag['mode']) => void
  onPointerUp: () => void
}) {
  const { t } = useI18n()
  const task = row.task
  const out = []

  if (row.planStart && row.planEnd) {
    const s = dayOf(row.planStart)
    const e = dayOf(row.planEnd)
    const left = xOf(s)
    const w = (e - s + 1) * dayW
    const label = `${task.name || t('kt.untitled')}\n${t('kt.plan')}: ${row.planStart} ~ ${row.planEnd}\n${t('kt.progress')}: ${row.progress}%`
    if (task.milestone && !row.hasChildren) {
      out.push(
        <div
          key="m"
          title={label}
          onPointerDown={(ev) => onPointerDown(ev, 'move')}
          onPointerUp={onPointerUp}
          className={cn('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-grab border-2 border-foreground', row.progress === 100 ? 'bg-foreground' : 'bg-background', dragging && 'cursor-grabbing ring-2 ring-primary')}
          style={{ left: left + dayW / 2 }}
        />,
      )
      out.push(
        <span key="ml" className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground" style={{ left: left + dayW / 2 + 12 }}>
          {md(row.planEnd)}
        </span>,
      )
    } else if (row.hasChildren) {
      // Summary: a dark bracket bar, filled to the rolled-up progress.
      out.push(
        <div key="s" title={label} onPointerDown={(ev) => onPointerDown(ev, 'move')} onPointerUp={onPointerUp} className="absolute top-[11px] h-2 cursor-pointer" style={{ left, width: w }}>
          <div className="absolute inset-0 rounded-[2px] bg-foreground/25" />
          <div className="absolute inset-y-0 left-0 rounded-[2px] bg-foreground/80" style={{ width: `${row.progress}%` }} />
          <div className="absolute top-0 left-0 h-3.5 w-1.5 bg-foreground/80 [clip-path:polygon(0_0,100%_0,0_100%)]" />
          <div className="absolute top-0 right-0 h-3.5 w-1.5 bg-foreground/80 [clip-path:polygon(0_0,100%_0,100%_100%)]" />
        </div>,
      )
    } else {
      const tint = task.color === 'default' ? 'var(--primary)' : `color-mix(in oklab, ${colorVar(task.color)}, var(--foreground) 35%)`
      out.push(
        <div
          key="p"
          title={label}
          onPointerDown={(ev) => onPointerDown(ev, 'move')}
          onPointerUp={onPointerUp}
          className={cn('absolute top-[7px] h-3 cursor-grab overflow-hidden rounded-[3px] border', dragging && 'cursor-grabbing shadow-md ring-2 ring-primary/60')}
          style={{
            left,
            width: w,
            borderColor: `color-mix(in oklab, ${tint}, transparent 30%)`,
            background: `color-mix(in oklab, ${tint}, transparent 78%)`,
          }}
        >
          <div className="h-full" style={{ width: `${row.progress}%`, background: late ? 'var(--destructive)' : tint }} />
          {w >= 24 && (
            <>
              <span onPointerDown={(ev) => onPointerDown(ev, 'start')} className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" />
              <span onPointerDown={(ev) => onPointerDown(ev, 'end')} className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
            </>
          )}
        </div>,
      )
    }
    if (!task.milestone || row.hasChildren)
      out.push(
        <span key="pct" className={cn('pointer-events-none absolute top-[3px] text-[11px] whitespace-nowrap tabular-nums', late ? 'font-semibold text-destructive' : 'text-muted-foreground')} style={{ left: left + w + 6 }}>
          {row.progress}%{dragging && ` · ${md(row.planStart)}–${md(row.planEnd)}`}
        </span>,
      )
  }

  // 実績: a solid bar under the plan; still running = up to today.
  if (row.actualStart && !(task.milestone && !row.hasChildren)) {
    const s = dayOf(row.actualStart)
    const e = row.actualEnd ? dayOf(row.actualEnd) : Math.max(s, today)
    out.push(
      <div
        key="a"
        title={`${t('kt.actual')}: ${row.actualStart} ~ ${row.actualEnd ?? '…'}`}
        className={cn('pointer-events-none absolute top-[22px] h-[7px] rounded-[2px]', row.actualEnd ? 'bg-success' : 'bg-[linear-gradient(to_right,var(--success)_70%,transparent)]')}
        style={{ left: xOf(s), width: (e - s + 1) * dayW }}
      />,
    )
  }
  return <>{out}</>
}

/** Key for the marks on the chart, as a quiet footer under it. */
function Legend({ inazuma }: { inazuma: boolean }) {
  const { t } = useI18n()
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-6 rounded-[2px] border border-primary/70 bg-[linear-gradient(to_right,var(--primary)_50%,color-mix(in_oklab,var(--primary),transparent_78%)_50%)]" />
        {t('kt.plan')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-[7px] w-6 rounded-[2px] bg-success" />
        {t('kt.actual')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rotate-45 border-[1.5px] border-foreground" />
        {t('kt.milestone')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3.5 w-0.5 bg-primary/70" />
        {t('kt.today')}
      </span>
      {inazuma && (
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 14" className="h-3.5 w-6 overflow-visible" aria-hidden>
            <polyline points="12,0 6,5 15,9 12,14" fill="none" stroke="var(--destructive)" strokeWidth={1.75} strokeLinejoin="round" />
          </svg>
          {t('kt.inazuma')}
        </span>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ calendar

function TimeHeader({ first, nDays, dayW, scale, today, stickyLeft }: { first: number; nDays: number; dayW: number; scale: Scale; today: number; stickyLeft: number }) {
  const { t, lang } = useI18n()
  // Month and year names follow the app language (2026年11月 / Nov 2026 / thg 11, 2026).
  const fmt = useMemo(() => {
    const loc = dateLocale()
    const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { timeZone: 'UTC', ...o })
    return { yearMonth: f({ year: 'numeric', month: 'short' }), year: f({ year: 'numeric' }), month: f({ month: 'short' }), monthDay: f({ month: 'numeric', day: 'numeric' }) }
  }, [lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const weekdays = t('kt.weekdays').split(',')
  const at = (day: number) => new Date(day * 86_400_000)
  // Top row: months (years in the month view). Bottom row: days, weeks or months.
  const top: { x: number; w: number; label: string }[] = []
  const bottom: { x: number; w: number; label: string; sub?: string; tone?: 'sat' | 'off'; today?: boolean; title?: string }[] = []
  let cur = ''
  for (let i = 0; i < nDays; i++) {
    const day = first + i
    const iso = isoOf(day)
    const [y, m, d] = iso.split('-')
    const key = scale === 'month' ? y : `${y}-${m}`
    if (key !== cur) {
      cur = key
      top.push({ x: i * dayW, w: 0, label: (scale === 'month' ? fmt.year : fmt.yearMonth).format(at(day)) })
    }
    top[top.length - 1].w += dayW

    if (scale === 'day') {
      const w = weekdayOf(day)
      const hol = holidayOf(day)
      bottom.push({ x: i * dayW, w: dayW, label: String(Number(d)), sub: weekdays[w], tone: hol || w === 0 ? 'off' : w === 6 ? 'sat' : undefined, today: day === today, title: hol ?? undefined })
    } else if (scale === 'week' && weekdayOf(day) === 1) {
      bottom.push({ x: i * dayW, w: dayW * 7, label: fmt.monthDay.format(at(day)), today: today >= day && today < day + 7 })
    } else if (scale === 'month' && (d === '01' || i === 0)) {
      const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate() - Number(d) + 1
      bottom.push({ x: i * dayW, w: dayW * days, label: fmt.month.format(at(day)), today: isoOf(today).slice(0, 7) === iso.slice(0, 7) })
    }
  }
  return (
    <div className="relative shrink-0 text-xs" style={{ width: nDays * dayW }}>
      {top.map((s) => (
        <div key={s.x} className="absolute top-0 h-5 border-l leading-5 font-medium whitespace-nowrap text-muted-foreground [clip-path:inset(0)]" style={{ left: s.x, width: s.w }}>
          {/* Sticks beside the task column, so the month in view is always named. */}
          <span className="sticky inline-block px-1.5" style={{ left: stickyLeft }}>
            {s.label}
          </span>
        </div>
      ))}
      {bottom.map((c) => (
        <div
          key={c.x}
          title={c.title}
          className={cn(
            'absolute top-5 flex h-7 flex-col items-center justify-center overflow-hidden border-l border-border/60 leading-none tabular-nums',
            scale !== 'day' && 'items-start px-1',
            c.tone === 'off' && 'text-destructive',
            c.tone === 'sat' && 'text-[#2f6fb3] dark:text-[#7fb2e6]',
            c.today && 'font-bold text-primary',
          )}
          style={{ left: c.x, width: c.w }}
        >
          <span className={cn(c.today && scale === 'day' && 'grid size-[18px] place-items-center rounded-full bg-primary text-primary-foreground')}>{c.label}</span>
          {c.sub && <span className="mt-0.5 text-[9px] opacity-80">{c.sub}</span>}
        </div>
      ))}
    </div>
  )
}

function CalendarBackdrop({ first, nDays, dayW, scale }: { first: number; nDays: number; dayW: number; scale: Scale }) {
  const cells = []
  for (let i = 0; i < nDays; i++) {
    const day = first + i
    const off = isOffDay(day)
    const monthStart = isoOf(day).endsWith('-01')
    const monday = weekdayOf(day) === 1
    if (off && scale !== 'month')
      cells.push(<div key={`o${i}`} className={cn('absolute inset-y-0', holidayOf(day) || weekdayOf(day) === 0 ? 'bg-destructive/[0.07]' : 'bg-foreground/[0.045]')} style={{ left: i * dayW, width: dayW }} />)
    if (monthStart || (scale === 'day' && monday) || (scale === 'week' && monday))
      cells.push(<div key={`l${i}`} className={cn('absolute inset-y-0 w-px', monthStart ? 'bg-border' : 'bg-border/50')} style={{ left: i * dayW }} />)
  }
  return <>{cells}</>
}

// ------------------------------------------------------------------ quick add

function QuickAdd({ leftW, onAdd }: { leftW: number; onAdd: (name: string) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  return (
    <form
      className="sticky left-0 z-10 flex shrink-0 items-center border-r border-b border-b-border/60 bg-background"
      style={{ width: leftW, height: ROW_H }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onAdd(name.trim())
        setName('')
      }}
    >
      <Plus className="ml-4 size-4 shrink-0 text-muted-foreground" />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        enterKeyHint="done"
        placeholder={t('kt.addPlaceholder')}
        aria-label={t('kt.add')}
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
      />
    </form>
  )
}

function useNarrow() {
  const query = '(max-width: 639px)'
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}
