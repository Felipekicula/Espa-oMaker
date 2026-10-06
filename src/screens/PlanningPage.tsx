import { useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, ChevronLeft, ChevronRight, Settings, AlertTriangle, Check, GripVertical, CalendarClock, X } from 'lucide-react'
import { LayoutShell } from '../components/LayoutShell'
import { PageHeader } from '../components/PageHeader'
import { PlanningDialog } from '../components/PlanningDialog'
import { usePlanningData } from '../hooks/usePlanningData'
import { completeItem, continueBlock, createWorkItem, planningError, reserveBlock, saveAvailability, saveWorkItem } from '../services/planning'
import type { Availability, Period, PlanningBlock, WorkItem } from '../types/planning'
import { TIMEZONE, availableMinutes, dateAdd, formatDay, hours, isMissed, itemAssessment, mondayOf, reservedMinutes, slotsFor, timeMinutes, today } from '../utils/planning'
import { dropVerdict, unscheduledMinutes, type DropVerdict } from '../utils/planningBoard'

const periods: Period[] = ['manha', 'tarde']
const periodLabel = { manha: 'Manhã', tarde: 'Tarde' }
const kindLabel = { aula: 'Aula', workshop: 'Workshop', reuniao: 'Reunião' }

interface Slot { userId: string; day: string; period: Period }
/** O que está sendo arrastado (ou posicionado por botão): uma etapa da lista ou um bloco da agenda. */
type Carry = { kind: 'item'; item: WorkItem; balance: number } | { kind: 'block'; item: WorkItem; block: PlanningBlock; missed: boolean }
type Dialog =
  | { type: 'item' }
  | { type: 'availability' }
  | { type: 'duration'; item: WorkItem; slot: Slot; free: number | null; balance: number; late: boolean; unknown: boolean }
  | { type: 'move'; item: WorkItem; block: PlanningBlock; slot: Slot; free: number | null; missed: boolean; late: boolean; unknown: boolean }
  | { type: 'block'; blockId: string }
  | { type: 'step'; itemId: string }
  | { type: 'continue'; blockId: string }

const slotKey = (s: Slot) => `${s.userId}|${s.day}|${s.period}`
const slotText = (s: { day: string; period: Period }) => `${formatDay(s.day)} · ${periodLabel[s.period].toLowerCase()}`

export function PlanningPage() {
  const { data, users, tickets, tasks, loading, error, refresh } = usePlanningData()
  const [params, setParams] = useSearchParams()
  const [week, setWeek] = useState(mondayOf(today()))
  const [person, setPerson] = useState('')
  const eventFilter = params.get('evento') || ''
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [carry, setCarry] = useState<Carry | null>(null)
  const [placing, setPlacing] = useState(false)
  const [saving, setSaving] = useState<{ key: string; label: string; blockId?: string } | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [source, setSource] = useState<'ticket' | 'event'>('ticket')
  const [sourceId, setSourceId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [remaining, setRemaining] = useState(2)
  const [blockHours, setBlockHours] = useState(2)
  const [chosenSlot, setChosenSlot] = useState('')
  const [availableUser, setAvailableUser] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmedClosed, setConfirmedClosed] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const clock = window.setInterval(() => setNow(new Date()), 30000); return () => clearInterval(clock) }, [])
  useEffect(() => {
    if (!placing) return
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') { setCarry(null); setPlacing(false) } }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [placing])

  const hoje = today(now)
  const clock = timeMinutes(new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now))
  const activeEventIds = new Set(data.events.filter(e => e.status !== 'cancelled').map(e => e.id))
  const activeTicketIds = new Set(tickets.map(t => t.id))
  const items = data.items.filter(i => i.ticket_id ? activeTicketIds.has(i.ticket_id) : activeEventIds.has(i.event_id || ''))
  // Existing task completion always takes precedence over an older planning copy.
  const effectiveItems = items.map(i => i.ticket_task_id && tasks.find(t => t.id === i.ticket_task_id)?.status === 'concluido' ? { ...i, status: 'completed' as const } : i)
  const itemOf = (id: string) => effectiveItems.find(i => i.id === id)
  const activeBlocks = data.blocks.filter(b => itemOf(b.work_item_id)?.status === 'pending' || b.status === 'done')
  const missed = activeBlocks.filter(b => isMissed(b, data.availability, now) && itemOf(b.work_item_id)?.status === 'pending')
  const dueFor = (i: WorkItem) => {
    const sourceDate = i.ticket_id ? tickets.find(t => t.id === i.ticket_id)?.data_entrega : data.events.find(e => e.id === i.event_id)?.preparation_deadline || data.events.find(e => e.id === i.event_id)?.day
    // Internal target cannot hide an earlier formal delivery date.
    return [i.due_date, sourceDate].filter((d): d is string => !!d).sort()[0] || null
  }
  const nameOf = (id: string | null) => users.find(u => u.id === id)?.name || 'Sem responsável'
  const projectOf = (i: WorkItem) => (i.ticket_id ? tickets.find(t => t.id === i.ticket_id)?.titulo : data.events.find(e => e.id === i.event_id)?.title) || 'Projeto'
  const inScope = (i: WorkItem) => (!person || i.assignee_id === person) && (!eventFilter || i.event_id === eventFilter)

  const backlog = effectiveItems
    .filter(i => i.status === 'pending' && inScope(i))
    .map(item => ({ item, balance: unscheduledMinutes(item.remaining_minutes, item.id, activeBlocks) }))
    .filter(entry => entry.balance === null || entry.balance > 0)
  const missedInScope = missed.filter(b => { const i = itemOf(b.work_item_id); return !!i && inScope(i) })
  const unplannedTasks = tasks.filter(t => activeTicketIds.has(t.ticket_id) && t.status !== 'concluido' && !data.items.some(i => i.ticket_task_id === t.id) && (!person || t.responsavel_id === person))
  const noSteps = tickets.filter(t => !data.items.some(i => i.ticket_id === t.id) && (!person || t.responsavel_id === person || tasks.some(task => task.ticket_id === t.id && task.responsavel_id === person)))
  const days = Array.from({ length: 5 }, (_, n) => dateAdd(week, n))

  function slotInfo(slot: Slot, excludeBlockId?: string) {
    const configured = data.availability.find(a => a.user_id === slot.userId && a.weekday === new Date(slot.day + 'T12:00:00Z').getUTCDay() && a.period === slot.period)
    const closed = !!configured && configured.starts_at === configured.ends_at
    const total = configured ? timeMinutes(configured.ends_at) - timeMinutes(configured.starts_at) : null
    const ended = slot.day < hoje || (slot.day === hoje && !!configured && clock >= timeMinutes(configured.ends_at))
    const withoutClock = availableMinutes(slot.userId, slot.day, slot.period, data.availability, data.events)
    const capacity = availableMinutes(slot.userId, slot.day, slot.period, data.availability, data.events, now)
    const reserved = reservedMinutes(activeBlocks, slot.userId, slot.day, slot.period, excludeBlockId)
    const events = data.events.filter(e => e.status === 'confirmed' && e.day === slot.day && e.participant_ids.includes(slot.userId) && (slot.period === 'manha' ? e.starts_at < '12:00' : e.ends_at > '12:00'))
    return { closed, total, ended, withoutClock, capacity, reserved, events }
  }
  function verdictFor(c: Carry, slot: Slot): DropVerdict {
    const moving = c.kind === 'block' ? c.block : null
    const info = slotInfo(slot, moving?.id)
    // A missed block gets a new duration on the way, so only a block in good standing needs to fit as is.
    return dropVerdict(moving && !(c.kind === 'block' && c.missed) ? 'block' : 'item', moving?.minutes ?? 15, {
      samePerson: c.item.assignee_id === slot.userId,
      sameSlot: !!moving && moving.user_id === slot.userId && moving.day === slot.day && moving.period === slot.period,
      ended: info.ended, closed: info.closed, capacity: info.capacity, reserved: info.reserved,
      events: info.events.map(e => e.title),
    })
  }

  function open(next: Dialog | null) { setDialog(next); setFormError(''); setChosenSlot(''); setNow(new Date()) }
  function stopCarry() { setCarry(null); setPlacing(false) }
  function startPlacing(c: Carry) { setDialog(null); setCarry(c); setPlacing(true); setNotice(null) }

  /** Grava no banco e só anuncia sucesso depois da confirmação. Em caso de falha nada sai do lugar. */
  async function commit(action: () => Promise<unknown>, target: { key: string; label: string; blockId?: string } | null, success: string, unchanged: string) {
    setSaving(target ?? { key: '', label: '' }); setBusy(true); setNotice(null); setDialog(null); stopCarry()
    try {
      await action()
      await refresh()
      setNotice({ tone: 'ok', text: success })
    } catch (e) {
      await refresh().catch(() => {})
      setNotice({ tone: 'error', text: `Não foi gravado: ${planningError(e)} ${unchanged} A agenda foi atualizada.` })
    } finally { setSaving(null); setBusy(false); setNow(new Date()) }
  }

  /** Destino escolhido (soltando ou pelo botão "Colocar aqui"). */
  function place(c: Carry, slot: Slot) {
    const verdict = verdictFor(c, slot)
    if (!verdict.ok) { setNotice({ tone: 'error', text: `${slotText(slot)} não aceita este bloco: ${verdict.reason}.` }); stopCarry(); return }
    const due = dueFor(c.item), late = !!due && slot.day > due, unknown = verdict.free === null
    stopCarry()
    if (c.kind === 'item') {
      setBlockHours(Math.min(c.balance, verdict.free ?? c.balance) / 60)
      open({ type: 'duration', item: c.item, slot, free: verdict.free, balance: c.balance, late, unknown })
      return
    }
    const total = c.item.remaining_minutes ?? c.block.minutes
    if (c.missed || late || unknown || c.block.minutes > total) {
      setRemaining(total / 60); setBlockHours(Math.min(c.block.minutes, total, verdict.free ?? c.block.minutes) / 60)
      open({ type: 'move', item: c.item, block: c.block, slot, free: verdict.free, missed: c.missed, late, unknown })
      return
    }
    // Nothing pending: move right away, keeping duration and history.
    void moveBlock(c.item, c.block, slot, total, c.block.minutes)
  }
  function moveBlock(item: WorkItem, block: PlanningBlock, slot: Slot, total: number, minutes: number) {
    return commit(
      () => continueBlock(block.id, total, { day: slot.day, period: slot.period, minutes }),
      { key: slotKey(slot), label: item.title, blockId: block.id },
      `Remanejado: ${item.title}, ${hours(minutes)} em ${slotText(slot)}. O bloco anterior ficou no histórico.`,
      `O bloco continua em ${slotText(block)}.`,
    )
  }
  function submitDuration(e: FormEvent) {
    e.preventDefault(); if (dialog?.type !== 'duration') return
    const minutes = Math.round(blockHours * 60), { item, slot, free, balance } = dialog
    if (!Number.isFinite(minutes) || minutes <= 0) { setFormError('Informe a duração do bloco.'); return }
    if (minutes > balance) { setFormError(`Faltam agendar só ${hours(balance)} desta etapa.`); return }
    if (free !== null && minutes > free) { setFormError(`Este período tem ${hours(free)} livres.`); return }
    void commit(
      () => reserveBlock(item.id, item.assignee_id!, slot.day, slot.period, minutes),
      { key: slotKey(slot), label: item.title },
      `Reserva gravada: ${item.title}, ${hours(minutes)} em ${slotText(slot)}.${balance - minutes > 0 ? ` Ainda faltam agendar ${hours(balance - minutes)}.` : ''}`,
      'Nenhuma reserva foi criada.',
    )
  }
  function submitMove(e: FormEvent) {
    e.preventDefault(); if (dialog?.type !== 'move') return
    const total = Math.round(remaining * 60), minutes = Math.round(blockHours * 60), { item, block, slot, free } = dialog
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(minutes) || minutes <= 0) { setFormError('Confira as horas informadas.'); return }
    if (minutes > total) { setFormError('O novo bloco não pode ser maior que o trabalho restante.'); return }
    if (free !== null && minutes > free) { setFormError(`Este período tem ${hours(free)} livres.`); return }
    void moveBlock(item, block, slot, total, minutes)
  }
  function finish(item: WorkItem, block: PlanningBlock | null) {
    if (!window.confirm('Concluir esta etapa? Isso não conclui a demanda inteira.')) return
    void commit(() => completeItem(item.id, block?.id ?? null), null, `Etapa concluída: ${item.title}. A demanda continua em aberto.`, 'A etapa continua pendente.')
  }

  async function mutate(action: () => Promise<unknown>, close = true) {
    setBusy(true); setFormError('')
    try { await action(); if (close) setDialog(null); await refresh(); setNow(new Date()) }
    catch (e) { setFormError(planningError(e)) } finally { setBusy(false) }
  }
  async function submitItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget)
    const assignee = String(f.get('assignee')), minutes = f.get('estimate') ? Math.round(Number(f.get('estimate')) * 60) : null
    const task = tasks.find(t => t.id === Number(taskId))
    if (task && data.items.some(i => i.ticket_task_id === task.id)) { setFormError('Esta tarefa já está no planejamento. Abra a etapa existente.'); return }
    await mutate(() => createWorkItem({ title: task?.titulo || String(f.get('title')).trim(), ticket_id: source === 'ticket' ? sourceId : null, event_id: source === 'event' ? sourceId : null, ticket_task_id: task?.id ?? null, assignee_id: task?.responsavel_id || assignee || null, remaining_minutes: minutes, due_date: String(f.get('due')) || null }))
  }
  async function submitEstimate(e: FormEvent<HTMLFormElement>, item: WorkItem) {
    e.preventDefault()
    const f = new FormData(e.currentTarget), assignee = String(f.get('assignee'))
    const hasBlocks = activeBlocks.some(b => b.work_item_id === item.id && ['planned', 'needs_reschedule'].includes(b.status))
    if ((hasBlocks || item.ticket_task_id) && assignee !== item.assignee_id) { setFormError('Mantenha o responsável das etapas com blocos. Para uma tarefa existente, altere o responsável na demanda.'); return }
    await mutate(() => saveWorkItem(item.id, assignee, Math.round(Number(f.get('estimate')) * 60)), false)
  }
  async function submitAvailability(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget), slots: Omit<Availability, 'user_id'>[] = []
    for (let day = 1; day <= 5; day++) for (const period of periods) {
      const key = `${day}-${period}`, start = String(f.get(key + '-start') || ''), end = String(f.get(key + '-end') || '')
      if (confirmedClosed[key] ?? data.availability.some(a => a.user_id === availableUser && a.weekday === day && a.period === period && a.starts_at === a.ends_at)) { const closed = period === 'manha' ? '08:00' : '12:00'; slots.push({ weekday: day, period, starts_at: closed, ends_at: closed }); continue }
      if (!start && !end) continue
      if (!start || !end || start >= end || (period === 'manha' && end > '12:00') || (period === 'tarde' && start < '12:00')) { setFormError('Confira início e término: manhã até 12h, tarde a partir de 12h. Use indisponível para períodos fechados.'); return }
      slots.push({ weekday: day, period, starts_at: start, ends_at: end })
    }
    await mutate(() => saveAvailability(availableUser, slots))
  }

  const dragProps = (c: Carry | null) => c ? {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', c.kind === 'block' ? c.block.id : c.item.id); e.dataTransfer.effectAllowed = 'move'
      // Defer: changing the page inside dragstart cancels the drag in Chromium.
      window.setTimeout(() => { setCarry(c); setPlacing(false); setNotice(null) }, 0)
    },
    onDragEnd: () => { setCarry(current => placing ? current : null) },
  } : {}
  const carryOfBlock = (b: PlanningBlock): Carry | null => {
    const item = itemOf(b.work_item_id)
    return item && item.status === 'pending' && ['planned', 'needs_reschedule'].includes(b.status) ? { kind: 'block', item, block: b, missed: isMissed(b, data.availability, now) } : null
  }

  function blockCard(block: PlanningBlock) {
    const item = itemOf(block.work_item_id), late = isMissed(block, data.availability, now) && item?.status === 'pending'
    const due = item ? dueFor(item) : null
    return (
      <button type="button" key={block.id} className={`board-card ${late ? 'missed' : ''} ${block.status === 'done' ? 'done' : ''} ${saving?.blockId === block.id ? 'leaving' : ''}`}
        onClick={() => open({ type: 'block', blockId: block.id })} {...dragProps(busy ? null : carryOfBlock(block))}>
        <b>{item?.title || 'Etapa'}</b>
        <span>{hours(block.minutes)}</span>
        {late && <em><AlertTriangle size={12} /> Precisa remanejar</em>}
        {block.status === 'done' && <em className="ok"><Check size={12} /> Etapa concluída</em>}
        {!late && block.status === 'planned' && due && block.day > due && <em>Depois do prazo</em>}
      </button>
    )
  }

  const detailBlock = dialog?.type === 'block' || dialog?.type === 'continue' ? data.blocks.find(b => b.id === dialog.blockId) : undefined
  const detailItem = dialog?.type === 'step' ? itemOf(dialog.itemId) : detailBlock ? itemOf(detailBlock.work_item_id) : undefined
  const history: PlanningBlock[] = []
  for (let cursor = detailBlock; cursor?.predecessor_id;) { const previous = data.blocks.find(b => b.id === cursor!.predecessor_id); if (!previous) break; history.push(previous); cursor = previous }
  const suggestions = dialog?.type === 'continue' && detailItem?.assignee_id ? slotsFor(detailItem.assignee_id, Math.round(blockHours * 60), dueFor(detailItem), data.availability, data.events, activeBlocks, now, detailBlock?.id) : []

  return <LayoutShell><section className="space-y-5">
    <PageHeader titulo="Planejamento de equipe" subtitulo="Arraste as etapas para a semana. Clique em um cartão para ver detalhes, concluir ou continuar depois."
      acoes={<>
        <button className="btn btn-outline" disabled={loading || !!error} onClick={() => { open({ type: 'availability' }); setAvailableUser(person || users[0]?.id || ''); setConfirmedClosed({}) }}><Settings size={15} /> Horários da equipe</button>
        <button className="btn btn-lime" disabled={loading || !!error} onClick={() => { open({ type: 'item' }); setSource('ticket'); setSourceId(''); setTaskId('') }}><Plus size={15} /> Adicionar etapa</button>
      </>} />
    {error && <p role="alert" className="planning-error">{error}</p>}
    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`board-notice ${notice.tone}`}>
      <span>{notice.text}</span><button type="button" className="btn btn-ghost btn-sm" aria-label="Fechar aviso" onClick={() => setNotice(null)}><X size={14} /></button>
    </p>}
    {saving && <p role="status" className="board-notice saving">Gravando{saving.label ? `: ${saving.label}` : ''}…</p>}
    {placing && carry && <p role="status" className="board-notice placing">
      <span>Escolha o período para <b>{carry.item.title}</b>. Os períodos que não aceitam mostram o motivo. Use as setas da semana para outras datas.</span>
      <button type="button" className="btn btn-outline btn-sm" onClick={stopCarry}>Cancelar (Esc)</button>
    </p>}

    <div className="board">
      <aside className="board-side" aria-label="Etapas a agendar">
        {!!missedInScope.length && <section>
          <h2 className="board-side-title danger"><AlertTriangle size={15} /> Precisa remanejar · {missedInScope.length}</h2>
          {missedInScope.map(b => {
            const item = itemOf(b.work_item_id)!
            return <button type="button" key={b.id} className="board-item missed" onClick={() => open({ type: 'block', blockId: b.id })} {...dragProps(busy ? null : carryOfBlock(b))}>
              <GripVertical size={14} className="grip" />
              <span><b>{item.title}</b><small>{projectOf(item)} · {nameOf(b.user_id)}</small><small>{hours(b.minutes)} não concluídas em {slotText(b)}</small></span>
            </button>
          })}
        </section>}
        <section>
          <h2 className="board-side-title">A agendar · {backlog.length}</h2>
          {eventFilter && <p className="planning-meta mb-2">Só o evento selecionado. <button type="button" className="underline" onClick={() => setParams({})}>Ver tudo</button></p>}
          {backlog.map(({ item, balance }) => {
            const ready = balance !== null && !!item.assignee_id
            return <button type="button" key={item.id} className={`board-item ${ready ? '' : 'blocked'}`} onClick={() => open({ type: 'step', itemId: item.id })}
              {...dragProps(ready && !busy ? { kind: 'item', item, balance: balance! } : null)}>
              <GripVertical size={14} className="grip" />
              <span><b>{item.title}</b><small>{projectOf(item)} · {nameOf(item.assignee_id)}</small>
                <small className="strong">{balance === null ? 'Definir estimativa' : !item.assignee_id ? 'Definir responsável' : `Faltam agendar ${hours(balance)}`}</small></span>
            </button>
          })}
          {!backlog.length && <p className="planning-meta">Nenhuma etapa com trabalho sem reserva.</p>}
        </section>
        {(!!unplannedTasks.length || !!noSteps.length) && <details className="board-more">
          <summary>Fora do planejamento · {unplannedTasks.length + noSteps.length}</summary>
          {unplannedTasks.map(t => <div key={'t' + t.id} className="board-more-row">
            <span><b>{t.titulo}</b><small>{tickets.find(ticket => ticket.id === t.ticket_id)?.titulo} · {nameOf(t.responsavel_id)}</small></span>
            <button className="btn btn-outline btn-sm" onClick={() => { open({ type: 'item' }); setSource('ticket'); setSourceId(t.ticket_id); setTaskId(String(t.id)) }}>Planejar tarefa</button>
          </div>)}
          {noSteps.map(t => <div key={t.id} className="board-more-row">
            <span><Link to={`/demandas/${t.id}`} className="font-semibold">{t.titulo}</Link><small>{t.status === 'pronta' ? 'Confirmar entrega' : t.data_entrega && t.data_entrega < hoje ? 'Prazo ultrapassado' : 'Sem etapas'} · {t.data_entrega ? formatDay(t.data_entrega) : 'sem prazo'}</small></span>
            <button className="btn btn-outline btn-sm" onClick={() => { open({ type: 'item' }); setSource('ticket'); setSourceId(t.id); setTaskId('') }}>Planejar etapa</button>
          </div>)}
        </details>}
      </aside>

      <section className={`ctp-card overflow-hidden min-w-0 ${loading && !saving ? 'opacity-70' : ''}`}>
        <header className="p-4 flex flex-wrap gap-2 justify-between items-center border-b border-slate-200">
          <select className="ctp-input" style={{ width: 'auto' }} aria-label="Pessoa da equipe" value={person} onChange={e => setPerson(e.target.value)}>
            <option value="">Toda a equipe</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <h2 className="font-semibold">{formatDay(week)} – {formatDay(dateAdd(week, 4))}</h2>
          <div className="flex gap-2">
            <button className="btn btn-ghost" aria-label="Semana anterior" onClick={() => setWeek(dateAdd(week, -7))}><ChevronLeft size={18} /></button>
            <button className="btn btn-outline" onClick={() => { setWeek(mondayOf(today())); setNow(new Date()) }}>Esta semana</button>
            <button className="btn btn-ghost" aria-label="Próxima semana" onClick={() => setWeek(dateAdd(week, 7))}><ChevronRight size={18} /></button>
          </div>
        </header>
        <div className="overflow-x-auto"><div className="planning-week">
          <div className="planning-heading planning-cell">EQUIPE</div>
          {days.map((day, i) => <div key={day} className={`planning-heading planning-cell ${day === hoje ? 'today' : ''}`}><b>{['SEG', 'TER', 'QUA', 'QUI', 'SEX'][i]}</b><p>{formatDay(day).slice(0, 5)}</p></div>)}
          {users.filter(u => !person || u.id === person).map(u => <div key={u.id} className="contents">
            <div className="planning-cell bg-slate-50"><b>{u.name}</b></div>
            {days.map(day => <div key={day} className="planning-cell">{periods.map(period => {
              const slot: Slot = { userId: u.id, day, period }, key = slotKey(slot), info = slotInfo(slot)
              const blocks = activeBlocks.filter(b => b.user_id === u.id && b.day === day && b.period === period && ['planned', 'done', 'needs_reschedule'].includes(b.status) && (!eventFilter || itemOf(b.work_item_id)?.event_id === eventFilter))
              const verdict = carry ? verdictFor(carry, slot) : null
              const over = info.capacity !== null && info.reserved > info.capacity
              const label = info.closed ? 'Indisponível' : info.capacity === null ? `Horário não configurado${info.reserved ? ` · ${hours(info.reserved)} reservadas` : ''}`
                : info.ended ? 'Encerrado' : over ? `Excedido em ${hours(info.reserved - info.capacity!)}` : `${hours(info.capacity - info.reserved)} livres`
              const eventShare = info.total && info.withoutClock !== null ? (info.total - info.withoutClock) / info.total * 100 : 0
              const reservedShare = info.total ? Math.min(100 - eventShare, info.reserved / info.total * 100) : 0
              return <section key={period} className={`board-slot ${verdict ? (verdict.ok ? 'can-drop' : 'no-drop') : ''}`} aria-label={`${u.name}, ${slotText(slot)}`}
                onDragOver={e => { if (verdict?.ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
                onDrop={e => { e.preventDefault(); if (carry) place(carry, slot) }}>
                <header><b>{periodLabel[period]}</b><span className={over ? 'over' : ''}>{label}</span></header>
                <div className={`board-meter ${info.total === null ? 'unknown' : ''}`} role="img" aria-label={`Ocupação: ${label}`}>
                  {eventShare > 0 && <i className="evt" style={{ width: `${eventShare}%` }} />}
                  {reservedShare > 0 && <i className={over ? 'over' : ''} style={{ width: `${reservedShare}%` }} />}
                </div>
                {info.events.map(e => <Link to="/eventos" key={e.id} className="board-fixed" title="Ocupação fixa: abre Aulas e eventos"><b>{kindLabel[e.kind]}: {e.title}</b><span>{e.starts_at.slice(0, 5)}–{e.ends_at.slice(0, 5)}</span></Link>)}
                {blocks.map(blockCard)}
                {saving?.key === key && <div className="board-card ghost"><b>{saving.label}</b><span>Gravando…</span></div>}
                {verdict && !verdict.ok && <p className="board-reason">{verdict.reason}</p>}
                {verdict?.ok && verdict.warning && <p className="board-reason soft">{verdict.warning}</p>}
                {verdict?.ok && placing && <button type="button" className="btn btn-lime btn-sm w-full mt-1" onClick={() => place(carry!, slot)}>Colocar aqui</button>}
              </section>
            })}{tickets.filter(t => t.responsavel_id === u.id && t.data_entrega === day).map(t => <Link key={t.id} to={`/demandas/${t.id}`} className="board-deadline" title="Prazo oficial no CTP"><CalendarClock size={12} /> Entrega: {t.titulo}</Link>)}</div>)}
          </div>)}
        </div></div>
      </section>
    </div>

    {dialog?.type === 'duration' && <PlanningDialog title="Quanto tempo reservar?" onClose={() => setDialog(null)}><form onSubmit={submitDuration} className="space-y-4">
      {formError && <p role="alert" className="planning-error">{formError}</p>}
      <p><b>{dialog.item.title}</b><br /><span className="planning-meta">{nameOf(dialog.slot.userId)} · {slotText(dialog.slot)} · {dialog.free === null ? 'horário não configurado' : `${hours(dialog.free)} livres`} · faltam agendar {hours(dialog.balance)}</span></p>
      <label className="ctp-label">Duração do bloco · horas<input autoFocus required type="number" min={0.25} max={12} step={0.25} className="ctp-input" value={blockHours} onChange={e => setBlockHours(Number(e.target.value))} /></label>
      {dialog.unknown && <p className="planning-warning">Disponibilidade desconhecida neste período. A reserva será registrada, mas não comprova que cabe.</p>}
      {dialog.late && <p className="planning-warning">Este período fica depois do prazo da etapa. O prazo oficial não será alterado.</p>}
      <button type="submit" className="btn btn-lime">Reservar</button>
    </form></PlanningDialog>}

    {dialog?.type === 'move' && <PlanningDialog title={dialog.missed ? 'Quanto falta e quanto reservar agora?' : 'Confirmar remanejamento'} onClose={() => setDialog(null)}><form onSubmit={submitMove} className="space-y-4">
      {formError && <p role="alert" className="planning-error">{formError}</p>}
      <p><b>{dialog.item.title}</b><br /><span className="planning-meta">De {slotText(dialog.block)} para {slotText(dialog.slot)} · {dialog.free === null ? 'horário não configurado' : `${hours(dialog.free)} livres`}</span></p>
      <label className="ctp-label">Total de trabalho ainda restante · horas<input autoFocus={dialog.missed} required type="number" min={0.25} step={0.25} className="ctp-input" value={remaining} onChange={e => setRemaining(Number(e.target.value))} /></label>
      <label className="ctp-label">Duração da nova reserva · horas<input required type="number" min={0.25} max={12} step={0.25} className="ctp-input" value={blockHours} onChange={e => setBlockHours(Number(e.target.value))} /></label>
      {dialog.unknown && <p className="planning-warning">Disponibilidade desconhecida neste período. A reserva será registrada, mas não comprova que cabe.</p>}
      {dialog.late && <p className="planning-warning">Este período fica depois do prazo da etapa. O prazo oficial não será alterado.</p>}
      <p className="planning-meta">O bloco anterior fica guardado no histórico. Responsável e prazo não mudam.</p>
      <button type="submit" className="btn btn-lime">Remanejar</button>
    </form></PlanningDialog>}

    {dialog?.type === 'block' && detailBlock && detailItem && (() => {
      const c = carryOfBlock(detailBlock), due = dueFor(detailItem), late = !!c && c.kind === 'block' && c.missed
      return <PlanningDialog title={detailItem.title} onClose={() => setDialog(null)}>
        {late && <p className="planning-error mb-3"><b>Precisa remanejar.</b> O período terminou e a etapa continua pendente.</p>}
        <dl className="board-facts">
          <div><dt>Bloco</dt><dd>{hours(detailBlock.minutes)} · {slotText(detailBlock)}</dd></div>
          <div><dt>Responsável</dt><dd>{nameOf(detailBlock.user_id)}</dd></div>
          <div><dt>Projeto</dt><dd>{detailItem.ticket_id ? <Link to={`/demandas/${detailItem.ticket_id}`} className="underline">{projectOf(detailItem)}</Link> : projectOf(detailItem)}</dd></div>
          <div><dt>Prazo</dt><dd>{due ? formatDay(due) : 'a definir'}</dd></div>
          <div><dt>Trabalho restante da etapa</dt><dd>{detailItem.remaining_minutes === null ? '—' : hours(detailItem.remaining_minutes)}</dd></div>
          <div><dt>Situação</dt><dd>{itemAssessment(detailItem, due, activeBlocks, data.availability, data.events, now)}</dd></div>
          {!!history.length && <div><dt>Histórico</dt><dd>{history.map(b => `remanejado de ${slotText(b)} (${hours(b.minutes)})`).join(' · ')}</dd></div>}
        </dl>
        {c ? <div className="flex flex-wrap gap-2 mt-5">
          <button className="btn btn-lime" disabled={busy} onClick={() => finish(detailItem, detailBlock)}><Check size={14} /> Concluir etapa</button>
          <button className="btn btn-outline" disabled={busy} onClick={() => { const total = detailItem.remaining_minutes ?? detailBlock.minutes; setRemaining(total / 60); setBlockHours(Math.min(total, detailBlock.minutes) / 60); open({ type: 'continue', blockId: detailBlock.id }) }}>Continuar depois</button>
          <button className="btn btn-outline" disabled={busy} onClick={() => startPlacing(c)}>Mover para outro período</button>
        </div> : <p className="planning-meta mt-4">{detailBlock.status === 'done' ? '✓ Etapa concluída.' : 'Este bloco não está mais ativo.'}</p>}
        <p className="planning-meta mt-3">Concluir uma etapa não conclui a demanda inteira.</p>
      </PlanningDialog>
    })()}

    {dialog?.type === 'step' && detailItem && (() => {
      const due = dueFor(detailItem), balance = unscheduledMinutes(detailItem.remaining_minutes, detailItem.id, activeBlocks)
      const reservations = activeBlocks.filter(b => b.work_item_id === detailItem.id && ['planned', 'needs_reschedule'].includes(b.status)).sort((a, b) => a.day.localeCompare(b.day))
      return <PlanningDialog title={detailItem.title} onClose={() => { if (!busy) setDialog(null) }}>
        {formError && <p role="alert" className="planning-error mb-3">{formError}</p>}
        <dl className="board-facts">
          <div><dt>Projeto</dt><dd>{detailItem.ticket_id ? <Link to={`/demandas/${detailItem.ticket_id}`} className="underline">{projectOf(detailItem)}</Link> : projectOf(detailItem)}</dd></div>
          <div><dt>Prazo</dt><dd>{due ? formatDay(due) : 'a definir'}</dd></div>
          <div><dt>Falta agendar</dt><dd>{balance === null ? 'definir estimativa' : hours(balance)}</dd></div>
          <div><dt>Situação</dt><dd>{itemAssessment(detailItem, due, activeBlocks, data.availability, data.events, now)}</dd></div>
          {!!reservations.length && <div><dt>Reservas</dt><dd>{reservations.map(b => `${hours(b.minutes)} em ${slotText(b)}`).join(' · ')}</dd></div>}
        </dl>
        <form key={detailItem.id + '-' + detailItem.assignee_id + '-' + detailItem.remaining_minutes} onSubmit={e => void submitEstimate(e, detailItem)} className="bg-slate-50 p-3 rounded-lg my-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="ctp-label">Responsável<select name="assignee" required className="ctp-input" defaultValue={detailItem.assignee_id || ''}><option value="">Selecione</option>{users.map(u => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
            <label className="ctp-label">Total restante · horas<input name="estimate" type="number" required min={0.25} step={0.25} className="ctp-input" defaultValue={detailItem.remaining_minutes === null ? '' : detailItem.remaining_minutes / 60} /></label>
          </div>
          <button type="submit" className="btn btn-outline mt-3" disabled={busy}>Salvar estimativa</button>
        </form>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-lime" disabled={busy || !balance || !detailItem.assignee_id} onClick={() => startPlacing({ kind: 'item', item: detailItem, balance: balance! })}>Reservar em um período</button>
          <button className="btn btn-outline" disabled={busy} onClick={() => finish(detailItem, null)}><Check size={14} /> Concluir etapa</button>
        </div>
        <p className="planning-meta mt-3">Concluir uma etapa não conclui a demanda inteira. A meta interna não altera o prazo oficial.</p>
      </PlanningDialog>
    })()}

    {dialog?.type === 'continue' && detailBlock && detailItem && <PlanningDialog title="Quanto falta e quando vai continuar?" onClose={() => { if (!busy) setDialog(null) }}>
      {formError && <p role="alert" className="planning-error mb-3">{formError}</p>}
      <h3 className="font-semibold mb-3">{detailItem.title}</h3>
      <form className="space-y-4" onSubmit={e => {
        e.preventDefault()
        if (!chosenSlot) { setFormError('Escolha um período.'); return }
        if (!Number.isFinite(blockHours) || blockHours <= 0 || !Number.isFinite(remaining) || remaining <= 0) { setFormError('Confira as horas estimadas.'); return }
        if (blockHours > remaining) { setFormError('O novo bloco não pode ser maior que o trabalho restante.'); return }
        const [day, period] = chosenSlot.split('|') as [string, Period], option = suggestions.find(s => s.day === day && s.period === period)
        if (option?.free !== null && option?.free !== undefined && blockHours * 60 > option.free) { setFormError('O bloco não cabe neste período. Divida o trabalho ou escolha outro período.'); return }
        if (option?.afterDeadline && !window.confirm('Este bloco ficará depois do prazo. Manter esta reserva sem alterar o prazo oficial?')) return
        void moveBlock(detailItem, detailBlock, { userId: detailBlock.user_id, day, period }, Math.round(remaining * 60), Math.round(blockHours * 60))
      }}>
        <label className="ctp-label">Total de trabalho ainda restante · horas<input type="number" min={0.25} step={0.25} required className="ctp-input" value={remaining} onChange={e => setRemaining(Number(e.target.value))} /></label>
        <label className="ctp-label">Duração do novo bloco · horas<input required type="number" min={0.25} max={12} step={0.25} className="ctp-input" value={blockHours} onChange={e => { setBlockHours(Number(e.target.value)); setChosenSlot('') }} /></label>
        <label className="ctp-label">Dias e períodos<select required className="ctp-input" size={6} value={chosenSlot} onChange={e => setChosenSlot(e.target.value)}>{suggestions.map(s => <option key={s.day + '|' + s.period} value={s.day + '|' + s.period} disabled={s.free !== null && s.free < blockHours * 60}>{formatDay(s.day)} · {periodLabel[s.period]} · {s.free === null ? 'disponibilidade não configurada' : hours(s.free) + ' livres'}{s.afterDeadline ? ' · APÓS O PRAZO' : s.free !== null && s.free < blockHours * 60 ? ' · não cabe' : ' · cabe o bloco'}</option>)}</select></label>
        <button type="submit" className="btn btn-lime" disabled={busy}>Remanejar para este período</button>
        <button type="button" className="btn btn-outline ml-2" disabled={busy || remaining <= 0}
          onClick={() => void commit(() => continueBlock(detailBlock.id, Math.round(remaining * 60), null), null, `${detailItem.title}: decisão adiada. O alerta continua até remanejar ou concluir.`, 'O bloco continua como estava.')}>Decidir depois · manter alerta</button>
      </form>
    </PlanningDialog>}

    {dialog?.type === 'item' && <PlanningDialog title="Adicionar etapa ao planejamento" onClose={() => { if (!busy) setDialog(null) }}><form onSubmit={submitItem} className="space-y-4">
      {formError && <p role="alert" className="planning-error">{formError}</p>}
      <label className="ctp-label">Origem<select className="ctp-input" value={source} onChange={e => { setSource(e.target.value as typeof source); setSourceId(''); setTaskId('') }}><option value="ticket">Demanda</option><option value="event">Preparação de evento</option></select></label>
      <label className="ctp-label">Projeto ou evento<select className="ctp-input" required value={sourceId} onChange={e => { setSourceId(e.target.value); setTaskId('') }}><option value="">Selecione</option>{source === 'ticket' ? tickets.map(t => <option key={t.id} value={t.id}>{t.titulo}</option>) : data.events.filter(e => e.status !== 'cancelled').map(e => <option key={e.id} value={e.id}>{e.title} · {formatDay(e.day)}</option>)}</select></label>
      {source === 'ticket' && <label className="ctp-label">Tarefa já registrada<select className="ctp-input" value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">Criar uma etapa de planejamento</option>{tasks.filter(t => t.ticket_id === sourceId && t.status !== 'concluido' && !data.items.some(i => i.ticket_task_id === t.id)).map(t => <option key={t.id} value={t.id}>{t.titulo} · {users.find(u => u.id === t.responsavel_id)?.name}</option>)}</select></label>}
      {!taskId && <label className="ctp-label">Nome da etapa<input name="title" required className="ctp-input" /></label>}
      <label className="ctp-label">Responsável<select name="assignee" className="ctp-input" disabled={!!taskId}><option value="">Definir depois</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label className="ctp-label">Trabalho restante · horas estimadas<input type="number" min={0.25} step={0.25} name="estimate" className="ctp-input" placeholder="Pode definir depois" /></label><label className="ctp-label">Meta interna opcional<input type="date" name="due" className="ctp-input" /></label><p className="planning-meta">A meta interna não altera nem substitui o prazo oficial. Uma tarefa existente mantém seu responsável.</p><button className="btn btn-lime" type="submit" disabled={busy}>Adicionar etapa</button>
    </form></PlanningDialog>}

    {dialog?.type === 'availability' && <PlanningDialog title="Horários disponíveis para trabalhar" onClose={() => { if (!busy) setDialog(null) }}><p className="planning-warning mb-4">Confirme horários reais, descontando almoço. Cadastre aulas e reuniões em Aulas e eventos. Em branco = desconhecido; indisponível = zero horas.</p>{formError && <p role="alert" className="planning-error">{formError}</p>}<label className="ctp-label">Pessoa<select className="ctp-input mb-4" value={availableUser} onChange={e => { setAvailableUser(e.target.value); setConfirmedClosed({}) }}>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><form key={availableUser} onSubmit={submitAvailability} className="space-y-3">{[1, 2, 3, 4, 5].map(day => <fieldset key={day} className="border-b border-slate-200 pb-3"><legend className="font-semibold text-sm">{['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'][day - 1]}</legend>{periods.map(period => {
      const key = `${day}-${period}`, existing = data.availability.find(a => a.user_id === availableUser && a.weekday === day && a.period === period), closed = confirmedClosed[key] ?? (existing?.starts_at === existing?.ends_at && !!existing)
      return <div key={period} className="flex gap-2 items-center flex-wrap mt-2"><span className="text-xs w-12">{periodLabel[period]}</span><input type="time" aria-label={`${day} ${period} início`} name={key + '-start'} defaultValue={existing?.starts_at.slice(0, 5)} disabled={closed} className="ctp-input" style={{ width: 110 }} /><input type="time" aria-label={`${day} ${period} término`} name={key + '-end'} defaultValue={existing?.ends_at.slice(0, 5)} disabled={closed} className="ctp-input" style={{ width: 110 }} /><label className="text-xs"><input type="checkbox" checked={closed} onChange={e => setConfirmedClosed(s => ({ ...s, [key]: e.target.checked }))} /> Indisponível</label></div>
    })}</fieldset>)}<button type="submit" className="btn btn-lime" disabled={busy || !availableUser}>Salvar horários</button></form></PlanningDialog>}
  </section></LayoutShell>
}
