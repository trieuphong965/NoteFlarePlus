/**
 * 工程表 (schedule) tasks, stored as ordinary encrypted notes.
 *
 * A task is a note whose body starts with TASK_MARKER, followed by one field per line.
 * Reusing the note record means tasks get the same end-to-end encryption, offline queue
 * and multi-device sync as notes, with no server change. Because every field sits on its
 * own line, the line-based three-way merge combines edits from two devices field by field
 * (e.g. progress on the phone, dates on the PC); only the same field edited differently
 * on both becomes a conflict copy.
 */
import JapaneseHolidays from 'japanese-holidays'
import type { NoteColor } from './crypto'
import type { Note } from './noteModel'

export const TASK_MARKER = '%koutei v1'

export interface Task {
  id: string
  name: string
  parentId: string | null
  /** Inclusive ISO dates (YYYY-MM-DD). */
  planStart: string | null
  planEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  /** 0–100 */
  progress: number
  owner: string
  milestone: boolean
  memo: string
  color: NoteColor
  position: number
  trashedAt: number | null
  version: number
  createdAt: number
  updatedAt: number
}

// ------------------------------------------------------------------ note <-> task

export const isTaskNote = (n: Pick<Note, 'body'>) => n.body.startsWith(TASK_MARKER)

const ISO = /^\d{4}-\d{2}-\d{2}$/
const date = (s: string | undefined) => (s && ISO.test(s.trim()) ? s.trim() : null)

export function parseTaskBody(body: string) {
  const lines = body.split('\n')
  const sep = lines.indexOf('---')
  const head = sep === -1 ? lines : lines.slice(0, sep)
  const memo = sep === -1 ? '' : lines.slice(sep + 1).join('\n')
  const f: Record<string, string> = {}
  for (const line of head.slice(1)) {
    const i = line.indexOf(':')
    if (i > 0) f[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const range = (v = '') => {
    const [a, b] = v.split('~')
    return [date(a), date(b)] as const
  }
  const [planStart, planEnd] = range(f.plan)
  const [actualStart, actualEnd] = range(f.actual)
  const progress = Math.round(Number(f.progress))
  return {
    parentId: f.parent || null,
    planStart,
    planEnd,
    actualStart,
    actualEnd,
    progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0,
    owner: f.owner ?? '',
    milestone: f.milestone === 'yes',
    memo,
  }
}

export function taskBody(t: Omit<Task, 'id' | 'name' | 'color' | 'position' | 'trashedAt' | 'version' | 'createdAt' | 'updatedAt'>) {
  return [
    TASK_MARKER,
    `parent: ${t.parentId ?? ''}`,
    `plan: ${t.planStart ?? ''} ~ ${t.planEnd ?? ''}`,
    `actual: ${t.actualStart ?? ''} ~ ${t.actualEnd ?? ''}`,
    `progress: ${t.progress}`,
    `owner: ${t.owner.replace(/\n/g, ' ')}`,
    `milestone: ${t.milestone ? 'yes' : 'no'}`,
    '---',
    t.memo,
  ].join('\n')
}

export function noteToTask(n: Note): Task {
  return {
    id: n.id,
    name: n.title,
    color: n.color,
    position: n.position,
    trashedAt: n.trashedAt,
    version: n.version,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    ...parseTaskBody(n.body),
  }
}

/** The note fields a task edit changes (labels, pin and archive are left alone). */
export function taskToNotePatch(t: Task): Pick<Note, 'title' | 'body' | 'color' | 'position' | 'trashedAt'> {
  return { title: t.name, body: taskBody(t), color: t.color, position: t.position, trashedAt: t.trashedAt }
}

export function newTaskNote(fields: Partial<Task> & { position: number }): Note {
  const now = Date.now()
  const today = todayIso()
  const t: Task = {
    id: crypto.randomUUID(),
    name: '',
    parentId: null,
    planStart: today,
    planEnd: addDays(today, 4),
    actualStart: null,
    actualEnd: null,
    progress: 0,
    owner: '',
    milestone: false,
    memo: '',
    color: 'default',
    trashedAt: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
    ...fields,
  }
  return { ...taskToNotePatch(t), id: t.id, labels: [], pinned: false, archived: false, version: 0, createdAt: now, updatedAt: now }
}

// ------------------------------------------------------------------ dates

const DAY_MS = 86_400_000

/** Days since 1970-01-01 for an ISO date. */
export const dayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
export const isoOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => isoOf(dayOf(iso) + n)
/** 0 = Sunday … 6 = Saturday */
export const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7

export function todayIso(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const holidayCache = new Map<number, string | null>()
/** Name of the Japanese public holiday on this day (振替休日 and 国民の休日 included), or null. */
export function holidayOf(day: number): string | null {
  let h = holidayCache.get(day)
  if (h === undefined) {
    const [y, m, d] = isoOf(day).split('-').map(Number)
    h = JapaneseHolidays.isHoliday(new Date(y, m - 1, d)) ?? null
    holidayCache.set(day, h)
  }
  return h
}

export const isOffDay = (day: number) => {
  const w = weekdayOf(day)
  return w === 0 || w === 6 || !!holidayOf(day)
}

// ------------------------------------------------------------------ tree

export interface Row {
  task: Task
  depth: number
  /** WBS number, e.g. "2.1.3" */
  wbs: string
  hasChildren: boolean
  /** Plan, actual and progress, rolled up from the children for summary rows. */
  planStart: string | null
  planEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  progress: number
}

const minIso = (xs: (string | null)[]) => xs.reduce<string | null>((a, b) => (b && (!a || b < a) ? b : a), null)
const maxIso = (xs: (string | null)[]) => xs.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null)
const span = (a: string | null, b: string | null) => (a && b ? Math.max(1, dayOf(b) - dayOf(a) + 1) : 1)

/** Every live task in display order (depth-first, siblings by position), summaries rolled up. */
export function buildRows(tasks: Task[]): Row[] {
  const live = tasks.filter((t) => !t.trashedAt)
  const ids = new Set(live.map((t) => t.id))
  const kids = new Map<string | null, Task[]>()
  for (const t of live) {
    const p = t.parentId && ids.has(t.parentId) && t.parentId !== t.id ? t.parentId : null
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p)!.push(t)
  }
  for (const list of kids.values()) list.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)

  const out: Row[] = []
  const seen = new Set<string>()
  /** Returns the subtree's rolled-up values and total planned days of its leaves. */
  const visit = (t: Task, depth: number, wbs: string): { row: Row; weight: number } => {
    seen.add(t.id)
    const row: Row = { task: t, depth, wbs, hasChildren: false, ...pick(t) }
    out.push(row)
    const children = (kids.get(t.id) ?? []).filter((c) => !seen.has(c.id))
    if (!children.length) return { row, weight: span(t.planStart, t.planEnd) }
    row.hasChildren = true
    const subs = children.map((c, i) => visit(c, depth + 1, `${wbs}.${i + 1}`))
    const rows = subs.map((s) => s.row)
    const weight = subs.reduce((a, s) => a + s.weight, 0)
    row.planStart = minIso(rows.map((r) => r.planStart))
    row.planEnd = maxIso(rows.map((r) => r.planEnd))
    row.actualStart = minIso(rows.map((r) => r.actualStart))
    row.actualEnd = rows.every((r) => r.actualEnd) ? maxIso(rows.map((r) => r.actualEnd)) : null
    row.progress = Math.round(subs.reduce((a, s) => a + s.row.progress * s.weight, 0) / weight)
    return { row, weight }
  }
  ;(kids.get(null) ?? []).forEach((t, i) => visit(t, 0, String(i + 1)))
  return out
}

const pick = (t: Task) => ({
  planStart: t.planStart,
  planEnd: t.planEnd,
  actualStart: t.actualStart,
  actualEnd: t.actualEnd,
  progress: t.progress,
})

/** Rows to show: collapsed summaries hide their subtree; a search keeps matches and their ancestors. */
export function visibleRows(rows: Row[], collapsed: Set<string>, query: string): Row[] {
  const q = query.trim().toLocaleLowerCase()
  if (q) {
    const byId = new Map(rows.map((r) => [r.task.id, r]))
    const keep = new Set<string>()
    for (const r of rows) {
      const t = r.task
      if (!`${t.name}\n${t.owner}\n${t.memo}`.toLocaleLowerCase().includes(q)) continue
      for (let cur: Row | undefined = r; cur && !keep.has(cur.task.id); cur = cur.task.parentId ? byId.get(cur.task.parentId) : undefined)
        keep.add(cur.task.id)
    }
    return rows.filter((r) => keep.has(r.task.id))
  }
  const out: Row[] = []
  let hideBelow = Infinity
  for (const r of rows) {
    if (r.depth > hideBelow) continue
    hideBelow = Infinity
    out.push(r)
    if (r.hasChildren && collapsed.has(r.task.id)) hideBelow = r.depth
  }
  return out
}

/** Ids of a task and everything under it. */
export function subtreeIds(tasks: Task[], id: string): string[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const t of tasks) if (t.parentId === out[i] && !out.includes(t.id)) out.push(t.id)
  return out
}

// ------------------------------------------------------------------ progress vs. today

/** Progress the plan expects by the middle of `today` (0–100), or null without plan dates. */
export function expectedProgress(r: Pick<Row, 'planStart' | 'planEnd'>, today: number): number | null {
  if (!r.planStart || !r.planEnd) return null
  const s = dayOf(r.planStart)
  const dur = span(r.planStart, r.planEnd)
  return Math.round(Math.min(1, Math.max(0, (today + 0.5 - s) / dur)) * 100)
}

export const isLate = (r: Row, today: number) => {
  const e = expectedProgress(r, today)
  return e !== null && r.progress < 100 && r.progress < e
}

/**
 * Where the イナズマ線 (progress line) touches this row, in days (fractional).
 * On schedule = today's line; behind = left of it; ahead = right of it.
 * Finished tasks and tasks not due to start yet sit on today's line.
 */
export function inazumaPoint(r: Pick<Row, 'planStart' | 'planEnd' | 'progress'>, today: number): number | null {
  if (!r.planStart || !r.planEnd) return null
  const now = today + 0.5
  const s = dayOf(r.planStart)
  if (r.progress >= 100) return now
  if (r.progress <= 0 && s > today) return now
  return s + span(r.planStart, r.planEnd) * (r.progress / 100)
}
