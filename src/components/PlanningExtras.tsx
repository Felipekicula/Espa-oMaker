import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { PlanningDialog } from './PlanningDialog'
import type { AppUserOption } from '../services/appUsers'
import { addTimeOff, convertToSteps, listEstimateLog, planningError, removeTimeOff } from '../services/planning'
import type { EstimateLog, Period, PlanningData, WorkItem } from '../types/planning'
import { formatDay, hours, today } from '../utils/planning'

const modeName = { estimativa: 'Estimativa', faixa: 'Faixa', indefinida: 'Ainda não sei' }
const reasonName = { inicial: 'Estimativa original', revisao: 'Revisão', transformacao: 'Transformada em etapas', folga: 'Uso da folga protegida' }

/** Estimativa, proteção e histórico: ficam nos detalhes para o cartão continuar simples. */
export function EstimateDetails({ item, users }: { item: WorkItem; users: AppUserOption[] }) {
  const [log, setLog] = useState<EstimateLog[] | null>(null)
  useEffect(() => { let alive = true; listEstimateLog(item.id).then(rows => { if (alive) setLog(rows) }).catch(() => { if (alive) setLog([]) }); return () => { alive = false } }, [item.id, item.remaining_minutes])
  if (!item.estimate_mode) return null
  return <section className="planner-history">
    <dl className="board-facts">
      <div><dt>Como foi estimado</dt><dd>{modeName[item.estimate_mode]}</dd></div>
      {item.estimate_mode === 'indefinida'
        ? <div><dt>Revisar em</dt><dd>{item.review_on ? formatDay(item.review_on) : 'a definir'}</dd></div>
        : <div><dt>Trabalho previsto + proteção</dt><dd>{hours(item.work_minutes ?? 0)} + {hours(item.protection_minutes ?? 0)}</dd></div>}
    </dl>
    <details>
      <summary>Histórico da estimativa{log ? ` · ${log.length}` : ''}</summary>
      <ul>{(log ?? []).map(row => <li key={row.id}>
        <b>{formatDay(row.created_at.slice(0, 10))} · {reasonName[row.reason]}</b>
        <span>{users.find(u => u.id === row.created_by)?.name || 'Equipe'}
          {row.reason !== 'folga' && row.mode && <> · {row.mode === 'indefinida' ? 'ainda sem estimativa' : `${hours(row.work_minutes ?? 0)} de trabalho + ${hours(row.protection_minutes ?? 0)} de proteção`}</>}
          {row.low_minutes !== null && row.high_minutes !== null && <> · faixa de {hours(row.low_minutes)} a {hours(row.high_minutes)}</>}
          {row.note && <> · {row.note}</>}</span>
      </li>)}</ul>
      <p className="planning-meta">Proteção é reserva contra erro de estimativa. Horas reservadas não são horas trabalhadas.</p>
    </details>
  </section>
}

interface StepRow { title: string; work: number; protection: number; assignee: string }

/** Demanda inteira -> etapas: redistribui o trabalho; o banco repassa as reservas sem duplicar. */
export function ConvertDialog({ card, users, onDone, onClose }: { card: WorkItem; users: AppUserOption[]; onDone: (message: string) => void; onClose: () => void }) {
  const blank = (): StepRow => ({ title: '', work: 0, protection: 0, assignee: card.assignee_id || '' })
  const [rows, setRows] = useState<StepRow[]>([blank(), blank()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (i: number, patch: Partial<StepRow>) => setRows(all => all.map((r, n) => n === i ? { ...r, ...patch } : r))
  const total = rows.reduce((sum, r) => sum + (r.work + r.protection) * 60, 0), before = (card.work_minutes ?? 0) + (card.protection_minutes ?? 0)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const steps = rows.filter(r => r.title.trim() || r.work > 0)
    if (!steps.length || steps.some(r => !r.title.trim() || r.work <= 0)) { setError('Cada etapa precisa de nome e de horas de trabalho.'); return }
    setBusy(true); setError('')
    try {
      await convertToSteps(card.id, steps.map(r => ({ title: r.title.trim(), work_minutes: Math.round(r.work * 60), protection_minutes: Math.round(r.protection * 60), assignee_id: r.assignee || null })))
      onDone(`${card.title} foi transformada em ${steps.length} etapas. As reservas futuras foram repassadas sem duplicar horas; o que não coube ficou em "A agendar".`)
    } catch (err) { setError(`Não foi gravado: ${planningError(err)} Nada foi alterado.`) } finally { setBusy(false) }
  }
  return <PlanningDialog title={`Transformar em etapas: ${card.title}`} onClose={() => { if (!busy) onClose() }}><form onSubmit={submit} className="space-y-3">
    {error && <p role="alert" className="planning-error">{error}</p>}
    <p className="planning-meta">Hoje o cartão tem {hours(card.work_minutes ?? 0)} de trabalho e {hours(card.protection_minutes ?? 0)} de proteção. Distribua entre as etapas. As reservas futuras passam, em ordem, para as etapas do mesmo responsável; as de hoje ou vencidas voltam para "A agendar".</p>
    {rows.map((r, i) => <div key={i} className="planner-step">
      <input className="ctp-input" placeholder={`Etapa ${i + 1}`} aria-label={`Nome da etapa ${i + 1}`} value={r.title} onChange={e => set(i, { title: e.target.value })} />
      <input className="ctp-input" type="number" min={0} step={0.25} aria-label={`Trabalho da etapa ${i + 1} em horas`} placeholder="Trabalho h" value={r.work || ''} onChange={e => set(i, { work: Number(e.target.value) })} />
      <input className="ctp-input" type="number" min={0} step={0.25} aria-label={`Proteção da etapa ${i + 1} em horas`} placeholder="Proteção h" value={r.protection || ''} onChange={e => set(i, { protection: Number(e.target.value) })} />
      <select className="ctp-input" aria-label={`Responsável da etapa ${i + 1}`} value={r.assignee} onChange={e => set(i, { assignee: e.target.value })}>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
    </div>)}
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows(all => [...all, blank()])}>+ Outra etapa</button>
    <p className={total === before ? 'planning-meta' : 'planning-warning'}>Etapas somam {hours(total)}; o cartão tinha {hours(before)}.{total !== before && ' A diferença fica registrada no histórico como revisão da estimativa.'}</p>
    <button type="submit" className="btn btn-lime" disabled={busy}>{busy ? 'Gravando…' : 'Transformar em etapas'}</button>
  </form></PlanningDialog>
}

/** Feriados (toda a equipe) e ausências: tiram a capacidade do período, na tela e no banco. */
export function CalendarDialog({ data, users, now, onChanged, onClose }: { data: PlanningData; users: AppUserOption[]; now: Date; onChanged: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const upcoming = data.timeOff.filter(o => o.day >= today(now))
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action(); await onChanged() } catch (e) { setError(planningError(e)) } finally { setBusy(false) }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, f = new FormData(form)
    void run(async () => { await addTimeOff({ user_id: String(f.get('who')) || null, day: String(f.get('day')), period: (String(f.get('period')) || null) as Period | null, reason: String(f.get('reason')).trim() }); form.reset() })
  }
  return <PlanningDialog title="Feriados e ausências" onClose={() => { if (!busy) onClose() }}>
    {error && <p role="alert" className="planning-error mb-3">{error}</p>}
    <p className="planning-meta mb-3">O que estiver aqui deixa de contar como tempo disponível. Reservas já feitas nesses períodos não são removidas: aparecem como excedidas para você remanejar.</p>
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <label className="ctp-label">Quem<select name="who" className="ctp-input"><option value="">Toda a equipe (feriado)</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="ctp-label">Dia<input name="day" type="date" required min={today(now)} className="ctp-input" /></label>
      <label className="ctp-label">Período<select name="period" className="ctp-input"><option value="">Dia inteiro</option><option value="manha">Manhã</option><option value="tarde">Tarde</option></select></label>
      <label className="ctp-label">Motivo<input name="reason" required maxLength={80} className="ctp-input" placeholder="Feriado, férias, consulta…" /></label>
      <button type="submit" className="btn btn-lime" disabled={busy}>Cadastrar</button>
    </form>
    <ul className="dash-list mt-4">
      {upcoming.map(o => <li key={o.id}>
        <div><b>{formatDay(o.day)}{o.period ? ` · ${o.period === 'manha' ? 'manhã' : 'tarde'}` : ''} · {o.reason}</b><p className="planning-meta">{o.user_id ? users.find(u => u.id === o.user_id)?.name : 'Toda a equipe'}</p></div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Remover ${o.reason} de ${formatDay(o.day)}`} onClick={() => void run(() => removeTimeOff(o.id))}><Trash2 size={14} /></button>
      </li>)}
      {!upcoming.length && <li className="planning-meta">Nada cadastrado daqui para a frente. O cálculo usa só os horários e eventos conhecidos.</li>}
    </ul>
  </PlanningDialog>
}
