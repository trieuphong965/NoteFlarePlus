import { describe, expect, it } from 'vitest'
import {
  buildRows,
  dayOf,
  holidayOf,
  inazumaPoint,
  isLate,
  isTaskNote,
  newTaskNote,
  noteToTask,
  parseTaskBody,
  taskBody,
  visibleRows,
  weekdayOf,
  type Task,
} from '../src/lib/tasks'
import { mergeText } from '../src/lib/sync/merge'
import type { Note } from '../src/lib/noteModel'

const task = (id: string, fields: Partial<Task> = {}): Task => {
  const n = newTaskNote({ position: 0, ...fields })
  return { ...noteToTask({ ...n, id } as Note), id }
}

describe('task body', () => {
  it('round-trips every field, memo included', () => {
    const fields = {
      parentId: 'p1',
      planStart: '2026-11-16',
      planEnd: '2026-11-20',
      actualStart: '2026-11-17',
      actualEnd: null,
      progress: 40,
      owner: 'フォン',
      milestone: true,
      memo: 'line 1\n---\nline 3',
    }
    const body = taskBody(fields)
    expect(isTaskNote({ body })).toBe(true)
    expect(parseTaskBody(body)).toEqual(fields)
  })

  it('ignores garbage and clamps progress', () => {
    const p = parseTaskBody('%koutei v1\nplan: nope ~ 2026-13\nprogress: 250')
    expect(p.planStart).toBeNull()
    expect(p.progress).toBe(100)
  })

  it('merges edits to different fields from two devices', () => {
    const base = taskBody({ parentId: null, planStart: '2026-11-16', planEnd: '2026-11-20', actualStart: null, actualEnd: null, progress: 0, owner: '', milestone: false, memo: '' })
    const phone = base.replace('progress: 0', 'progress: 60')
    const pc = base.replace('plan: 2026-11-16 ~ 2026-11-20', 'plan: 2026-11-16 ~ 2026-11-25')
    const merged = mergeText(base, phone, pc)
    expect(merged).not.toBeNull()
    expect(parseTaskBody(merged!)).toMatchObject({ progress: 60, planEnd: '2026-11-25' })
  })
})

describe('calendar', () => {
  it('knows weekdays and Japanese holidays', () => {
    expect(weekdayOf(dayOf('2026-11-15'))).toBe(0) // Sunday
    expect(holidayOf(dayOf('2026-11-23'))).toBe('勤労感謝の日')
    expect(holidayOf(dayOf('2026-05-06'))).toBe('振替休日')
    expect(holidayOf(dayOf('2026-11-24'))).toBeNull()
  })
})

describe('rows', () => {
  const tasks = [
    task('a', { name: '設計', position: 1 }),
    task('a1', { name: '図面', parentId: 'a', position: 1, planStart: '2026-11-02', planEnd: '2026-11-11', progress: 100 }),
    task('a2', { name: '部品表', parentId: 'a', position: 2, planStart: '2026-11-12', planEnd: '2026-11-21', progress: 0 }),
    task('b', { name: '製作', position: 2, planStart: '2026-12-01', planEnd: '2026-12-10' }),
    task('x', { name: 'orphan', parentId: 'gone', position: 3 }),
  ]

  it('numbers WBS and rolls summaries up, weighted by duration', () => {
    const rows = buildRows(tasks)
    expect(rows.map((r) => `${r.wbs} ${r.task.name}`)).toEqual(['1 設計', '1.1 図面', '1.2 部品表', '2 製作', '3 orphan'])
    const a = rows[0]
    expect(a.hasChildren).toBe(true)
    expect([a.planStart, a.planEnd, a.progress]).toEqual(['2026-11-02', '2026-11-21', 50])
  })

  it('hides collapsed subtrees, and search keeps ancestors', () => {
    const rows = buildRows(tasks)
    expect(visibleRows(rows, new Set(['a']), '').map((r) => r.task.id)).toEqual(['a', 'b', 'x'])
    expect(visibleRows(rows, new Set(['a']), '部品').map((r) => r.task.id)).toEqual(['a', 'a2'])
  })

  it('places the イナズマ線 and flags late tasks', () => {
    const rows = buildRows(tasks)
    const today = dayOf('2026-11-16') // a2 planned 11/12–11/21: 4.5 of 10 days due
    const a2 = rows[2]
    expect(isLate(a2, today)).toBe(true)
    expect(inazumaPoint(a2, today)).toBe(dayOf('2026-11-12')) // 0% → its start, left of today
    expect(inazumaPoint(rows[1], today)).toBe(today + 0.5) // finished
    expect(inazumaPoint(rows[3], today)).toBe(today + 0.5) // not started yet
    expect(isLate(rows[3], today)).toBe(false)
  })
})
