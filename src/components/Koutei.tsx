import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronRight, CirclePlus, Download, File, FileSpreadsheet, FileText, Folder, FolderOpen, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { exportCsv, exportExcel } from '@/lib/kouteiExport'
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
  linksOf,
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

type Scale = 'day' | 'week' | 'month'
const DAY_W: Record<Scale, number> = { day: 24, week: 9, month: 3.2 }
const ROW_H = 26
const HEAD_H = 40
const PREFS_KEY = 'noteflare:koutei'

interface Prefs {
  scale: Scale
  inazuma: boolean
  /** Name, dates and owner beside each bar (タスク情報を表示). */
  info: boolean
  collapsed: string[]
}

function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return {
      scale: p.scale === 'week' || p.scale === 'month' ? p.scale : 'day',
      inazuma: p.inazuma !== false,
      info: p.info !== false,
      collapsed: Array.isArray(p.collapsed) ? p.collapsed : [],
    }
  } catch {
    return { scale: 'day', inazuma: true, info: true, collapsed: [] }
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

export function Koutei({ store, taskNotes, query }: { store: Store; taskNotes: Note[]; query: string }) {
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
  const leftW = narrow ? 168 : 320

  // ---------------------------------------------------------------- range
  const [first, last] = useMemo(() => {
    const days = [today]
    for (const r of rows) for (const d of [r.planStart, r.planEnd, r.actualStart, r.actualEnd]) if (d) days.push(dayOf(d))
    // Room on the left for the name beside the earliest bar.
    let a = Math.min(...days) - (prefs.info ? 21 : 7)
    a -= (weekdayOf(a) + 6) % 7 // back to Monday
    const minDays = Math.ceil(1600 / dayW)
    const b = Math.max(Math.max(...days) + 28, a + minDays)
    return [a, b]
  }, [rows, today, dayW, prefs.info])
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
  }, [narrow, store.loading, rows.length > 0, shown.length > 0, !!query.trim()])

  // ---------------------------------------------------------------- render
  const saveNow = () => {
    store.flush()
    toast.success(t('kt.saved'))
  }
  const download = async (kind: 'xlsx' | 'csv') => {
    try {
      if (kind === 'csv') exportCsv(rows, t)
      else await toast.promise(exportExcel(rows, t, t('kt.sheetTitle')), { loading: t('kt.exporting'), error: t('kt.exportFailed') })
    } catch {
      toast.error(t('kt.exportFailed'))
    }
  }

  // The bar above the chart, laid out like a classic 工程表 tool.
  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b bg-[var(--kt-head)] px-2 py-2 sm:px-3">
      <Button size="sm" className="h-8 rounded-md px-3" onClick={() => create({})}>
        <CirclePlus /> {t('kt.new')}
      </Button>
      <Button size="sm" variant="outline" className="h-8 rounded-md bg-surface px-3" onClick={saveNow} aria-label={t('kt.saveNow')}>
        <Save /> <span className="max-sm:hidden">{t('kt.saveNow')}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 rounded-md bg-surface px-3" aria-label={t('kt.download')} disabled={!rows.length}>
            <Download /> <span className="max-sm:hidden">{t('kt.download')}</span> <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem onSelect={() => void download('xlsx')}>
            <FileSpreadsheet /> {t('kt.dlExcel')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download('csv')}>
            <FileText /> {t('kt.dlCsv')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        {lateCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
            {t('kt.lateCount', { n: lateCount })}
          </span>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 text-sm select-none">
          <input type="checkbox" checked={prefs.info} onChange={(e) => setPrefs({ info: e.target.checked })} className="size-4 accent-[var(--primary)]" />
          {t('kt.showInfo')}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm select-none max-sm:hidden">
          <input type="checkbox" checked={prefs.inazuma} onChange={(e) => setPrefs({ inazuma: e.target.checked })} className="size-4 accent-[var(--primary)]" />
          {t('kt.showInazuma')}
        </label>
        <Button size="sm" variant="outline" className="h-8 rounded-md bg-surface px-3" onClick={() => scrollToToday(true)}>
          {t('kt.today')}
        </Button>
        <div role="group" aria-label={t('kt.scale')} className="flex h-8 overflow-hidden rounded-md border bg-surface">
          {(['day', 'week', 'month'] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              aria-pressed={prefs.scale === sc}
              onClick={() => setPrefs({ scale: sc })}
              className={cn(
                'min-w-10 border-l px-3 text-sm outline-none first:border-l-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
                prefs.scale === sc ? 'bg-foreground/[0.09] font-semibold shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]' : 'hover:bg-foreground/[0.05]',
              )}
            >
              {t(sc === 'day' ? 'kt.scaleDay' : sc === 'week' ? 'kt.scaleWeek' : 'kt.scaleMonth')}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  if (store.loading)
    return (
      <>
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
        {dialog}
      </>
    )

  const bodyH = shown.length * ROW_H
  const rowIndex = new Map(shown.map((r, i) => [r.task.id, i]))
  const toggle = (id: string) => setPrefs({ collapsed: collapsed.has(id) ? prefs.collapsed.filter((c) => c !== id) : [...prefs.collapsed, id] })
  const shownRow = (r: Row) => (drag?.id === r.task.id ? rolled(r, shifted(r.task, drag)) : r)

  return (
    <>
      {/* Full width: the chart is the page. */}
      <section ref={sectionRef} className="flex flex-col px-2 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:pb-4" style={{ height }}>
        {query.trim() && (
          <p role="status" className="mb-2 px-1 text-sm text-muted-foreground">
            {t('kt.results', { n: shown.length })}
          </p>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
          {toolbar}
          <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-x-contain" onPointerMove={onDragMove}>
            <div className="relative flex flex-col" style={{ width: leftW + width, minHeight: '100%' }}>
              {/* ------------------------------------------------ header */}
              <div className="sticky top-0 z-20 flex shrink-0 border-b bg-[var(--kt-head)]" style={{ height: HEAD_H }}>
                <div className="sticky left-0 z-10 flex border-r bg-[var(--kt-head)] text-xs font-medium" style={{ width: leftW, minWidth: leftW }}>
                  <LeftHeader narrow={narrow} />
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
                    <div key={r.task.id} className="group flex shrink-0 hover:bg-foreground/[0.03]" style={{ height: ROW_H }}>
                      <div
                        className="sticky left-0 z-10 flex items-center border-r border-b border-b-[var(--kt-grid)] bg-surface text-[13px] group-hover:bg-[color-mix(in_oklab,var(--surface),var(--foreground)_3%)]"
                        style={{ width: leftW, minWidth: leftW }}
                      >
                        <TreeRow
                          narrow={narrow}
                          row={r}
                          late={late}
                          collapsed={collapsed.has(r.task.id)}
                          onToggle={() => toggle(r.task.id)}
                          onEdit={() => setEditing({ id: r.task.id, isNew: false })}
                          onAddChild={() => create({ parentId: r.task.id })}
                          onDelete={() => remove(r.task)}
                        />
                      </div>
                      <div className="relative border-b border-b-[var(--kt-grid)]" style={{ width }}>
                        <Bars
                          row={shownRow(r)}
                          xOf={xOf}
                          dayW={dayW}
                          today={today}
                          late={late}
                          info={prefs.info}
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

                {/* ------------------------------------------------ dependency arrows (依存関係) */}
                <svg aria-hidden className="pointer-events-none absolute top-0 z-[5] overflow-visible" style={{ left: leftW, width, height: bodyH }}>
                  <defs>
                    <marker id="kt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
                    </marker>
                  </defs>
                  {linksOf(tasks).map(({ from, to }) => {
                    const i = rowIndex.get(from)
                    const j = rowIndex.get(to)
                    if (i === undefined || j === undefined) return null
                    const a = shownRow(shown[i])
                    const b = shownRow(shown[j])
                    if (!a.planEnd || !b.planStart) return null
                    const x1 = xOf(dayOf(a.planEnd)) + (a.task.milestone && !a.hasChildren ? dayW / 2 + 7 : dayW)
                    const x2 = xOf(dayOf(b.planStart)) + (b.task.milestone && !b.hasChildren ? dayW / 2 - 8 : 0)
                    const y1 = i * ROW_H + ROW_H / 2
                    const y2 = j * ROW_H + ROW_H / 2
                    const bad = dayOf(b.planStart) <= dayOf(a.planEnd)
                    return (
                      <path
                        key={`${from}>${to}`}
                        d={linkPath(x1, y1, x2, y2)}
                        fill="none"
                        stroke={bad ? 'var(--kt-link-bad)' : 'var(--kt-link)'}
                        strokeWidth={1.4}
                        strokeLinejoin="round"
                        markerEnd="url(#kt-arrow)"
                      />
                    )
                  })}
                </svg>

                {/* ------------------------------------------------ progress line */}
                {prefs.inazuma && shown.length > 0 && (
                  <svg aria-hidden className="pointer-events-none absolute top-0 z-[5] overflow-visible" style={{ left: leftW, width, height: bodyH }}>
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
          </div>
        </div>
      </section>
      {dialog}
    </>
  )
}

/** Finish-to-start connector: out of the predecessor, down, into the successor; around when it starts earlier. */
function linkPath(x1: number, y1: number, x2: number, y2: number) {
  const out = x1 + 6
  if (x2 - 8 >= out) return `M${x1},${y1} H${out} V${y2} H${x2}`
  const mid = y1 + (y2 > y1 ? ROW_H / 2 : -ROW_H / 2)
  return `M${x1},${y1} H${out} V${mid} H${x2 - 10} V${y2} H${x2}`
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

// ------------------------------------------------------------------ task tree

function LeftHeader({ narrow }: { narrow: boolean }) {
  const { t } = useI18n()
  return (
    <div className="flex w-full items-stretch">
      <span className="flex flex-1 items-center justify-center truncate px-2">{t('kt.colName')}</span>
      {!narrow && <span className="flex w-[4.75rem] shrink-0 items-center justify-center border-l px-1">{t('kt.colEdit')}</span>}
    </div>
  )
}

/** One line of the task tree: folder or file icon, name, and edit / add / delete like a file browser. */
function TreeRow({
  narrow,
  row,
  late,
  collapsed,
  onToggle,
  onEdit,
  onAddChild,
  onDelete,
}: {
  narrow: boolean
  row: Row
  late: boolean
  collapsed: boolean
  onToggle: () => void
  onEdit: () => void
  onAddChild: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const task = row.task
  const Icon = row.hasChildren ? (collapsed ? Folder : FolderOpen) : File
  return (
    <div className="flex h-full w-full min-w-0 items-center">
      <span className="shrink-0" style={{ width: 4 + row.depth * (narrow ? 10 : 16) }} />
      {row.hasChildren ? (
        <button
          type="button"
          aria-label={collapsed ? t('kt.expand') : t('kt.collapse')}
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="grid size-5 shrink-0 place-items-center rounded text-foreground/70 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight className={cn('size-3 fill-current transition-transform duration-200', !collapsed && 'rotate-90')} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <button
        type="button"
        onClick={onEdit}
        title={task.name || t('kt.untitled')}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <Icon
          className={cn('size-3.5 shrink-0 fill-current', row.hasChildren ? 'text-[var(--kt-folder)]' : late ? 'text-destructive/80' : 'text-[var(--kt-folder)]/70')}
          strokeWidth={1.5}
          style={!row.hasChildren && task.color !== 'default' && !late ? { color: `color-mix(in oklab, ${colorVar(task.color)}, var(--foreground) 45%)` } : undefined}
        />
        <span className={cn('truncate', !task.name && 'text-muted-foreground italic')}>
          {task.milestone && !row.hasChildren && '◆ '}
          {task.name || t('kt.untitled')}
        </span>
        {narrow && <span className={cn('ml-auto shrink-0 text-xs tabular-nums', late ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{row.progress}%</span>}
      </button>
      {!narrow && (
        <span className="flex h-full w-[4.75rem] shrink-0 items-center justify-center gap-px border-l border-l-[var(--kt-grid)]">
          <RowAction label={t('kt.editTitle')} onClick={onEdit}>
            <Pencil />
          </RowAction>
          {/* Like a file tree: folders take new items; a file gets one from its dialog. */}
          {row.hasChildren ? (
            <RowAction label={t('kt.addChild')} onClick={onAddChild}>
              <CirclePlus />
            </RowAction>
          ) : (
            <span className="size-6" />
          )}
          <RowAction label={t('kt.delete')} onClick={onDelete} danger>
            <Trash2 />
          </RowAction>
        </span>
      )}
    </div>
  )
}

function RowAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-6 place-items-center rounded text-foreground/75 outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5',
        danger && 'hover:text-destructive',
      )}
    >
      {children}
    </button>
  )
}

// ------------------------------------------------------------------ bars

function Bars({
  row,
  xOf,
  dayW,
  today,
  late,
  info,
  dragging,
  onPointerDown,
  onPointerUp,
}: {
  row: Row
  xOf: (d: number) => number
  dayW: number
  today: number
  late: boolean
  info: boolean
  dragging: boolean
  onPointerDown: (e: ReactPointerEvent, mode: Drag['mode']) => void
  onPointerUp: () => void
}) {
  const { t } = useI18n()
  const task = row.task
  const name = task.name || t('kt.untitled')
  const out = []

  if (row.planStart && row.planEnd) {
    const s = dayOf(row.planStart)
    const e = dayOf(row.planEnd)
    const left = xOf(s)
    const w = (e - s + 1) * dayW
    const milestone = task.milestone && !row.hasChildren
    const range = milestone ? md(row.planEnd) : `${md(row.planStart)}–${md(row.planEnd)}`
    const title = `${name}\n${t('kt.plan')}: ${row.planStart} ~ ${row.planEnd}\n${t('kt.progress')}: ${row.progress}%${task.owner ? `\n${t('kt.owner')}: ${task.owner}` : ''}`
    const pctInside = !milestone && w >= 34
    const start = milestone ? left + dayW / 2 - 7 : left
    const end = milestone ? left + dayW / 2 + 7 : left + w

    // タスク情報: name and dates to the left of the bar, owner (and % when it doesn't fit) to the right.
    if (info || dragging)
      out.push(
        <span
          key="l"
          className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 pr-1.5 text-[11px] whitespace-nowrap', dragging ? 'font-medium text-primary' : 'text-muted-foreground')}
          style={{ right: `calc(100% - ${start}px)` }}
        >
          {info && <span className={cn(row.hasChildren && 'font-semibold text-foreground/70')}>{name} </span>}[{range}]
        </span>,
      )
    const right = [!pctInside && !milestone ? `${row.progress}%` : '', info ? task.owner : ''].filter(Boolean).join('  ')
    if (right)
      out.push(
        <span key="r" className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 pl-1.5 text-[11px] whitespace-nowrap tabular-nums', late ? 'font-semibold text-destructive' : 'text-muted-foreground')} style={{ left: end }}>
          {right}
        </span>,
      )

    if (milestone) {
      out.push(
        <div
          key="m"
          title={title}
          onPointerDown={(ev) => onPointerDown(ev, 'move')}
          onPointerUp={onPointerUp}
          className={cn('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-grab border-2 border-foreground', row.progress === 100 ? 'bg-foreground' : 'bg-surface', dragging && 'cursor-grabbing ring-2 ring-primary')}
          style={{ left: left + dayW / 2 }}
        />,
      )
    } else if (row.hasChildren) {
      // Summary: grey, filled to the rolled-up progress.
      out.push(
        <div key="s" title={title} onPointerDown={(ev) => onPointerDown(ev, 'move')} onPointerUp={onPointerUp} className="absolute top-[5px] h-4 cursor-pointer overflow-hidden rounded-[2px] bg-[var(--kt-summary-track)]" style={{ left, width: w }}>
          <div className="h-full bg-[var(--kt-summary)]" style={{ width: `${row.progress}%` }} />
          {pctInside && <span className="absolute inset-0 grid place-items-center text-[10.5px] leading-none font-semibold tabular-nums text-foreground/85">{row.progress}%</span>}
        </div>,
      )
    } else {
      const tint = late ? 'var(--destructive)' : task.color === 'default' ? 'var(--kt-bar)' : `color-mix(in oklab, ${colorVar(task.color)}, var(--foreground) 35%)`
      out.push(
        <div
          key="p"
          title={title}
          onPointerDown={(ev) => onPointerDown(ev, 'move')}
          onPointerUp={onPointerUp}
          className={cn('absolute top-[4px] h-[18px] cursor-grab overflow-hidden rounded-[2px] border', dragging && 'cursor-grabbing shadow-md ring-2 ring-primary/60')}
          style={{ left, width: w, borderColor: `color-mix(in oklab, ${tint}, transparent 35%)`, background: `color-mix(in oklab, ${tint}, transparent 80%)` }}
        >
          <div className="h-full" style={{ width: `${row.progress}%`, background: `color-mix(in oklab, ${tint}, transparent 18%)` }} />
          {pctInside && <span className="pointer-events-none absolute inset-0 grid place-items-center text-[10.5px] leading-none font-semibold tabular-nums text-foreground/85">{row.progress}%</span>}
          {w >= 24 && (
            <>
              <span onPointerDown={(ev) => onPointerDown(ev, 'start')} className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" />
              <span onPointerDown={(ev) => onPointerDown(ev, 'end')} className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
            </>
          )}
        </div>,
      )
    }
  }

  // 実績: a thin line under the bar; still running = up to today.
  if (row.actualStart && !(task.milestone && !row.hasChildren)) {
    const s = dayOf(row.actualStart)
    const e = row.actualEnd ? dayOf(row.actualEnd) : Math.max(s, today)
    out.push(
      <div
        key="a"
        title={`${t('kt.actual')}: ${row.actualStart} ~ ${row.actualEnd ?? '…'}`}
        className={cn('pointer-events-none absolute top-[23px] h-[2px] rounded-full', row.actualEnd ? 'bg-success' : 'bg-[linear-gradient(to_right,var(--success)_70%,transparent)]')}
        style={{ left: xOf(s), width: (e - s + 1) * dayW }}
      />,
    )
  }
  return <>{out}</>
}

// ------------------------------------------------------------------ calendar

function TimeHeader({ first, nDays, dayW, scale, today, stickyLeft }: { first: number; nDays: number; dayW: number; scale: Scale; today: number; stickyLeft: number }) {
  const { t, lang } = useI18n()
  const fmt = useMemo(() => new Intl.DateTimeFormat(dateLocale(), { timeZone: 'UTC', month: 'short' }), [lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const weekdays = t('kt.weekdays').split(',')
  // Top row: 2026-11 (years in the month view). Bottom row: days, week starts or months.
  const top: { x: number; w: number; label: string }[] = []
  const bottom: { x: number; w: number; label: string; tone?: 'sat' | 'off'; today?: boolean; title?: string }[] = []
  let cur = ''
  for (let i = 0; i < nDays; i++) {
    const day = first + i
    const iso = isoOf(day)
    const [y, m, d] = iso.split('-')
    const key = scale === 'month' ? y : `${y}-${m}`
    if (key !== cur) {
      cur = key
      top.push({ x: i * dayW, w: 0, label: key })
    }
    top[top.length - 1].w += dayW

    if (scale === 'day') {
      const w = weekdayOf(day)
      const hol = holidayOf(day)
      bottom.push({ x: i * dayW, w: dayW, label: String(Number(d)), tone: hol || w === 0 ? 'off' : w === 6 ? 'sat' : undefined, today: day === today, title: `${iso} (${weekdays[w]})${hol ? ` ${hol}` : ''}` })
    } else if (scale === 'week' && weekdayOf(day) === 1) {
      bottom.push({ x: i * dayW, w: dayW * 7, label: `${Number(m)}/${Number(d)}`, today: today >= day && today < day + 7 })
    } else if (scale === 'month' && (d === '01' || i === 0)) {
      const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate() - Number(d) + 1
      bottom.push({ x: i * dayW, w: dayW * days, label: fmt.format(new Date(day * 86_400_000)), today: isoOf(today).slice(0, 7) === iso.slice(0, 7) })
    }
  }
  return (
    <div className="relative shrink-0 text-xs" style={{ width: nDays * dayW }}>
      {top.map((s) => (
        <div key={s.x} className="absolute top-0 h-5 border-b border-l border-[var(--kt-grid)] leading-5 font-medium whitespace-nowrap text-foreground/75 [clip-path:inset(0)]" style={{ left: s.x, width: s.w }}>
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
            'absolute top-5 grid h-5 place-items-center overflow-hidden border-l border-[var(--kt-grid)] text-[11px] leading-none tabular-nums',
            scale !== 'day' && 'place-items-start px-1 pt-1',
            c.tone === 'off' && 'bg-[var(--kt-sun)] text-destructive',
            c.tone === 'sat' && 'bg-[var(--kt-sat)] text-[#2f6fb3] dark:text-[#7fb2e6]',
            c.today && 'font-bold text-primary',
          )}
          style={{ left: c.x, width: c.w }}
        >
          <span className={cn(c.today && scale === 'day' && 'grid h-4 min-w-4 place-items-center rounded-sm bg-primary px-0.5 text-primary-foreground')}>{c.label}</span>
        </div>
      ))}
    </div>
  )
}

function CalendarBackdrop({ first, nDays, dayW, scale }: { first: number; nDays: number; dayW: number; scale: Scale }) {
  const cells = []
  for (let i = 0; i < nDays; i++) {
    const day = first + i
    const w = weekdayOf(day)
    const monthStart = isoOf(day).endsWith('-01')
    if (scale !== 'month' && isOffDay(day))
      cells.push(<div key={`o${i}`} className={cn('absolute inset-y-0', w === 6 && !holidayOf(day) ? 'bg-[var(--kt-sat)]' : 'bg-[var(--kt-sun)]')} style={{ left: i * dayW, width: dayW }} />)
    // A line for every day, like squared paper; weekly and monthly views keep only the bigger steps.
    if (scale === 'day' || monthStart || (scale === 'week' && w === 1))
      cells.push(<div key={`l${i}`} className={cn('absolute inset-y-0 w-px', monthStart ? 'bg-foreground/20' : 'bg-[var(--kt-grid)]')} style={{ left: i * dayW }} />)
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
