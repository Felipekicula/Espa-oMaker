import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { LayoutShell } from '../components/LayoutShell'
import { PageHeader } from '../components/PageHeader'
import { PlanningDialog } from '../components/PlanningDialog'
import { usePlanningData } from '../hooks/usePlanningData'
import { createEvent, cancelEvent, planningError } from '../services/planning'
import type { MakerEvent } from '../types/planning'
import { dateAdd, formatDay, mondayOf, today } from '../utils/planning'

const kinds = { aula: 'Aula', workshop: 'Workshop', reuniao: 'Reunião' }
export function EventsPage() {
  const { data, users, loading, error, refresh } = usePlanningData()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [type, setType] = useState('')
  const [person, setPerson] = useState('')
  const [search, setSearch] = useState('')
  const [week, setWeek] = useState(mondayOf(today()))
  const [view, setView] = useState<'list' | 'week'>('list')
  const events = data.events.filter(e => e.status !== 'cancelled' && (!type || e.kind === type) && (!person || e.participant_ids.includes(person)) && e.title.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).sort((a, b) => a.day.localeCompare(b.day) || a.starts_at.localeCompare(b.starts_at))
  const event = data.events.find(e => e.id === selected)
  const preparation = data.items.filter(i => i.event_id === event?.id)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget)
    const participants = form.getAll('participants').map(String)
    if (!participants.length) { setActionError('Selecione pelo menos um participante.'); return }
    const day = String(form.get('day')), starts_at = String(form.get('start')), ends_at = String(form.get('end'))
    if (starts_at >= ends_at) { setActionError('O término precisa ser depois do início.'); return }
    const preparation_deadline = String(form.get('deadline')) || null
    if (preparation_deadline && preparation_deadline > day) { setActionError('A preparação deve terminar antes ou no dia do evento.'); return }
    setBusy(true); setActionError('')
    try {
      const input: Omit<MakerEvent, 'id' | 'status' | 'series_id'> = { title: String(form.get('title')).trim(), kind: String(form.get('kind')) as MakerEvent['kind'], day, starts_at, ends_at, participant_ids: participants, location: String(form.get('location')) || null, preparation_deadline }
      const preparations = String(form.get('preparation')).split('\n').map(s => s.trim()).filter(Boolean).map(title => ({ title, assignee_id: String(form.get('prepOwner')) || null }))
      const id = await createEvent(input, preparations, Number(form.get('occurrences')))
      setSelected(id); setCreating(false); await refresh()
    } catch (err) { setActionError(planningError(err)) } finally { setBusy(false) }
  }
  async function cancel() {
    if (!event || !window.confirm('Cancelar somente esta ocorrência? Ela deixará de ocupar a agenda.')) return
    setBusy(true); setActionError('')
    try { await cancelEvent(event.id); await refresh() } catch (e) { setActionError(planningError(e)) } finally { setBusy(false) }
  }
  return <LayoutShell><section className="space-y-5">
    <PageHeader titulo="Aulas, workshops e reuniões" subtitulo="Cadastro direto, sem triagem. O evento ocupa a agenda de todos os participantes." acoes={<button className="btn btn-lime" disabled={loading || !!error} onClick={() => { setActionError(''); setCreating(true) }}><Plus size={16} /> Novo evento</button>} />
    {(error || actionError) && <p role="alert" className="planning-error">{error || actionError}</p>}
    <div className="grid gap-4 sm:grid-cols-3">{[['Eventos confirmados', data.events.filter(e => e.status === 'confirmed').length], ['Eventos com preparação', new Set(data.items.filter(i => i.event_id).map(i => i.event_id)).size], ['Ocorrências recorrentes', data.events.filter(e => e.series_id && e.status === 'confirmed').length]].map(([label, value]) => <div className="ctp-card p-5" key={label}><p className="planning-meta">{label}</p><strong className="text-3xl">{value}</strong></div>)}</div>
    <div className="flex gap-2 flex-wrap"><select aria-label="Tipo de evento" className="ctp-input" style={{ width: 'auto' }} value={type} onChange={e => setType(e.target.value)}><option value="">Todos os tipos</option>{Object.entries(kinds).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><select className="ctp-input" aria-label="Participante" style={{ width: 'auto' }} value={person} onChange={e => setPerson(e.target.value)}><option value="">Toda a equipe</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select><input className="ctp-input" style={{ maxWidth: 250 }} type="search" aria-label="Buscar evento" placeholder="Buscar evento…" value={search} onChange={e => setSearch(e.target.value)} /></div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="ctp-card overflow-hidden"><header className="p-4 flex items-center justify-between border-b border-slate-200"><h2 className="font-semibold">Eventos da equipe</h2><div className="flex gap-2"><button className={`btn ${view === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('list')}>Lista</button><button className={`btn ${view === 'week' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('week')}>Semana</button></div></header>
      {loading && <p className="p-5">Carregando eventos…</p>}
      {!loading && view === 'list' && (events.length ? events.map(e => <article key={e.id} className="event-list-row"><div className="event-date-tile"><small>{new Date(e.day + 'T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' })}</small><b>{Number(e.day.slice(8))}</b><small>{e.day.slice(0,4)}</small></div><div className="flex-1"><span className="planning-meta">{kinds[e.kind]} {e.series_id ? '· recorrente' : ''}</span><h3 className="font-semibold">{e.title}</h3><p className="planning-meta">{formatDay(e.day)} · {e.starts_at.slice(0,5)}–{e.ends_at.slice(0,5)} · {e.location || 'Local a definir'}</p><div>{e.participant_ids.map(id => <span className="event-chip" key={id}>{users.find(u => u.id === id)?.name || 'Participante'}</span>)}</div><p className="planning-meta">{data.items.filter(i => i.event_id === e.id && i.status === 'pending').length} etapas pendentes</p></div><button className="btn btn-outline" onClick={() => setSelected(e.id)}>Detalhes</button></article>) : <p className="p-8 text-center text-slate-500">Nenhum evento neste filtro. Cadastre aulas, workshops ou reuniões.</p>)}
      {view === 'week' && <><div className="p-4 flex items-center justify-between"><button className="btn btn-ghost" aria-label="Semana anterior" onClick={() => setWeek(dateAdd(week, -7))}><ChevronLeft size={18} /></button><b>{formatDay(week)} – {formatDay(dateAdd(week,4))}</b><button className="btn btn-ghost" aria-label="Próxima semana" onClick={() => setWeek(dateAdd(week,7))}><ChevronRight size={18} /></button></div><div className="overflow-auto"><div className="grid grid-cols-5 min-w-[750px]">{Array.from({ length: 5 }, (_, i) => dateAdd(week,i)).map(day => <div key={day} className="planning-cell"><h3 className="font-semibold mb-4">{['Seg','Ter','Qua','Qui','Sex'][iOfDay(day)]} · {formatDay(day)}</h3>{events.filter(e => e.day === day).map(e => <button key={e.id} className="planning-block w-full text-left" onClick={() => setSelected(e.id)}><b>{e.title}</b><p>{e.starts_at.slice(0,5)}–{e.ends_at.slice(0,5)}</p><p className="planning-meta">{e.participant_ids.map(id => users.find(u => u.id === id)?.name).join(', ')}</p></button>)}</div>)}</div></div></>}
      </section>
      <aside className="ctp-card p-5">{event ? <><span className="planning-meta">{kinds[event.kind]} · {event.status === 'cancelled' ? 'Cancelado' : 'Detalhes'}</span><h2 className="font-semibold text-lg my-2">{event.title}</h2><p>{formatDay(event.day)} · {event.starts_at.slice(0,5)}–{event.ends_at.slice(0,5)}</p><p className="planning-meta">{event.location || 'Local a definir'}</p>{event.preparation_deadline && <p className="planning-warning mt-4">Preparação até {formatDay(event.preparation_deadline)}</p>}<h3 className="font-semibold mt-5">Preparação</h3>{preparation.map(i => <div className="py-3 border-b border-slate-200 text-sm" key={i.id}>{i.status === 'completed' ? '✓ ' : '○ '}{i.title}<p className="planning-meta">{users.find(u => u.id === i.assignee_id)?.name || 'Responsável a definir'}</p></div>)}{!preparation.length && <p className="planning-meta my-3">Sem etapas cadastradas. Você pode criá-las no planejamento.</p>}<Link to={`/planejamento?evento=${event.id}`} className="btn btn-primary mt-4 w-full">Abrir no planejamento</Link><p className="planning-meta mt-3">Blocos, conclusão e remanejamento ficam no Planejamento de equipe. Orçamentos continuam no fluxo existente.</p>{event.status === 'confirmed' && <button className="btn btn-ghost mt-3" disabled={busy} onClick={cancel}>Cancelar esta ocorrência</button>}</> : <><CalendarDays size={30} className="text-slate-400 mb-3" /><h2 className="font-semibold">Evento e preparação</h2><p className="planning-meta mt-2">Selecione um evento para ver participantes, horário e etapas de preparação.</p></>}</aside>
    </div>
    {creating && <PlanningDialog title="Novo evento · sem triagem" onClose={() => { if (!busy) setCreating(false) }}><form onSubmit={submit} className="space-y-4">
      {actionError && <p role="alert" className="planning-error">{actionError}</p>}
      <label className="ctp-label">Nome<input autoFocus name="title" required maxLength={160} className="ctp-input" /></label>
      <label className="ctp-label">Tipo<select name="kind" className="ctp-input">{Object.entries(kinds).map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select></label>
      <div className="grid grid-cols-3 gap-3"><label className="ctp-label">Data<input type="date" name="day" required defaultValue={today()} className="ctp-input" /></label><label className="ctp-label">Início<input type="time" name="start" required className="ctp-input" /></label><label className="ctp-label">Término<input type="time" name="end" required className="ctp-input" /></label></div>
      <label className="ctp-label">Local<input name="location" className="ctp-input" /></label><fieldset><legend className="ctp-label">Participantes da equipe</legend>{users.map(u => <label className="event-chip" key={u.id}><input type="checkbox" name="participants" value={u.id} /> {u.name}</label>)}</fieldset>
      <label className="ctp-label">Ocorrências semanais<input type="number" min={1} max={52} defaultValue={1} required name="occurrences" className="ctp-input" /><small>1 = evento único. Mais ocorrências são criadas semanalmente, cada uma com sua preparação.</small></label>
      <label className="ctp-label">Preparação até<input type="date" name="deadline" className="ctp-input" /></label><label className="ctp-label">Etapas de preparação · uma por linha<textarea name="preparation" className="ctp-input" rows={3} /></label><label className="ctp-label">Responsável inicial pela preparação<select name="prepOwner" className="ctp-input"><option value="">Definir no planejamento</option>{users.map(u => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
      <p className="planning-warning">O horário ocupa a agenda dos participantes. A preparação precisa de estimativas e blocos separados; nenhum orçamento será criado ou alterado.</p><button disabled={busy} className="btn btn-lime" type="submit">{busy ? 'Salvando…' : 'Cadastrar evento'}</button>
    </form></PlanningDialog>}
  </section></LayoutShell>
}
function iOfDay(day: string) { return (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7 }
