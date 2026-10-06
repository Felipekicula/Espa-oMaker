import { useMemo, useState } from 'react'
import { PlanningDialog } from './PlanningDialog'
import type { AppUserOption } from '../services/appUsers'
import { acceptPlan, planningError, type PlanPayload } from '../services/planning'
import { DEFAULT_SLACK_PERCENT, type PlanningBlock, type PlanningData, type WorkItem } from '../types/planning'
import { blocksByPeriod, propose, slackLimit, type Allocation, type EstimateMode, type Scenario } from '../utils/planner'
import { periodsFor } from '../utils/plannerPeriods'
import { formatDay, hours, today } from '../utils/planning'

/** O que está sendo planejado: uma demanda inteira (cartão novo) ou uma etapa que já existe. */
export interface PlannerTarget {
  title: string
  ticketId?: string
  item?: WorkItem
  /** Bloco que terminou sem concluir o trabalho e motivou a revisão. */
  fromBlock?: PlanningBlock
  deadline: string | null
  assigneeId: string | null
  lockAssignee: boolean
}

const HORIZON_WORKDAYS = 40 // 8 semanas
const periodName = { manha: 'manhã', tarde: 'tarde' }
const purposeName = { trabalho: 'trabalho', protecao: 'proteção', investigacao: 'investigação' }
const MODES: { value: EstimateMode; label: string; hint: string }[] = [
  { value: 'estimativa', label: 'Tenho uma estimativa', hint: 'Horas de trabalho e, se quiser, uma margem.' },
  { value: 'faixa', label: 'Tenho uma faixa', hint: 'Um cenário menor e um maior.' },
  { value: 'indefinida', label: 'Não sei ainda', hint: 'Reserva um bloco para investigar e marca uma revisão.' },
]

/** Situação frente ao prazo, com o tom do destaque: sobra, no limite ou depois do prazo. */
function standing(allocation: Allocation, workdays: number | null, deadline: string | null): { text: string; tone: 'good' | 'tight' | 'late' | 'plain' } {
  if (!allocation.end) return { text: `${hours(allocation.unplaced)} sem lugar nos horários conhecidos`, tone: 'late' }
  if (!deadline || workdays === null) return { text: 'Sem prazo oficial para comparar', tone: 'plain' }
  if (workdays === 0) return { text: 'No dia do prazo, sem sobra', tone: 'tight' }
  const days = `${Math.abs(workdays)} ${Math.abs(workdays) === 1 ? 'dia útil' : 'dias úteis'}`
  return workdays > 0 ? { text: `${days} de sobra`, tone: 'good' } : { text: `${days} depois do prazo`, tone: 'late' }
}
const endText = (allocation: Allocation) => allocation.end ? `${formatDay(allocation.end.day)}, ${periodName[allocation.end.period]}` : 'Não cabe'

export function PlannerDialog({ target, data, users, activeBlocks, now, onAccepted, onRefused, onClose }: {
  target: PlannerTarget; data: PlanningData; users: AppUserOption[]; activeBlocks: PlanningBlock[]; now: Date
  onAccepted: (message: string) => void; onRefused: () => Promise<void>; onClose: () => void
}) {
  const [mode, setMode] = useState<EstimateMode>('estimativa')
  const [assignee, setAssignee] = useState(target.assigneeId || '')
  const [workHours, setWorkHours] = useState(target.item?.work_minutes ? target.item.work_minutes / 60 : 0)
  const [margin, setMargin] = useState(20)
  const [lowHours, setLowHours] = useState(0)
  const [highHours, setHighHours] = useState(0)
  const [investigationHours, setInvestigationHours] = useState(2)
  const [reviewOn, setReviewOn] = useState('')
  const [start, setStart] = useState(today(now))
  // A folga protegida nunca vem autorizada: quem quiser usá-la marca e confirma.
  const [useSlack, setUseSlack] = useState(false)
  const [skip, setSkip] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const person = users.find(u => u.id === assignee)
  const slackPercent = data.settings.find(s => s.user_id === assignee)?.slack_percent ?? DEFAULT_SLACK_PERCENT
  const ready = !!assignee && (mode === 'estimativa' ? workHours > 0 : mode === 'faixa' ? lowHours > 0 && highHours >= lowHours : investigationHours > 0)
  const proposal = useMemo(() => {
    if (!ready) return null
    const periods = periodsFor(assignee, start, HORIZON_WORKDAYS, data.availability, data.busy, activeBlocks, now, target.item?.id)
    return propose({
      mode, periods, slackPercent, useSlack, skip, deadline: target.deadline,
      workMinutes: workHours * 60, marginPercent: margin, lowMinutes: lowHours * 60, highMinutes: highHours * 60, investigationMinutes: investigationHours * 60,
    })
  }, [ready, assignee, start, data, activeBlocks, now, target, mode, slackPercent, useSlack, skip, workHours, margin, lowHours, highHours, investigationHours])
  const groups = proposal ? blocksByPeriod(proposal.plan.blocks) : []
  const firstDay = proposal?.plan.blocks[0]?.day ?? null
  const reset = () => { setSkip([]); setError('') }
  // O que a pessoa digitou, antes de arredondar para blocos de 15 minutos.
  const rawWork = Math.round((mode === 'faixa' ? lowHours : workHours) * 60)
  const rawProtection = mode === 'estimativa' ? Math.round(workHours * 60 * margin / 100) : Math.round(Math.max(0, highHours - lowHours) * 60)
  const rounded = !!proposal && mode !== 'indefinida' && (proposal.workMinutes !== rawWork || proposal.protectionMinutes !== rawProtection)

  async function accept(onlyBeforeDeadline: boolean) {
    if (!proposal || !assignee) return
    const blocks = proposal.plan.blocks.filter(b => !onlyBeforeDeadline || !target.deadline || b.day <= target.deadline)
    if (!blocks.length) { setError('Não há blocos para reservar nesta proposta.'); return }
    const slack = blocks.reduce((sum, b) => sum + b.slackUsed, 0)
    // Entrar na folga protegida nunca é automático.
    if (slack > 0 && !window.confirm(`Esta proposta usa ${hours(slack)} da folga protegida de ${person?.name}. Confirmar o uso da folga?`)) return
    const payload: PlanPayload = {
      mode, assignee_id: assignee, use_slack: slack > 0,
      work_minutes: proposal.workMinutes, protection_minutes: proposal.protectionMinutes,
      blocks: blocks.map(b => ({ day: b.day, period: b.period, minutes: b.minutes, purpose: b.purpose })),
      ...(mode === 'faixa' ? { low_minutes: Math.round(lowHours * 60), high_minutes: Math.round(highHours * 60) } : {}),
      ...(mode === 'indefinida' ? { review_on: reviewOn || firstDay } : {}),
      ...(target.item ? { item_id: target.item.id, replace_from_block: target.fromBlock?.id } : { ticket_id: target.ticketId, title: target.title, scope: 'demanda' as const }),
    }
    setBusy(true); setError('')
    try {
      await acceptPlan(payload)
      const reserved = blocks.reduce((sum, b) => sum + b.minutes, 0), end = proposal.plan.end
      onAccepted(`Proposta aceita: ${target.title}, ${hours(reserved)} reservadas em ${blocksByPeriod(blocks).length} ${blocksByPeriod(blocks).length === 1 ? 'período' : 'períodos'}.`
        + (mode === 'indefinida' ? ` Revisão da estimativa em ${formatDay(reviewOn || firstDay!)}.` : end && !onlyBeforeDeadline ? ` Previsão de conclusão: ${formatDay(end.day)}.` : '')
        + ' O prazo oficial não foi alterado.')
    } catch (e) {
      // O banco recusou (por exemplo, outra reserva entrou antes): nada foi gravado.
      await onRefused().catch(() => {})
      setError(`Não foi gravado: ${planningError(e)} Nada foi reservado. A proposta abaixo já usa a agenda atualizada.`)
    } finally { setBusy(false) }
  }

  const number = (value: number, set: (n: number) => void, label: string, props: { min?: number; max?: number; step?: number } = {}) =>
    <label className="ctp-label">{label}<input type="number" className="ctp-input" min={props.min ?? 0.25} max={props.max} step={props.step ?? 0.25} value={value || ''} onChange={e => { set(Number(e.target.value)); reset() }} /></label>
  const headline = (label: string, s: Scenario) => { const state = standing(s.allocation, s.workdaysVsDeadline, target.deadline)
    return <div className={`planner-headline ${state.tone}`} key={s.key}>
      <small>{label}</small><b>{endText(s.allocation)}</b><span>{state.text}</span>
    </div> }

  return <PlanningDialog title={target.item ? `Planejar: ${target.title}` : `Planejar demanda inteira: ${target.title}`} onClose={() => { if (!busy) onClose() }}>
    {error && <p role="alert" className="planning-error mb-3">{error}</p>}
    <fieldset className="planner-modes">
      <legend className="ctp-label">O que você sabe sobre o trabalho?</legend>
      {MODES.map(m => <label key={m.value} className={mode === m.value ? 'active' : ''}>
        <input type="radio" name="mode" checked={mode === m.value} onChange={() => { setMode(m.value); reset() }} /> <b>{m.label}</b><small>{m.hint}</small>
      </label>)}
    </fieldset>

    <div className="grid grid-cols-2 gap-3 mt-4">
      <label className="ctp-label">Responsável<select className="ctp-input" value={assignee} disabled={target.lockAssignee} onChange={e => { setAssignee(e.target.value); reset() }}>
        <option value="">Selecione</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select></label>
      <label className="ctp-label">Não começar antes de<input type="date" className="ctp-input" min={today(now)} value={start} onChange={e => { setStart(e.target.value || today(now)); reset() }} /></label>
      {mode === 'estimativa' && <>{number(workHours, setWorkHours, 'Trabalho previsto · horas')}{number(margin, setMargin, 'Margem de erro · %', { min: 0, max: 200, step: 5 })}</>}
      {mode === 'faixa' && <>{number(lowHours, setLowHours, 'Cenário menor · horas')}{number(highHours, setHighHours, 'Cenário maior · horas')}</>}
      {mode === 'indefinida' && <>{number(investigationHours, setInvestigationHours, 'Bloco de investigação · horas', { max: 8 })}
        <label className="ctp-label">Revisar a estimativa em<input type="date" className="ctp-input" min={today(now)} value={reviewOn || firstDay || ''} onChange={e => setReviewOn(e.target.value)} /></label></>}
    </div>

    {!ready && <p className="planning-meta mt-4">Informe o responsável e os valores acima para ver a proposta. Nada é gravado antes de você aceitar.</p>}
    {proposal && <section className="planner-proposal" aria-label="Proposta">
      {/* O que importa primeiro: quando termina e como fica frente ao prazo. */}
      <div className="planner-headlines">
        {mode === 'estimativa' && headline('Conclusão prevista', proposal.scenarios[2])}
        {mode === 'faixa' && <>{headline('Se for o cenário menor', proposal.scenarios[0])}{headline('Se for o cenário maior', proposal.scenarios[1])}</>}
        {mode === 'indefinida' && <div className="planner-headline plain"><small>Conclusão prevista</small><b>Sem previsão</b><span>Ainda não há estimativa. Revisão em {reviewOn || firstDay ? formatDay(reviewOn || firstDay!) : 'data a definir'}.</span></div>}
      </div>
      <p className="planning-meta mt-2">
        {target.deadline ? `Prazo oficial: ${formatDay(target.deadline)}, inalterado.` : 'A demanda não tem prazo oficial.'}
        {mode === 'faixa' && ' São duas previsões; a menor não é um compromisso de entrega.'}
        {mode !== 'indefinida' && proposal.workMinutes !== null && ` Reserva: ${hours(proposal.workMinutes)} de trabalho${proposal.protectionMinutes ? ` + ${hours(proposal.protectionMinutes)} de proteção` : ''}.`}
      </p>
      {rounded && <p className="planning-meta">Arredondado para blocos de 15 minutos: você informou {hours(rawWork)} de trabalho{rawProtection ? ` e ${hours(rawProtection)} de proteção` : ''}; a reserva usa {hours(proposal.workMinutes ?? 0)}{proposal.protectionMinutes ? ` e ${hours(proposal.protectionMinutes)}` : ''}, sempre para cima.</p>}

      {proposal.plan.unplaced > 0 && <p className="planning-error"><b>{hours(proposal.plan.unplaced)} não couberam</b> nos horários conhecidos das próximas 8 semanas. Não foram agendadas.</p>}
      {mode !== 'indefinida' && target.deadline && proposal.afterDeadline > 0 && <p className="planning-warning">Até o prazo cabem {hours(proposal.beforeDeadline)}; <b>{hours(proposal.afterDeadline)} ficam depois do prazo</b>. O prazo oficial não será alterado.</p>}
      {proposal.plan.slackUsed > 0 && <p className="planner-slack-used" role="status">
        <b>Esta proposta usa {hours(proposal.plan.slackUsed)} da folga protegida</b> de {person?.name}, em {proposal.plan.slackPeriods} {proposal.plan.slackPeriods === 1 ? 'período' : 'períodos'}. Ao aceitar, você confirma esse uso e ele fica registrado no histórico.
      </p>}

      <h4 className="ctp-label mt-4">Blocos sugeridos · {hours(proposal.plan.placed)}</h4>
      <ul className="planner-blocks">
        {groups.map(g => { const key = g.day + '|' + g.period, late = !!target.deadline && g.day > target.deadline, slack = g.parts.reduce((sum, p) => sum + p.slackUsed, 0)
          return <li key={key}><label><input type="checkbox" checked onChange={() => setSkip(s => [...s, key])} aria-label={`Usar ${formatDay(g.day)} ${periodName[g.period]}`} />
            <span>{formatDay(g.day)} · {periodName[g.period]}</span><b>{hours(g.minutes)}</b>
            <small>{g.parts.map(p => `${hours(p.minutes)} ${purposeName[p.purpose]}`).join(' + ')}{late ? ' · depois do prazo' : ''}{slack ? ` · usa ${hours(slack)} da folga` : ''}</small></label></li> })}
        {skip.map(key => { const [day, period] = key.split('|') as [string, 'manha' | 'tarde']
          return <li key={key} className="skipped"><label><input type="checkbox" checked={false} onChange={() => setSkip(s => s.filter(k => k !== key))} aria-label={`Usar ${formatDay(day)} ${periodName[period]}`} />
            <span>{formatDay(day)} · {periodName[period]}</span><small>fora da proposta</small></label></li> })}
        {!groups.length && <li className="planning-meta">Nenhum período conhecido comporta este trabalho nas próximas 8 semanas.</li>}
      </ul>

      <label className="planner-slack"><input type="checkbox" checked={useSlack} onChange={e => { setUseSlack(e.target.checked); reset() }} />
        <span>Permitir que esta proposta use a folga protegida de {person?.name} ({slackPercent}% de cada período)</span></label>

      {proposal.scenarios.length > 0 && <details className="planner-compare">
        <summary>Comparar cenários</summary>
        <table className="planner-table">
          <thead><tr><th>Cenário</th><th>Reserva</th><th>Conclusão prevista</th><th>Frente ao prazo</th></tr></thead>
          <tbody>{proposal.scenarios.map(s => <tr key={s.key} className={s.key === 'proposta' || s.key === 'maior' ? 'chosen' : ''}>
            <td>{s.label}</td><td>{hours(s.minutes)}</td><td>{endText(s.allocation)}</td><td>{standing(s.allocation, s.workdaysVsDeadline, target.deadline).text}</td>
          </tr>)}</tbody>
        </table>
        {mode === 'estimativa' && <p className="planning-meta">A margem aumenta o trabalho a reservar; a folga reduz quanto de cada período a proposta usa. A linha destacada é a que será gravada.</p>}
      </details>}
      <details className="planner-premises">
        <summary>Premissas: trabalho humano, disponibilidade conhecida</summary>
        <ul className="planner-fineprint">
          <li>Previsão de trabalho humano, condicionada à disponibilidade conhecida. Tempo de máquina, materiais e dependências precisam ser considerados à parte.</li>
          {mode === 'estimativa' && <li>Margem e folga de 20% são valores iniciais escolhidos pela equipe. Ainda não há histórico que os valide.</li>}
          {mode === 'faixa' && <li>A faixa é a que você informou; não é uma garantia estatística. A diferença até o cenário maior é reservada como proteção.</li>}
          <li>Folga de {slackPercent}%: de um período de 4h ficam {hours(slackLimit(240, slackPercent))} utilizáveis. O limite é arredondado para baixo em blocos de 15 minutos e vale para tudo o que já está reservado no período.</li>
          <li>Horas de trabalho e de proteção são arredondadas para cima em blocos de 15 minutos; não se criam blocos menores que 30 minutos.</li>
          {proposal.unknownPeriods > 0 && <li>{proposal.unknownPeriods} {proposal.unknownPeriods === 1 ? 'período sem horário configurado ficou' : 'períodos sem horário configurado ficaram'} fora da conta.</li>}
          {!data.timeOff.length && <li>Nenhum feriado ou ausência cadastrado: o cálculo considera apenas os horários e eventos conhecidos.</li>}
          <li>Reservar não significa que as horas foram trabalhadas. Os cronômetros não entram neste cálculo.</li>
        </ul>
      </details>
    </section>}

    <div className="flex flex-wrap gap-2 mt-5">
      <button type="button" className="btn btn-lime" disabled={busy || !proposal || !proposal.plan.blocks.length} onClick={() => void accept(false)}>{busy ? 'Gravando…' : 'Aceitar proposta'}</button>
      {proposal && mode !== 'indefinida' && proposal.afterDeadline > 0 && proposal.beforeDeadline > 0 &&
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void accept(true)}>Aceitar só o que cabe até o prazo</button>}
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button>
    </div>
  </PlanningDialog>
}
