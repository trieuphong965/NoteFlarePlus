import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Diamond, ListPlus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NOTE_COLORS } from '@/lib/crypto'
import { cn } from '@/lib/utils'
import { dayOf, predecessorOptions, subtreeIds, todayIso, type Row, type Task } from '@/lib/tasks'
import { useI18n } from '@/i18n'
import { colorVar } from './noteColors'
import { DateRangeField } from './DateRangeField'

interface Props {
  row: Row | null
  /** Every live row, for the parent picker. */
  rows: Row[]
  isNew: boolean
  onClose: () => void
  onSave: (t: Task) => void
  onDelete: (t: Task) => void
  onAddChild: (t: Task) => void
  onMove: (t: Task, dir: -1 | 1) => void
}

export function TaskDialog({ row, rows, isNew, onClose, onSave, onDelete, onAddChild, onMove }: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Task | null>(null)
  useEffect(() => setDraft(row ? { ...row.task } : null), [row])

  const parents = useMemo(() => {
    if (!row) return []
    const banned = new Set(subtreeIds(rows.map((r) => r.task), row.task.id))
    return rows.filter((r) => !banned.has(r.task.id))
  }, [row, rows])

  // Predecessors: no loops, nothing inside this task, none of its parents.
  const preds = useMemo(() => {
    if (!row) return []
    const tasks = rows.map((r) => r.task)
    const ok = new Set(predecessorOptions(tasks, row.task.id).map((t) => t.id))
    for (const id of subtreeIds(tasks, row.task.id)) ok.delete(id)
    for (let p = row.task.parentId; p; p = tasks.find((t) => t.id === p)?.parentId ?? null) ok.delete(p)
    return rows.filter((r) => ok.has(r.task.id))
  }, [row, rows])
  const byId = useMemo(() => new Map(rows.map((r) => [r.task.id, r])), [rows])

  if (!row || !draft) return <Dialog open={false} />
  const summary = row.hasChildren
  const set = (patch: Partial<Task>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const setProgress = (p: number) => {
    const progress = Math.min(100, Math.max(0, Math.round(p)))
    const patch: Partial<Task> = { progress }
    // A started task has an actual start; a finished one an actual end.
    if (progress > 0 && !draft.actualStart) patch.actualStart = todayIso()
    if (progress === 100 && !draft.actualEnd) patch.actualEnd = todayIso()
    set(patch)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const out = { ...draft, name: draft.name.trim() }
    if (out.planStart && out.planEnd && out.planEnd < out.planStart) out.planEnd = out.planStart
    if (out.actualStart && out.actualEnd && out.actualEnd < out.actualStart) out.actualEnd = out.actualStart
    if (out.milestone && out.planEnd) out.planStart = out.planEnd
    onSave(out)
  }

  const days = (a: string | null, b: string | null) => (a && b && b >= a ? t('kt.days', { n: dayOf(b) - dayOf(a) + 1 }) : '')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* Tall content scrolls inside the dialog; the action bar stays visible at the bottom. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto overscroll-contain pb-0 max-sm:pb-0">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{row.wbs}</span>
              {isNew ? t('kt.newTitle') : t('kt.editTitle')}
            </DialogTitle>
          </DialogHeader>

          <Field label={t('kt.name')}>
            <Input autoFocus={isNew} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('kt.untitled')} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('kt.parent')}>
              <select
                value={draft.parentId ?? ''}
                onChange={(e) => set({ parentId: e.target.value || null })}
                className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">{t('kt.noParent')}</option>
                {parents.map((r) => (
                  <option key={r.task.id} value={r.task.id}>
                    {'　'.repeat(r.depth)}
                    {r.wbs} {r.task.name || t('kt.untitled')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('kt.owner')}>
              <Input value={draft.owner} onChange={(e) => set({ owner: e.target.value })} />
            </Field>
          </div>

          {/* A group, not a <label>: a label would forward clicks to the first chip's remove button. */}
          <div role="group" aria-label={t('kt.after')} className="grid gap-1.5 text-sm">
            <span className="font-medium text-muted-foreground">{t('kt.after')}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.after.map((id) => {
                const r = byId.get(id)
                if (!r) return null
                return (
                  <span key={id} className="flex h-8 max-w-full items-center gap-1 rounded-full border bg-surface pr-1 pl-3 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{r.wbs}</span>
                    <span className="truncate">{r.task.name || t('kt.untitled')}</span>
                    <button
                      type="button"
                      aria-label={t('kt.clear')}
                      onClick={() => set({ after: draft.after.filter((a) => a !== id) })}
                      className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                )
              })}
              <select
                value=""
                aria-label={t('kt.afterAdd')}
                onChange={(e) => e.target.value && set({ after: [...draft.after, e.target.value] })}
                className="h-8 max-w-full min-w-0 rounded-full border border-dashed border-input bg-transparent px-3 text-sm text-muted-foreground outline-none hover:border-foreground/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">{t('kt.afterAdd')}</option>
                {preds
                  .filter((r) => !draft.after.includes(r.task.id))
                  .map((r) => (
                    <option key={r.task.id} value={r.task.id}>
                      {'\u3000'.repeat(r.depth)}
                      {r.wbs} {r.task.name || t('kt.untitled')}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {summary ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t('kt.rollup')}: {row.planStart ?? '—'} ~ {row.planEnd ?? '—'} · {row.progress}%
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`${draft.milestone ? t('kt.milestone') : t('kt.plan')} ${draft.milestone ? '' : days(draft.planStart, draft.planEnd)}`}>
                  <DateRangeField
                    label={t('kt.plan')}
                    start={draft.milestone ? draft.planEnd : draft.planStart}
                    end={draft.planEnd}
                    single={draft.milestone}
                    placeholder={t('kt.pickStart')}
                    onChange={(planStart, planEnd) => set({ planStart, planEnd })}
                  />
                </Field>
                <Field label={`${t('kt.actual')} ${days(draft.actualStart, draft.actualEnd)}`}>
                  <DateRangeField
                    label={t('kt.actual')}
                    start={draft.actualStart}
                    end={draft.actualEnd}
                    placeholder="—"
                    onChange={(actualStart, actualEnd) => set({ actualStart, actualEnd })}
                  />
                </Field>
              </div>
              <Field label={`${t('kt.progress')} ${draft.progress}%`}>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={draft.progress}
                    onChange={(e) => setProgress(Number(e.target.value))}
                    className="h-8 min-w-0 flex-1 accent-[var(--primary)]"
                  />
                  <div className="flex gap-1">
                    {[0, 50, 100].map((p) => (
                      <Button key={p} type="button" size="sm" variant={draft.progress === p ? 'default' : 'outline'} className="h-8 px-2.5 tabular-nums" onClick={() => setProgress(p)}>
                        {p}
                      </Button>
                    ))}
                  </div>
                </div>
              </Field>
            </>
          )}

          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <Field label={t('kt.color')}>
              <div className="flex flex-wrap gap-1.5">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={draft.color === c}
                    onClick={() => set({ color: c })}
                    className={cn('size-7 rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', draft.color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
                    style={{ background: colorVar(c) }}
                  />
                ))}
              </div>
            </Field>
            {!summary && (
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.milestone} onChange={(e) => set({ milestone: e.target.checked })} className="size-4 accent-[var(--primary)]" />
                <Diamond className="size-3.5" /> {t('kt.milestone')}
              </label>
            )}
          </div>

          <Field label={t('kt.memo')}>
            <Textarea rows={2} value={draft.memo} onChange={(e) => set({ memo: e.target.value })} />
          </Field>

          <DialogFooter className="sticky bottom-0 z-10 -mx-6 items-center border-t bg-background px-6 py-3 max-sm:-mx-5 max-sm:px-5 sm:justify-between">
            <div className="flex flex-wrap gap-1">
              {!isNew && (
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onAddChild(draft)}>
                    <ListPlus /> {t('kt.addChild')}
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t('kt.moveUp')} title={t('kt.moveUp')} onClick={() => onMove(draft, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t('kt.moveDown')} title={t('kt.moveDown')} onClick={() => onMove(draft, 1)}>
                    <ArrowDown />
                  </Button>
                </>
              )}
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onDelete(draft)}>
                <Trash2 /> {t('kt.delete')}
              </Button>
            </div>
            <Button type="submit" className="max-sm:w-full">{t('kt.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
