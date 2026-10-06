import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, ChevronLeft, ChevronRight, Settings, AlertTriangle, Check } from 'lucide-react'
import { LayoutShell } from '../components/LayoutShell'
import { PageHeader } from '../components/PageHeader'
import { PlanningDialog } from '../components/PlanningDialog'
import { usePlanningData } from '../hooks/usePlanningData'
import { completeItem, continueBlock, createWorkItem, planningError, reserveBlock, saveAvailability, saveWorkItem } from '../services/planning'
import type { Availability, Period, PlanningBlock, WorkItem } from '../types/planning'
import { availableMinutes, dateAdd, formatDay, hours, isMissed, itemAssessment, mondayOf, reservedMinutes, slotsFor, today } from '../utils/planning'

const periods: Period[] = ['manha','tarde']
const periodLabel = { manha: 'Manhã', tarde: 'Tarde' }
export function PlanningPage() {
  const { data, users, tickets, tasks, loading, error, refresh } = usePlanningData()
  const [params] = useSearchParams()
  const [week, setWeek] = useState(mondayOf(today()))
  const [person, setPerson] = useState('')
  const [filter, setFilter] = useState(['pending','missed','nodate'].includes(params.get('filtro') || '') ? params.get('filtro')! : 'all')
  const [eventFilter, setEventFilter] = useState(params.get('evento') || '')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<'item' | 'reserve' | 'continue' | 'availability' | null>(null)
  const [selectedItem, setSelectedItem] = useState('')
  const [selectedBlock, setSelectedBlock] = useState<PlanningBlock | null>(null)
  const [source, setSource] = useState<'ticket' | 'event'>('ticket')
  const [sourceId, setSourceId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [remaining, setRemaining] = useState(2)
  const [reserveHours, setReserveHours] = useState(2)
  const [chosenSlot, setChosenSlot] = useState('')
  const [availableUser, setAvailableUser] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [confirmedClosed, setConfirmedClosed] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const clock = window.setInterval(() => setNow(new Date()), 30000); return () => clearInterval(clock) }, [])
  const activeEventIds = new Set(data.events.filter(e => e.status !== 'cancelled').map(e => e.id))
  const activeTicketIds = new Set(tickets.map(t => t.id))
  const items = data.items.filter(i => i.ticket_id ? activeTicketIds.has(i.ticket_id) : activeEventIds.has(i.event_id || ''))
  // Existing task completion always takes precedence over an older planning copy.
  const effectiveItems = items.map(i => i.ticket_task_id && tasks.find(t => t.id === i.ticket_task_id)?.status === 'concluido' ? { ...i, status: 'completed' as const } : i)
  const activeBlocks = data.blocks.filter(b => effectiveItems.find(i => i.id === b.work_item_id)?.status === 'pending' || b.status === 'done')
  const missed = activeBlocks.filter(b => isMissed(b, data.availability, now) && effectiveItems.find(i => i.id === b.work_item_id)?.status === 'pending')
  const dueFor = (i: WorkItem) => {
    const sourceDate = i.ticket_id ? tickets.find(t => t.id === i.ticket_id)?.data_entrega : data.events.find(e => e.id === i.event_id)?.preparation_deadline || data.events.find(e => e.id === i.event_id)?.day
    // Internal target cannot hide an earlier formal delivery date.
    return [i.due_date, sourceDate].filter((d): d is string => !!d).sort()[0] || null
  }
  const item = effectiveItems.find(i => i.id === selectedItem)
  const suggestions = item?.assignee_id ? slotsFor(item.assignee_id, Math.round(reserveHours * 60), dueFor(item), data.availability, data.events, activeBlocks, now, selectedBlock?.id) : []
  const visible = effectiveItems.filter(i => (!person || i.assignee_id === person) && (!eventFilter || i.event_id === eventFilter) && i.title.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')) && (filter === 'all' || filter === 'pending' && i.status === 'pending' || filter === 'missed' && missed.some(b => b.work_item_id === i.id) || filter === 'nodate' && !dueFor(i)))
  const unplannedTasks = tasks.filter(t => activeTicketIds.has(t.ticket_id) && t.status !== 'concluido' && !data.items.some(i => i.ticket_task_id === t.id))
  const noSteps = tickets.filter(t => !data.items.some(i => i.ticket_id === t.id))
  const days = Array.from({ length: 5 }, (_, n) => dateAdd(week,n))
  function open(d: typeof dialog, id = '') { setDialog(d); setSelectedItem(id); setSelectedBlock(null); setChosenSlot(''); setActionError(''); setNow(new Date()) }
  async function mutate(action: () => Promise<unknown>, close = true) {
    setBusy(true); setActionError('')
    try { await action(); if (close) setDialog(null); await refresh(); setNow(new Date()) }
    catch (e) { setActionError(planningError(e)) } finally { setBusy(false) }
  }
  function openContinue(b: PlanningBlock) {
    open('continue', b.work_item_id); setSelectedBlock(b)
    const current = effectiveItems.find(i => i.id === b.work_item_id)?.remaining_minutes
    setRemaining((current ?? b.minutes) / 60); setReserveHours((current ?? b.minutes) / 60)
  }
  async function submitItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget)
    const assignee = String(f.get('assignee')), minutes = f.get('estimate') ? Math.round(Number(f.get('estimate')) * 60) : null
    const task = tasks.find(t => t.id === Number(taskId))
    if (task && data.items.some(i => i.ticket_task_id === task.id)) { setActionError('Esta tarefa já está no planejamento. Abra a etapa existente.'); return }
    await mutate(() => createWorkItem({ title: task?.titulo || String(f.get('title')).trim(), ticket_id: source === 'ticket' ? sourceId : null, event_id: source === 'event' ? sourceId : null, ticket_task_id: task?.id ?? null, assignee_id: task?.responsavel_id || assignee || null, remaining_minutes: minutes, due_date: String(f.get('due')) || null }))
  }
  async function submitEstimate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!item) return
    const f = new FormData(e.currentTarget), assignee = String(f.get('assignee'))
    const hasBlocks = activeBlocks.some(b => b.work_item_id === item.id && ['planned','needs_reschedule'].includes(b.status))
    if ((hasBlocks || item.ticket_task_id) && assignee !== item.assignee_id) { setActionError('Mantenha o responsável das etapas com blocos. Para uma tarefa existente, altere o responsável na demanda.'); return }
    await mutate(() => saveWorkItem(item.id, assignee, Math.round(Number(f.get('estimate')) * 60)), false)
  }
  async function submitReservation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!item?.assignee_id || !chosenSlot) { setActionError('Defina responsável, estimativa e um período.'); return }
    if (!Number.isFinite(reserveHours) || reserveHours <= 0 || (dialog === 'continue' && (!Number.isFinite(remaining) || remaining <= 0))) { setActionError('Confira as horas estimadas.'); return }
    const [day, period] = chosenSlot.split('|') as [string, Period]
    const slot = suggestions.find(s => s.day === day && s.period === period)
    if (slot?.free !== null && slot?.free !== undefined && reserveHours * 60 > slot.free) { setActionError('O bloco não cabe neste período. Divida o trabalho ou escolha outro período.'); return }
    if (dialog === 'continue' && reserveHours > remaining) { setActionError('O novo bloco não pode ser maior que o trabalho restante.'); return }
    if (slot?.afterDeadline && !window.confirm('Este bloco ficará depois do prazo. Manter esta reserva sem alterar o prazo oficial?')) return
    await mutate(() => dialog === 'continue' && selectedBlock
      ? continueBlock(selectedBlock.id, Math.round(remaining * 60), { day, period, minutes: Math.round(reserveHours * 60) })
      : reserveBlock(item.id, item.assignee_id!, day, period, Math.round(reserveHours * 60)))
  }
  async function submitAvailability(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget), slots: Omit<Availability,'user_id'>[] = []
    for (let day = 1; day <= 5; day++) for (const period of periods) {
      const key = `${day}-${period}`, start = String(f.get(key+'-start') || ''), end = String(f.get(key+'-end') || '')
      if (confirmedClosed[key] ?? data.availability.some(a => a.user_id === availableUser && a.weekday === day && a.period === period && a.starts_at === a.ends_at)) { const closed = period === 'manha' ? '08:00' : '12:00'; slots.push({ weekday: day, period, starts_at: closed, ends_at: closed }); continue }
      if (!start && !end) continue
      if (!start || !end || start >= end || (period === 'manha' && end > '12:00') || (period === 'tarde' && start < '12:00')) { setActionError('Confira início e término: manhã até 12h, tarde a partir de 12h. Use indisponível para períodos fechados.'); return }
      slots.push({ weekday: day, period, starts_at: start, ends_at: end })
    }
    await mutate(() => saveAvailability(availableUser, slots))
  }
  return <LayoutShell><section className="space-y-5">
    <PageHeader titulo="Planejamento de equipe" subtitulo="O prazo está chegando. O trabalho cabe? Reserve etapas e acompanhe o que ficou pendente." acoes={<><button className="btn btn-outline" disabled={loading || !!error} onClick={() => { open('availability'); setAvailableUser(users[0]?.id || ''); setConfirmedClosed({}) }}><Settings size={15} /> Horários da equipe</button><button className="btn btn-lime" disabled={loading || !!error} onClick={() => { open('item'); setSource('ticket'); setSourceId(''); setTaskId('') }}><Plus size={15} /> Adicionar etapa</button><button className="btn btn-primary" disabled={loading || !!error || !effectiveItems.some(i => i.status === 'pending')} onClick={() => open('reserve')}><Plus size={15} /> Reservar bloco</button></>} />
    {(error || actionError) && <p role="alert" className="planning-error">{error || actionError}</p>}
    {!!missed.length && <div className="planning-error flex justify-between items-center gap-4"><div><b className="flex items-center gap-2"><AlertTriangle size={18} /> {missed.length} {missed.length === 1 ? 'bloco precisa' : 'blocos precisam'} de remanejamento</b><p>O período terminou e a atividade continua pendente. Conclua a etapa ou escolha quando continuar.</p></div><button className="btn btn-danger" onClick={() => setFilter('missed')}>Ver pendências</button></div>}
    <div className="grid gap-3 sm:grid-cols-4">{[['Demandas ativas', tickets.length], ['Sem prazo oficial', tickets.filter(t => !t.data_entrega).length], ['Etapas pendentes', effectiveItems.filter(i => i.status === 'pending').length], ['Precisa remanejar', missed.length]].map(([label,value]) => <div key={label} className="ctp-card p-4"><p className="planning-meta">{label}</p><strong className="text-3xl">{value}</strong></div>)}</div>
    <div className="planning-warning">Aulas de Felipe e Manu ocupam a manhã de terça; Jhonny trabalha à tarde. A reunião de sexta precisa de horário confirmado. Cadastre os eventos e configure os períodos disponíveis para calcular capacidade. Os cronômetros não entram nas estimativas.</div>
    <div className="flex flex-wrap gap-2"><select className="ctp-input" style={{ width:'auto' }} aria-label="Pessoa da equipe" value={person} onChange={e => setPerson(e.target.value)}><option value="">Toda a equipe</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select><select className="ctp-input" style={{ width:'auto' }} aria-label="Filtrar etapas" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas as etapas</option><option value="pending">Pendentes</option><option value="missed">Precisa remanejar</option><option value="nodate">Sem prazo</option></select><select className="ctp-input" style={{ width:'auto',maxWidth:260 }} aria-label="Evento" value={eventFilter} onChange={e => setEventFilter(e.target.value)}><option value="">Todos os projetos e eventos</option>{data.events.filter(e => e.status !== 'cancelled').map(e => <option key={e.id} value={e.id}>{e.title} · {formatDay(e.day)}</option>)}</select><input type="search" className="ctp-input" style={{ maxWidth:220 }} aria-label="Buscar etapa" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar etapa…" /></div>
    <section className="ctp-card overflow-hidden"><header className="p-4 flex flex-wrap gap-2 justify-between items-center border-b border-slate-200"><h2 className="font-semibold">{formatDay(week)} – {formatDay(dateAdd(week,4))}</h2><div className="flex gap-2"><button className="btn btn-ghost" aria-label="Semana anterior" onClick={() => setWeek(dateAdd(week,-7))}><ChevronLeft size={18} /></button><button className="btn btn-outline" onClick={() => { setWeek(mondayOf(today())); setNow(new Date()) }}>Esta semana</button><button className="btn btn-ghost" aria-label="Próxima semana" onClick={() => setWeek(dateAdd(week,7))}><ChevronRight size={18} /></button></div></header>
    {loading && <p className="p-4">Carregando planejamento…</p>}
    <div className="overflow-x-auto"><div className="planning-week"><div className="planning-heading planning-cell">EQUIPE</div>{days.map((day,i) => <div key={day} className="planning-heading planning-cell"><b>{['SEG','TER','QUA','QUI','SEX'][i]}</b><p>{formatDay(day)}</p></div>)}
      {users.filter(u => !person || u.id === person).map(u => <div key={u.id} className="contents"><div className="planning-cell bg-slate-50"><b>{u.name}</b><p className="planning-meta">Blocos de trabalho</p></div>{days.map(day => <div key={day} className="planning-cell">{periods.map(period => {
        const capacity = availableMinutes(u.id,day,period,data.availability,data.events), reserved = reservedMinutes(activeBlocks,u.id,day,period)
        const blocks = activeBlocks.filter(b => b.user_id === u.id && b.day === day && b.period === period && ['planned','done','needs_reschedule'].includes(b.status) && (!eventFilter || effectiveItems.find(i => i.id === b.work_item_id)?.event_id === eventFilter))
        const periodEvents = data.events.filter(e => e.status === 'confirmed' && e.day === day && e.participant_ids.includes(u.id) && (period === 'manha' ? e.starts_at < '12:00' : e.ends_at > '12:00'))
        return <section key={period} className="mb-4"><b className="text-xs">{periodLabel[period]}</b><p className={`planning-meta ${capacity !== null && reserved > capacity ? 'text-red-700' : ''}`}>{capacity === null ? `${hours(reserved)} reservadas · disponibilidade desconhecida` : `${hours(reserved)} / ${hours(capacity)} disponíveis${reserved > capacity ? ' · excedido' : ''}`}</p>{periodEvents.map(e => <Link to={`/eventos`} key={e.id} className="planning-event block"><b>{e.title}</b><br />{e.starts_at.slice(0,5)}–{e.ends_at.slice(0,5)}</Link>)}{blocks.map(b => {
          const work = effectiveItems.find(i => i.id === b.work_item_id), pending = isMissed(b,data.availability,now)
          return <article key={b.id} className={`planning-block ${pending ? 'missed' : ''} ${b.status === 'done' ? 'done' : ''}`}><b>{work?.title || 'Etapa'}</b><p>{hours(b.minutes)} planejadas</p>{pending && <p className="font-semibold text-red-700">Precisa remanejar</p>}{b.status === 'done' ? <span>✓ Etapa concluída</span> : <div className="flex gap-2 mt-2 flex-wrap"><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => { if (window.confirm('Concluir esta etapa? Isso não conclui a demanda inteira.')) void mutate(() => completeItem(b.work_item_id,b.id), false) }}><Check size={12} /> Concluir etapa</button><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => openContinue(b)}>Continuar depois</button></div>}</article>
        })}{!blocks.length && !periodEvents.length && <p className="planning-meta py-3">Sem blocos neste filtro.</p>}</section>
      })}{tickets.filter(t => t.responsavel_id === u.id && t.data_entrega === day).map(t => <Link key={t.id} to={`/demandas/${t.id}`} className="planning-warning block mt-2"><b>Entrega: {t.titulo}</b><br />Prazo oficial no CTP</Link>)}</div>)}</div>)}
    </div></div><p className="planning-meta p-4">Vários blocos podem ocupar o mesmo período. Reservas são estimativas de trabalho, sem cronômetro; um período vazio não comprova disponibilidade.</p></section>
    <section className="ctp-card p-5"><h2 className="font-semibold mb-3">Etapas e trabalho restante</h2>{visible.map(i => <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-slate-200"><div><b>{i.title}</b><p className="planning-meta">{i.ticket_id ? tickets.find(t => t.id === i.ticket_id)?.titulo : data.events.find(e => e.id === i.event_id)?.title} · {users.find(u => u.id === i.assignee_id)?.name || 'Sem responsável'} · {i.remaining_minutes === null ? 'Estimativa a definir' : hours(i.remaining_minutes)+' restantes'}</p><p className="text-xs">{itemAssessment(i,dueFor(i),activeBlocks,data.availability,data.events,now)}{dueFor(i) ? ' · até '+formatDay(dueFor(i)!) : ''}</p></div>{i.status === 'pending' && <button className="btn btn-outline" onClick={() => { const pending = missed.find(b => b.work_item_id === i.id); if (pending) openContinue(pending); else { open('reserve',i.id); setReserveHours((i.remaining_minutes ?? 120)/60) } }}>{missed.some(b => b.work_item_id === i.id) ? 'Remanejar' : 'Estimar / reservar'}</button>}</div>)}{!visible.length && <p className="planning-meta">Nenhuma etapa neste filtro. Adicione etapas das demandas ou dos eventos.</p>}</section>
    <section className="ctp-card p-5"><h2 className="font-semibold">Demandas que ainda precisam entrar no planejamento · {noSteps.length}</h2><p className="planning-meta mb-3">Mesmo uma demanda pronta precisa de confirmação da entrega. As tarefas existentes podem ser selecionadas ao adicionar uma etapa.</p><div className="grid gap-3 md:grid-cols-3">{noSteps.filter(t => !person || t.responsavel_id === person || tasks.some(task => task.ticket_id === t.id && task.responsavel_id === person)).map(t => <div key={t.id} className="planning-warning"><Link to={`/demandas/${t.id}`} className="font-semibold">{t.titulo}</Link><p>{t.status === 'pronta' ? 'Confirmar entrega' : t.data_entrega && t.data_entrega < today(now) ? 'Prazo ultrapassado' : 'Ainda não sabemos se cabe'} · {t.data_entrega ? formatDay(t.data_entrega) : 'Sem prazo'}</p><button className="btn btn-outline btn-sm mt-2" onClick={() => { open('item'); setSource('ticket'); setSourceId(t.id); setTaskId('') }}>Planejar etapa</button></div>)}</div></section>
    {!!unplannedTasks.length && <section className="ctp-card p-5"><h2 className="font-semibold mb-3">Tarefas existentes ainda sem reserva · {unplannedTasks.length}</h2>{unplannedTasks.filter(t => !person || t.responsavel_id === person).map(t => <div className="flex justify-between items-center gap-3 py-3 border-b border-slate-200" key={t.id}><div><b>{t.titulo}</b><p className="planning-meta">{tickets.find(ticket => ticket.id === t.ticket_id)?.titulo} · {users.find(u => u.id === t.responsavel_id)?.name || 'Responsável a confirmar'}</p></div><button className="btn btn-outline" onClick={() => { open('item'); setSource('ticket'); setSourceId(t.ticket_id); setTaskId(String(t.id)) }}>Planejar tarefa</button></div>)}</section>}
    {dialog === 'item' && <PlanningDialog title="Adicionar etapa ao planejamento" onClose={() => { if (!busy) setDialog(null) }}><form onSubmit={submitItem} className="space-y-4">
      {actionError && <p role="alert" className="planning-error">{actionError}</p>}
      <label className="ctp-label">Origem<select className="ctp-input" value={source} onChange={e => { setSource(e.target.value as typeof source); setSourceId(''); setTaskId('') }}><option value="ticket">Demanda</option><option value="event">Preparação de evento</option></select></label>
      <label className="ctp-label">Projeto ou evento<select className="ctp-input" required value={sourceId} onChange={e => { setSourceId(e.target.value); setTaskId('') }}><option value="">Selecione</option>{source === 'ticket' ? tickets.map(t => <option key={t.id} value={t.id}>{t.titulo}</option>) : data.events.filter(e => e.status !== 'cancelled').map(e => <option key={e.id} value={e.id}>{e.title} · {formatDay(e.day)}</option>)}</select></label>
      {source === 'ticket' && <label className="ctp-label">Tarefa já registrada<select className="ctp-input" value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">Criar uma etapa de planejamento</option>{tasks.filter(t => t.ticket_id === sourceId && t.status !== 'concluido' && !data.items.some(i => i.ticket_task_id === t.id)).map(t => <option key={t.id} value={t.id}>{t.titulo} · {users.find(u => u.id === t.responsavel_id)?.name}</option>)}</select></label>}
      {!taskId && <label className="ctp-label">Nome da etapa<input name="title" required className="ctp-input" /></label>}
      <label className="ctp-label">Responsável<select name="assignee" className="ctp-input" disabled={!!taskId}><option value="">Definir depois</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label className="ctp-label">Trabalho restante · horas estimadas<input type="number" min={0.25} step={0.25} name="estimate" className="ctp-input" placeholder="Pode definir depois" /></label><label className="ctp-label">Meta interna opcional<input type="date" name="due" className="ctp-input" /></label><p className="planning-meta">A meta interna não altera nem substitui o prazo oficial. Uma tarefa existente mantém seu responsável.</p><button className="btn btn-lime" type="submit" disabled={busy}>Adicionar etapa</button>
    </form></PlanningDialog>}
    {(dialog === 'reserve' || dialog === 'continue') && <PlanningDialog title={dialog === 'continue' ? 'Quanto falta e quando vai continuar?' : 'Reservar trabalho na semana'} onClose={() => { if (!busy) setDialog(null) }}>
      {actionError && <p role="alert" className="planning-error mb-3">{actionError}</p>}
      {dialog === 'reserve' && <label className="ctp-label mb-3">Etapa<select className="ctp-input" value={selectedItem} onChange={e => { setSelectedItem(e.target.value); const i = effectiveItems.find(i => i.id === e.target.value); setReserveHours((i?.remaining_minutes ?? 120)/60); setChosenSlot('') }}><option value="">Selecione</option>{effectiveItems.filter(i => i.status === 'pending').map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>}
      {item && <><h3 className="font-semibold mb-3">{item.title}</h3><p className="planning-meta mb-3">Prazo: {dueFor(item) ? formatDay(dueFor(item)!) : 'a definir'}. Concluir uma etapa não conclui a demanda inteira.</p>
      {dialog === 'reserve' && <form key={item.id+'-'+item.assignee_id+'-'+item.remaining_minutes} onSubmit={submitEstimate} className="bg-slate-50 p-3 rounded-lg mb-4"><div className="grid grid-cols-2 gap-3"><label className="ctp-label">Responsável<select name="assignee" required className="ctp-input" defaultValue={item.assignee_id || ''}><option value="">Selecione</option>{users.map(u => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label><label className="ctp-label">Total restante · horas<input name="estimate" type="number" required min={0.25} step={0.25} className="ctp-input" defaultValue={item.remaining_minutes === null ? '' : item.remaining_minutes/60} /></label></div><button type="submit" className="btn btn-outline mt-3" disabled={busy}>Salvar estimativa</button></form>}
      {dialog === 'continue' && <label className="ctp-label mb-3">Total de trabalho ainda restante · horas<input type="number" min={0.25} step={0.25} required className="ctp-input" value={remaining} onChange={e => setRemaining(Number(e.target.value))} /></label>}
      <form onSubmit={submitReservation} className="space-y-4"><label className="ctp-label">Duração do novo bloco · horas<input required type="number" min={0.25} max={12} step={0.25} className="ctp-input" value={reserveHours} onChange={e => { setReserveHours(Number(e.target.value)); setChosenSlot('') }} /></label>
      <label className="ctp-label">Dias e períodos<select required className="ctp-input" size={6} value={chosenSlot} onChange={e => setChosenSlot(e.target.value)}>{suggestions.map(s => <option key={s.day+'|'+s.period} value={s.day+'|'+s.period} disabled={s.free !== null && s.free < reserveHours*60}>{formatDay(s.day)} · {periodLabel[s.period]} · {s.free === null ? 'disponibilidade não configurada' : hours(s.free)+' livres'}{s.afterDeadline ? ' · APÓS O PRAZO' : s.fits ? ' · cabe o bloco' : ''}</option>)}</select></label>
      {chosenSlot && suggestions.find(s => s.day+'|'+s.period === chosenSlot)?.free === null && <p className="planning-warning">Disponibilidade desconhecida. A reserva poderá ser registrada, mas não comprova que cabe; confirme os horários da equipe.</p>}
      {dialog === 'continue' && <p className="planning-meta">Já há {hours(activeBlocks.filter(b => b.work_item_id === item.id && b.id !== selectedBlock?.id && b.status === 'planned' && !isMissed(b,data.availability,now)).reduce((sum,b) => sum+b.minutes,0))} em outros blocos futuros desta etapa. Você pode dividir o restante.</p>}
      <button type="submit" className="btn btn-lime" disabled={busy || !item.assignee_id || (dialog === 'reserve' && item.remaining_minutes === null)}>{dialog === 'continue' ? 'Remanejar para este período' : 'Reservar bloco'}</button>
      {dialog === 'continue' && selectedBlock && <button type="button" className="btn btn-outline ml-2" disabled={busy || remaining <= 0} onClick={() => void mutate(() => continueBlock(selectedBlock.id,Math.round(remaining*60),null))}>Decidir depois · manter alerta</button>}
      </form></>}
    </PlanningDialog>}
    {dialog === 'availability' && <PlanningDialog title="Horários disponíveis para trabalhar" onClose={() => { if (!busy) setDialog(null) }}><p className="planning-warning mb-4">Confirme horários reais, descontando almoço. Cadastre aulas e reuniões em Aulas e eventos. Em branco = desconhecido; indisponível = zero horas.</p>{actionError && <p role="alert" className="planning-error">{actionError}</p>}<label className="ctp-label">Pessoa<select className="ctp-input mb-4" value={availableUser} onChange={e => { setAvailableUser(e.target.value); setConfirmedClosed({}) }}>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><form key={availableUser} onSubmit={submitAvailability} className="space-y-3">{[1,2,3,4,5].map(day => <fieldset key={day} className="border-b border-slate-200 pb-3"><legend className="font-semibold text-sm">{['Segunda','Terça','Quarta','Quinta','Sexta'][day-1]}</legend>{periods.map(period => {
      const key = `${day}-${period}`, existing = data.availability.find(a => a.user_id === availableUser && a.weekday === day && a.period === period), closed = confirmedClosed[key] ?? (existing?.starts_at === existing?.ends_at && !!existing)
      return <div key={period} className="flex gap-2 items-center flex-wrap mt-2"><span className="text-xs w-12">{periodLabel[period]}</span><input type="time" aria-label={`${day} ${period} início`} name={key+'-start'} defaultValue={existing?.starts_at.slice(0,5)} disabled={closed} className="ctp-input" style={{ width:110 }} /><input type="time" aria-label={`${day} ${period} término`} name={key+'-end'} defaultValue={existing?.ends_at.slice(0,5)} disabled={closed} className="ctp-input" style={{ width:110 }} /><label className="text-xs"><input type="checkbox" checked={closed} onChange={e => setConfirmedClosed(s => ({...s,[key]:e.target.checked}))} /> Indisponível</label></div>
    })}</fieldset>)}<button type="submit" className="btn btn-lime" disabled={busy || !availableUser}>Salvar horários</button></form></PlanningDialog>}
  </section></LayoutShell>
}
