/**
 * Download the schedule as a 工程表 workbook (Excel) or CSV.
 * Everything happens in the browser: the decrypted tasks never leave this device unencrypted.
 */
import { dayOf, holidayOf, isLate, isoOf, todayIso, weekdayOf, type Row } from './tasks'
import type { MessageKey } from '@/i18n'

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

const stamp = () => todayIso().replaceAll('-', '')

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const wbsOf = (rows: Row[]) => new Map(rows.map((r) => [r.task.id, r.wbs]))

function columns(t: T) {
  return ['WBS', t('kt.colName'), t('kt.owner'), `${t('kt.plan')} ${t('kt.start')}`, `${t('kt.plan')} ${t('kt.end')}`, `${t('kt.actual')} ${t('kt.start')}`, `${t('kt.actual')} ${t('kt.end')}`, `${t('kt.progress')} (%)`, t('kt.after'), t('kt.memo')]
}

// ------------------------------------------------------------------ CSV

export function exportCsv(rows: Row[], t: T) {
  const wbs = wbsOf(rows)
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const lines = [columns(t)]
  for (const r of rows)
    lines.push([
      r.wbs,
      `${'  '.repeat(r.depth)}${r.task.name}`,
      r.task.owner,
      r.planStart ?? '',
      r.planEnd ?? '',
      r.actualStart ?? '',
      r.actualEnd ?? '',
      String(r.progress),
      r.task.after.map((id) => wbs.get(id) ?? '').filter(Boolean).join(' '),
      r.task.memo,
    ])
  // BOM + CRLF so Excel opens Japanese and Vietnamese text correctly.
  const csv = '﻿' + lines.map((l) => l.map(esc).join(',')).join('\r\n') + '\r\n'
  save(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `koutei-${stamp()}.csv`)
}

// ------------------------------------------------------------------ Excel

const ARGB = {
  head: 'FFE6F2F2',
  border: 'FFD3DADA',
  bar: 'FF4FA3A5',
  barLight: 'FFCDE6E7',
  late: 'FFD9534F',
  lateLight: 'FFF6D4D3',
  sum: 'FF8A9099',
  sumLight: 'FFDDE0E4',
  actual: 'FF3E9B5F',
  sat: 'FFE8F0FB',
  sun: 'FFFBE9EA',
  today: 'FFF97316',
}

/** A 工程表 sheet: the task table on the left, one narrow column per day on the right with the bars painted in. */
export async function exportExcel(rows: Row[], t: T, title: string) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'NoteFlarePlus'
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', xSplit: 8, ySplit: 4, showGridLines: false }] })

  const today = dayOf(todayIso())
  const days: number[] = [today]
  for (const r of rows) for (const d of [r.planStart, r.planEnd, r.actualStart, r.actualEnd]) if (d) days.push(dayOf(d))
  let first = Math.min(...days)
  first -= (weekdayOf(first) + 6) % 7 // from a Monday
  const last = Math.max(...days) + 2
  const nDays = last - first + 1
  const D0 = 9 // first day column (I)

  const wbs = wbsOf(rows)
  const head = columns(t)
  const fixed = [
    { header: head[0], width: 7 },
    { header: head[1], width: 34 },
    { header: head[2], width: 10 },
    { header: head[3], width: 11 },
    { header: head[4], width: 11 },
    { header: head[5], width: 11 },
    { header: head[6], width: 11 },
    { header: head[7], width: 8 },
  ]
  fixed.forEach((c, i) => (ws.getColumn(i + 1).width = c.width))
  for (let i = 0; i < nDays; i++) ws.getColumn(D0 + i).width = 3.2

  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const thin = { style: 'thin' as const, color: { argb: ARGB.border } }

  // Row 1: title. Row 3: months. Row 4: column names and day numbers.
  ws.getCell(1, 1).value = title
  ws.getCell(1, 1).font = { bold: true, size: 14 }
  ws.getCell(1, 4).value = `${todayIso()}`
  ws.getCell(1, 4).font = { color: { argb: 'FF6B7280' } }

  for (let c = 1; c <= 8; c++) {
    ws.mergeCells(3, c, 4, c)
    const cell = ws.getCell(3, c)
    cell.value = fixed[c - 1].header
    cell.font = { bold: true }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.fill = fill(ARGB.head)
    cell.border = { top: thin, bottom: thin, left: thin, right: thin }
  }
  let monthStart = 0
  for (let i = 0; i <= nDays; i++) {
    const iso = i < nDays ? isoOf(first + i) : ''
    if (i === nDays || (i > 0 && iso.endsWith('-01'))) {
      ws.mergeCells(3, D0 + monthStart, 3, D0 + i - 1)
      const cell = ws.getCell(3, D0 + monthStart)
      cell.value = isoOf(first + monthStart).slice(0, 7)
      cell.font = { bold: true }
      cell.fill = fill(ARGB.head)
      cell.alignment = { horizontal: 'left' }
      monthStart = i
    }
    if (i === nDays) break
    const day = first + i
    const w = weekdayOf(day)
    const off = w === 0 || !!holidayOf(day)
    const cell = ws.getCell(4, D0 + i)
    cell.value = Number(iso.slice(8))
    cell.alignment = { horizontal: 'center' }
    cell.font = { size: 9, bold: day === today, color: { argb: day === today ? ARGB.today : off ? 'FFC0392B' : w === 6 ? 'FF2F6FB3' : 'FF374151' } }
    cell.fill = fill(off ? ARGB.sun : w === 6 ? ARGB.sat : ARGB.head)
    cell.border = { bottom: thin, left: thin }
  }

  rows.forEach((r, k) => {
    const y = 5 + k
    const late = !r.hasChildren && isLate(r, today)
    const vals = [r.wbs, `${'　'.repeat(r.depth)}${r.task.milestone && !r.hasChildren ? '◆ ' : ''}${r.task.name}`, r.task.owner, r.planStart, r.planEnd, r.actualStart, r.actualEnd, r.progress / 100]
    vals.forEach((v, i) => {
      const cell = ws.getCell(y, i + 1)
      if (i >= 3 && i <= 6 && v) {
        const [yy, mm, dd] = String(v).split('-').map(Number)
        cell.value = new Date(Date.UTC(yy, mm - 1, dd))
        cell.numFmt = 'm/d'
        cell.alignment = { horizontal: 'center' }
      } else cell.value = v as string | number
      if (i === 7) {
        cell.numFmt = '0%'
        cell.alignment = { horizontal: 'center' }
        if (late) cell.font = { bold: true, color: { argb: ARGB.late } }
      }
      if (r.hasChildren) cell.font = { ...(cell.font ?? {}), bold: true }
      cell.border = { bottom: thin, left: thin, right: thin }
    })
    if (r.task.after.length) ws.getCell(y, 2).note = `${t('kt.after')}: ${r.task.after.map((id) => wbs.get(id)).filter(Boolean).join(', ')}`

    // Calendar cells: weekends shaded, plan painted, the done share darker, a milestone as ◆.
    const ps = r.planStart ? dayOf(r.planStart) : null
    const pe = r.planEnd ? dayOf(r.planEnd) : null
    const doneUntil = ps !== null && pe !== null ? ps + Math.round((pe - ps + 1) * (r.progress / 100)) - 1 : -Infinity
    const as = r.actualStart ? dayOf(r.actualStart) : null
    const ae = r.actualStart ? (r.actualEnd ? dayOf(r.actualEnd) : today) : null
    for (let i = 0; i < nDays; i++) {
      const day = first + i
      const cell = ws.getCell(y, D0 + i)
      const w = weekdayOf(day)
      const off = w === 0 || !!holidayOf(day)
      let bg = off ? ARGB.sun : w === 6 ? ARGB.sat : null
      if (ps !== null && pe !== null && day >= ps && day <= pe) {
        if (r.task.milestone && !r.hasChildren) {
          cell.value = '◆'
          cell.alignment = { horizontal: 'center' }
        } else if (r.hasChildren) bg = day <= doneUntil ? ARGB.sum : ARGB.sumLight
        else if (late) bg = day <= doneUntil ? ARGB.late : ARGB.lateLight
        else bg = day <= doneUntil ? ARGB.bar : ARGB.barLight
      }
      if (bg) cell.fill = fill(bg)
      // 実績 as a green underline.
      const actual = as !== null && ae !== null && day >= as && day <= ae
      cell.border = { bottom: actual ? { style: 'thick', color: { argb: ARGB.actual } } : thin, left: day === today ? { style: 'thin', color: { argb: ARGB.today } } : undefined }
    }
  })

  ws.getRow(4).height = 16
  // Prints on one page width, landscape, header rows repeated (scaled to fit).
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:4', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } }
  const buf = await wb.xlsx.writeBuffer()
  save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `koutei-${stamp()}.xlsx`)
}
