import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Inbox, AlertTriangle, CheckCircle2, Truck, FolderOpen, CalendarClock,
  Play, ChevronLeft, ChevronRight, Plus, Info,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { LayoutShell } from '../components/LayoutShell'
import { TicketStatusPill } from '../components/TicketStatusPill'
import { PageHeader } from '../components/PageHeader'
import { PlanningDialog } from '../components/PlanningDialog'
import { UserAvatar } from '../components/UserAvatar'
import type { Ticket, TicketStatus } from '../types/ticket'
import { allDashboardTickets } from '../services/planning'
import { loadDeliveryDates, type DeliveryDates } from '../services/dashboard'
import { usePlanningData } from '../hooks/usePlanningData'
import { formatDay, hours, today } from '../utils/planning'
import { granularityFor, isOverdue, localDay, periodStart, summarizeDeliveries } from '../utils/dashboard'
import { planningSnapshot } from '../utils/planningSnapshot'
import { getActiveSessionsAll } from '../services/workSessions'
import { getTicketCardClasses, CATEGORIA_COR } from '../constants/ticketOptions'

const POLL_INTERVAL_MS = 15 * 60 * 1000 // 15 minutos

// Cores por significado, iguais em todos os gráficos (paleta validada para daltonismo).
const COR = {
  abertas: '#2a78d6',
  entregues: '#1baf7a',
  atrasadas: '#d03b3b',
  noPrazo: '#0ca30c',
  semDados: '#c3c2b7',
  livre: '#cde2fb',
  grade: '#E2E8F0',
  eixo: '#8898AA',
}

const PERIODOS = [
  { days: 30, label: 'Últimos 30 dias' },
  { days: 90, label: 'Últimos 90 dias' },
  { days: 180, label: 'Últimos 6 meses' },
  { days: 365, label: 'Últimos 12 meses' },
]

// Etapas das demandas em aberto. A ordem e as cores são fixas: não mudam com os filtros.
const ETAPAS: { key: string; label: string; color: string; status: TicketStatus[] }[] = [
  { key: 'recebidas', label: 'Recebidas', color: '#2a78d6', status: ['recebida', 'em_analise', 'orcamento_em_criacao'] },
  { key: 'aguardando', label: 'Aguardando', color: '#eda100', status: ['aguardando_aprovacao', 'enviado_cliente', 'aprovado'] },
  { key: 'producao', label: 'Em produção', color: '#4a3aa7', status: ['em_producao', 'pos_processo'] },
  { key: 'prontas', label: 'Prontas', color: '#e87ba4', status: ['pronta'] },
]

const FILA_ATIVA: TicketStatus[] = ['aguardando_aprovacao', 'enviado_cliente', 'aprovado', 'em_producao', 'pos_processo', 'em_analise']
const SEM_RESPONSAVEL = 'sem-responsavel'

interface Drill { title: string; note?: string; tickets: Ticket[]; link?: { to: string; label: string } }

export function DashboardPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [delivery, setDelivery] = useState<DeliveryDates>({ available: true, byTicket: new Map() })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [activeByTicket, setActiveByTicket] = useState<Map<string, string>>(new Map())
  const [periodDays, setPeriodDays] = useState(90)
  const [person, setPerson] = useState('')
  const [drill, setDrill] = useState<Drill | null>(null)
  const planning = usePlanningData()

  useEffect(() => {
    const load = async (silent: boolean) => {
      try {
        const [ticketsRes, dates, activeList] = await Promise.all([
          allDashboardTickets(),
          loadDeliveryDates(),
          getActiveSessionsAll(),
        ])
        setTickets(ticketsRes.tickets)
        setDelivery(dates)
        setLoadError('')
        const map = new Map<string, string>()
        for (const a of activeList) map.set(a.ticketId, a.userName)
        setActiveByTicket(map)
      } catch {
        if (!silent) setLoadError('Não foi possível carregar os dados do Dashboard. Tente recarregar a página.')
      } finally {
        setLoading(false)
      }
    }
    void load(false)
    const interval = setInterval(() => { void load(true) }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const hoje = today()
  const inicio = periodStart(hoje, periodDays)
  const granularity = granularityFor(periodDays)
  const people = planning.users

  const view = useMemo(() => {
    const doFiltro = (t: Ticket) => !person || (person === SEM_RESPONSAVEL ? !t.responsavel_id : t.responsavel_id === person)
    const scoped = tickets.filter(doFiltro)
    const abertas = scoped.filter(t => t.status !== 'entregue' && t.status !== 'cancelada')
    const atrasadas = abertas.filter(t => isOverdue(t, hoje))
    const entregas = summarizeDeliveries(scoped, delivery.byTicket, inicio, hoje, granularity)
    const etapas = ETAPAS.map(e => ({ ...e, tickets: abertas.filter(t => e.status.includes(t.status)) }))
    const porPessoa = [...people.map(u => ({ id: u.id, name: u.name })), { id: SEM_RESPONSAVEL, name: 'Sem responsável' }]
      .filter(p => !person || p.id === person)
      .map(p => {
        const own = (t: Ticket) => p.id === SEM_RESPONSAVEL ? !t.responsavel_id : t.responsavel_id === p.id
        return {
          id: p.id, name: p.name,
          abertas: abertas.filter(own).length,
          atrasadas: atrasadas.filter(own).length,
          entregues: scoped.filter(t => own(t) && entregas.delivered.includes(t.id)).length,
        }
      })
      .filter(p => p.id !== SEM_RESPONSAVEL || p.abertas + p.entregues > 0)
    return { scoped, abertas, atrasadas, entregas, etapas, porPessoa }
  }, [tickets, delivery, person, people, hoje, inicio, granularity])

  const snapshot = useMemo(() => planningSnapshot(
    planning.data, planning.tickets, planning.tasks,
    people.filter(u => !person || u.id === person).map(u => u.id),
  ), [planning.data, planning.tickets, planning.tasks, people, person])

  const byId = useMemo(() => new Map(tickets.map(t => [t.id, t])), [tickets])
  const pick = (ids: string[]) => ids.map(id => byId.get(id)).filter((t): t is Ticket => !!t)
  const nameOf = (id: string | null) => people.find(u => u.id === id)?.name || 'Sem responsável'
  const periodoLabel = `${formatDay(inicio)} a ${formatDay(hoje)}`
  const { abertas, atrasadas, entregas, etapas, porPessoa } = view
  const contadas = entregas.noPrazo.length + entregas.foraDoPrazo.length
  const prontas = abertas.filter(t => t.status === 'pronta')
  const aguardando = abertas.filter(t => ['aguardando_aprovacao', 'enviado_cliente', 'aprovado'].includes(t.status))
  const canceladas = view.scoped.filter(t => t.status === 'cancelada')
  const entreguesTotal = view.scoped.filter(t => t.status === 'entregue')
  const filaAtiva = abertas.filter(t => FILA_ATIVA.includes(t.status))
  const maxCapacidade = Math.max(1, ...snapshot.capacity.map(c => c.available + c.excess))
  const missed = snapshot.missed.filter(m => !person || m.block.user_id === person)
  const short = snapshot.short.filter(s => !person || s.item.assignee_id === person)

  const PAGE_SIZE = 9
  const [carouselPage, setCarouselPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(filaAtiva.length / PAGE_SIZE))
  const page = Math.min(carouselPage, totalPages - 1)
  const filaAtivaPage = filaAtiva.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const temMultiplasPaginas = filaAtiva.length > PAGE_SIZE

  const scrollCarousel = (dir: 'prev' | 'next') => {
    setCarouselPage(dir === 'prev' ? (page <= 0 ? totalPages - 1 : page - 1) : (page >= totalPages - 1 ? 0 : page + 1))
  }

  useEffect(() => {
    if (!temMultiplasPaginas || totalPages <= 1) return
    const interval = setInterval(() => {
      setCarouselPage((p) => (p >= totalPages - 1 ? 0 : p + 1))
    }, 10000)
    return () => clearInterval(interval)
  }, [temMultiplasPaginas, totalPages])

  const kpis = [
    {
      label: 'Em aberto', value: String(abertas.length), hint: 'agora', icon: FolderOpen, color: COR.abertas,
      open: () => setDrill({ title: 'Demandas em aberto', tickets: abertas, link: { to: '/demandas', label: 'Abrir em Todas as demandas' } }),
    },
    {
      label: 'Entregues no período', value: delivery.available ? String(entregas.delivered.length) : '—', hint: periodoLabel, icon: Truck, color: COR.entregues,
      open: () => setDrill({ title: `Entregues de ${periodoLabel}`, note: 'Conta só o status Entregue, pela data registrada da entrega. Demandas prontas não entram.', tickets: pick(entregas.delivered) }),
    },
    {
      label: 'Atrasadas', value: String(atrasadas.length), hint: 'em aberto com prazo vencido', icon: AlertTriangle, color: COR.atrasadas,
      open: () => setDrill({ title: 'Demandas atrasadas', tickets: atrasadas, link: { to: '/demandas?status=atrasadas', label: 'Abrir em Todas as demandas' } }),
    },
    {
      label: 'Entregas no prazo', value: entregas.percentNoPrazo === null ? '—' : `${entregas.percentNoPrazo}%`,
      hint: contadas ? `${entregas.noPrazo.length} de ${contadas} entregas no cálculo` : 'sem entregas com prazo e data no período', icon: CheckCircle2, color: COR.noPrazo,
      open: () => setDrill({ title: 'Entregas que entraram no cálculo de pontualidade', note: 'Entregas do período com prazo cadastrado e data de entrega registrada.', tickets: pick([...entregas.noPrazo, ...entregas.foraDoPrazo]) }),
    },
  ]

  const pontualidade = [
    { key: 'noPrazo', label: 'No prazo', ids: entregas.noPrazo, color: COR.noPrazo },
    { key: 'fora', label: 'Fora do prazo', ids: entregas.foraDoPrazo, color: COR.atrasadas },
    { key: 'semPrazo', label: 'Sem prazo cadastrado', ids: entregas.semPrazo, color: COR.semDados },
  ]

  return (
    <LayoutShell>
      <section className="space-y-6">
        <PageHeader
          titulo="Dashboard do Espaço Maker"
          subtitulo="Demandas, entregas, pontualidade e carga da equipe."
          acoes={<>
            <Link to="/planejamento" className="btn btn-outline">Planejar a semana</Link>
            <Link to="/demandas/nova" className="btn btn-lime">
              <Plus size={16} strokeWidth={2.5} /> Nova demanda
            </Link>
          </>}
        />

        {loadError && <p className="planning-error" role="alert">{loadError}</p>}

        <div className="flex flex-wrap gap-2 items-center">
          <select className="ctp-input" style={{ width: 'auto' }} aria-label="Período" value={periodDays} onChange={e => setPeriodDays(Number(e.target.value))}>
            {PERIODOS.map(p => <option key={p.days} value={p.days}>{p.label}</option>)}
          </select>
          <select className="ctp-input" style={{ width: 'auto' }} aria-label="Responsável" value={person} onChange={e => setPerson(e.target.value)}>
            <option value="">Toda a equipe</option>
            {people.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            <option value={SEM_RESPONSAVEL}>Sem responsável</option>
          </select>
          <span className="planning-meta">O período vale para entregas e pontualidade. Em aberto, atrasadas e capacidade mostram a situação de agora.</span>
        </div>

        {!delivery.available && (
          <p className="planning-warning" role="status">
            <b>Este banco ainda não registra a data das entregas.</b> Aplique <code>supabase/migration-ticket-entregue-em.sql</code> para
            ativar entregas por período e pontualidade. Os demais indicadores já funcionam.
          </p>
        )}

        <div className={`grid gap-4 grid-cols-2 xl:grid-cols-4 ${loading ? 'opacity-60' : ''}`}>
          {kpis.map(k => (
            <button key={k.label} type="button" onClick={k.open} className="dash-kpi" style={{ borderTopColor: k.color }}>
              <span className="dash-kpi-icon" style={{ background: k.color }}><k.icon size={18} color="#fff" strokeWidth={2.2} /></span>
              <span className="dash-kpi-label">{k.label}</span>
              <span className="dash-kpi-value">{k.value}</span>
              <span className="planning-meta">{k.hint}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <ChartCard className="xl:col-span-2" title={`Entregas por ${granularity === 'week' ? 'semana' : 'mês'}`} subtitle={`${entregas.delivered.length} entregas de ${periodoLabel}${granularity === 'week' ? ' · cada barra é a semana iniciada na data' : ''}`}>
            {entregas.delivered.length ? (
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={entregas.buckets} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={COR.grade} />
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: COR.grade }} tick={{ fontSize: 11, fill: COR.eixo }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: COR.eixo }} />
                    <Tooltip cursor={{ fill: 'rgba(6,58,112,0.05)' }} content={<ChartTooltip unit="entregas" />} />
                    <Bar dataKey="total" name="Entregas" fill={COR.entregues} radius={[4, 4, 0, 0]} maxBarSize={24} cursor="pointer" isAnimationActive={false}
                      onClick={(entry: { payload?: (typeof entregas.buckets)[number] }) => {
                        const b = entry.payload
                        if (b) setDrill({ title: `Entregas · ${granularity === 'week' ? 'semana de ' : ''}${b.label}`, tickets: pick([...b.noPrazo, ...b.foraDoPrazo, ...b.semPrazo]) })
                      }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyChart text={delivery.available ? 'Nenhuma entrega com data registrada neste período.' : 'Disponível depois que o banco passar a registrar a data das entregas.'} />}

            <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Pontualidade das entregas do período</h3>
                <span className="planning-meta">{contadas} {contadas === 1 ? 'entrega entrou' : 'entregas entraram'} no cálculo</span>
              </div>
              {entregas.delivered.length > 0 && (
                <div className="dash-stack mt-3" role="img" aria-label={pontualidade.map(p => `${p.label}: ${p.ids.length}`).join(', ')}>
                  {pontualidade.filter(p => p.ids.length).map(p => (
                    <button key={p.key} type="button" title={`${p.label}: ${p.ids.length}`} style={{ flexGrow: p.ids.length, background: p.color }}
                      onClick={() => setDrill({ title: `Entregas · ${p.label.toLowerCase()}`, tickets: pick(p.ids) })} />
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
                {pontualidade.map(p => (
                  <button key={p.key} type="button" className="dash-legend" onClick={() => setDrill({ title: `Entregas · ${p.label.toLowerCase()}`, tickets: pick(p.ids) })}>
                    <i style={{ background: p.color }} /><b>{p.ids.length}</b> {p.label}
                  </button>
                ))}
                <button type="button" className="dash-legend" onClick={() => setDrill({ title: 'Entregues sem data de entrega registrada', note: 'O sistema não guardava a data da entrega. Não é possível dizer em que período ocorreram nem se foram no prazo.', tickets: pick(entregas.semDataEntrega) })}>
                  <i style={{ background: 'transparent', border: `1px dashed ${COR.eixo}` }} /><b>{entregas.semDataEntrega.length}</b> entregues sem data registrada (fora dos gráficos)
                </button>
              </div>
              <p className="planning-meta mt-3 flex gap-1.5 items-start">
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>A comparação usa o prazo atualmente cadastrado: o sistema não guarda histórico de alterações de prazo. Não se usa a última atualização como data de entrega.</span>
              </p>
            </div>
          </ChartCard>

          <ChartCard title="Em aberto por etapa" subtitle="Situação de agora">
            {abertas.length ? <>
              <div style={{ height: 190, position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={etapas.filter(e => e.tickets.length).map(e => ({ ...e, value: e.tickets.length }))} dataKey="value" nameKey="label" innerRadius={58} outerRadius={84} paddingAngle={2} stroke="#fff" strokeWidth={2} cursor="pointer" isAnimationActive={false}
                      onClick={(entry: { payload?: { label?: string; tickets?: Ticket[] } }) => { const e = entry.payload; if (e?.tickets) setDrill({ title: `Em aberto · ${e.label}`, tickets: e.tickets }) }}>
                      {etapas.filter(e => e.tickets.length).map(e => <Cell key={e.key} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip unit="demandas" />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dash-donut-center"><b>{abertas.length}</b><span>em aberto</span></div>
              </div>
              <div className="mt-2">
                {etapas.map(e => (
                  <button key={e.key} type="button" className="dash-row" onClick={() => setDrill({ title: `Em aberto · ${e.label}`, tickets: e.tickets, link: { to: `/demandas?status=${e.status[0]}`, label: 'Abrir em Todas as demandas' } })}>
                    <span className="dash-legend"><i style={{ background: e.color }} />{e.label}</span><b>{e.tickets.length}</b>
                  </button>
                ))}
              </div>
            </> : <EmptyChart text="Nenhuma demanda em aberto neste filtro." />}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-default)' }}>
              <button type="button" className="dash-legend" onClick={() => setDrill({ title: 'Entregues (todas)', tickets: entreguesTotal, link: { to: '/demandas?status=entregue', label: 'Abrir em Todas as demandas' } })}><b>{entreguesTotal.length}</b> entregues no total</button>
              <button type="button" className="dash-legend" onClick={() => setDrill({ title: 'Canceladas', tickets: canceladas, link: { to: '/demandas?status=cancelada', label: 'Abrir em Todas as demandas' } })}><b>{canceladas.length}</b> canceladas</button>
            </div>
          </ChartCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard title="Demandas por responsável" subtitle={`Abertas e atrasadas agora · entregues de ${periodoLabel}`}>
            {porPessoa.some(p => p.abertas + p.entregues > 0) ? <>
              <div style={{ height: Math.max(150, porPessoa.length * 76 + 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porPessoa} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barGap={2} barCategoryGap="22%">
                    <CartesianGrid horizontal={false} stroke={COR.grade} />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: COR.eixo }} />
                    <YAxis type="category" dataKey="name" width={104} tickLine={false} axisLine={{ stroke: COR.grade }} tick={{ fontSize: 12, fill: '#4B5769' }} />
                    <Tooltip cursor={{ fill: 'rgba(6,58,112,0.05)' }} content={<ChartTooltip unit="demandas" />} />
                    {([['abertas', 'Abertas', COR.abertas], ['atrasadas', 'Atrasadas', COR.atrasadas], ['entregues', 'Entregues', COR.entregues]] as const).map(([key, name, color]) => (
                      <Bar key={key} dataKey={key} name={name} fill={color} radius={[0, 4, 4, 0]} maxBarSize={14} cursor="pointer" isAnimationActive={false}
                        onClick={(entry: { payload?: (typeof porPessoa)[number] }) => {
                          const p = entry.payload
                          if (!p) return
                          const own = (t: Ticket) => p.id === SEM_RESPONSAVEL ? !t.responsavel_id : t.responsavel_id === p.id
                          const source = key === 'abertas' ? abertas : key === 'atrasadas' ? atrasadas : pick(entregas.delivered)
                          setDrill({ title: `${name} · ${p.name}`, tickets: source.filter(own) })
                        }} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                <span className="dash-legend"><i style={{ background: COR.abertas }} />Abertas</span>
                <span className="dash-legend"><i style={{ background: COR.atrasadas }} />Atrasadas (parte das abertas)</span>
                <span className="dash-legend"><i style={{ background: COR.entregues }} />Entregues no período</span>
              </div>
            </> : <EmptyChart text="Nenhuma demanda neste filtro." />}
          </ChartCard>

          <ChartCard title="Capacidade da equipe" subtitle={snapshot.horizon.start ? `Próximos 10 dias úteis · ${formatDay(snapshot.horizon.start)} a ${formatDay(snapshot.horizon.end)}` : ''}>
            {planning.error ? <p className="planning-warning">{planning.error}</p> : snapshot.capacity.length ? <>
              {snapshot.capacity.map(c => {
                const semHorario = c.available === 0 && c.unknownPeriods > 0
                return (
                  <div key={c.userId} className="mb-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <b className="text-sm">{nameOf(c.userId)}</b>
                      <span className="planning-meta">
                        {semHorario ? 'Disponibilidade desconhecida' : `${hours(c.reserved + c.excess)} reservadas de ${hours(c.available)} disponíveis`}
                      </span>
                    </div>
                    {!semHorario && (
                      <div className="dash-stack mt-2" style={{ width: `${Math.max(8, (c.available + c.excess) / maxCapacidade * 100)}%` }} role="img"
                        aria-label={`Reservado ${hours(c.reserved)}, livre ${hours(c.free)}, excesso ${hours(c.excess)}`}>
                        {c.reserved > 0 && <span title={`Reservado: ${hours(c.reserved)}`} style={{ flexGrow: c.reserved, background: COR.abertas }} />}
                        {c.free > 0 && <span title={`Livre: ${hours(c.free)}`} style={{ flexGrow: c.free, background: COR.livre }} />}
                        {c.excess > 0 && <span title={`Excesso: ${hours(c.excess)}`} style={{ flexGrow: c.excess, background: COR.atrasadas }} />}
                      </div>
                    )}
                    <p className="planning-meta mt-1">
                      {!semHorario && <>{hours(c.free)} livres{c.excess > 0 && <b style={{ color: '#a32739' }}> · {hours(c.excess)} acima da capacidade</b>}</>}
                      {c.unknownPeriods > 0 && <>{!semHorario && ' · '}{c.unknownPeriods} períodos sem horário configurado{c.reservedUnknown > 0 && ` (${hours(c.reservedUnknown)} reservadas neles)`}</>}
                    </p>
                  </div>
                )
              })}
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span className="dash-legend"><i style={{ background: COR.abertas }} />Reservado</span>
                <span className="dash-legend"><i style={{ background: COR.livre }} />Livre</span>
                <span className="dash-legend"><i style={{ background: COR.atrasadas }} />Excesso</span>
              </div>
              <p className="planning-meta mt-3 flex gap-1.5 items-start">
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>Disponível = horários configurados menos aulas e eventos. Reservado = blocos do planejamento. Os cronômetros não entram nesta conta.</span>
              </p>
            </> : <EmptyChart text="Nenhuma pessoa neste filtro." />}
          </ChartCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <AttentionCard tone="critical" icon={AlertTriangle} count={missed.length} title={missed.length === 1 ? 'bloco precisa de remanejamento' : 'blocos precisam de remanejamento'}
            empty="Nenhum bloco vencido sem conclusão." to="/planejamento?filtro=missed" action="Remanejar no planejamento">
            {missed.slice(0, 5).map(m => (
              <li key={m.block.id}><b>{m.item.title}</b><span>{nameOf(m.block.user_id)} · {formatDay(m.block.day)} · {m.block.period === 'manha' ? 'manhã' : 'tarde'} · {hours(m.block.minutes)}</span></li>
            ))}
          </AttentionCard>
          <AttentionCard tone="warning" icon={CalendarClock} count={short.length} title={short.length === 1 ? 'etapa sem reserva suficiente antes do prazo' : 'etapas sem reserva suficiente antes do prazo'}
            empty="Todas as etapas com prazo e estimativa têm tempo reservado." to="/planejamento?filtro=pending" action="Reservar no planejamento">
            {short.slice(0, 5).map(s => (
              <li key={s.item.id}><b>{s.item.title}</b><span>{nameOf(s.item.assignee_id)} · até {formatDay(s.deadline)} · {s.assessment}</span></li>
            ))}
          </AttentionCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Fila ativa · {filaAtiva.length}</h2>
              <Link to="/demandas" className="text-sm font-semibold" style={{ color: 'var(--ctp-navy)' }}>
                Ver todas
              </Link>
            </div>
            <div className="ctp-card overflow-hidden">
              {loading ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Carregando...
                </div>
              ) : filaAtiva.length > 0 ? (
                <>
                  {temMultiplasPaginas && (
                    <div
                      className="flex items-center justify-between gap-2 px-2 py-1"
                      style={{ borderBottom: '1px solid var(--border-default)' }}
                    >
                      <button type="button" onClick={() => scrollCarousel('prev')} className="btn btn-ghost btn-sm" aria-label="Anterior">
                        <ChevronLeft size={18} />
                      </button>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Página {page + 1}/{totalPages}
                      </span>
                      <button type="button" onClick={() => scrollCarousel('next')} className="btn btn-ghost btn-sm" aria-label="Próximo">
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                    {filaAtivaPage.map((ticket) => {
                      const whoActive = activeByTicket.get(ticket.id)
                      return (
                        <div
                          key={ticket.id}
                          className={`rounded-lg border p-3.5 transition-colors flex flex-col gap-2 min-h-0 ${getTicketCardClasses(ticket.categoria, ticket.prioridade)}`}
                          style={{
                            borderLeft: `3px solid ${
                              ticket.prioridade === 'urgente' ? '#EF4444' : CATEGORIA_COR[ticket.categoria] ?? '#94A3B8'
                            }`,
                          }}
                        >
                          <div className="flex items-start gap-1.5">
                            <Link
                              to={`/demandas/${ticket.id}`}
                              className="font-medium line-clamp-2 flex-1 min-w-0"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {ticket.titulo}
                            </Link>
                            {whoActive && (
                              <span
                                className="shrink-0 rounded-full p-1 text-white"
                                style={{ background: '#22C55E' }}
                                title={`${whoActive} está trabalhando nesta demanda`}
                              >
                                <Play size={12} fill="currentColor" />
                              </span>
                            )}
                          </div>
                          <p className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span className="line-clamp-1">{ticket.solicitante_nome}</span>
                            {ticket.responsavel_nome && (
                              <>
                                <span>·</span>
                                <UserAvatar
                                  avatarUrl={ticket.responsavel_avatar_url}
                                  name={ticket.responsavel_nome}
                                  size="sm"
                                  showName
                                />
                              </>
                            )}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <TicketStatusPill status={ticket.status} />
                          </div>
                          <p className="mt-2 text-xs" style={{ color: isOverdue(ticket, hoje) ? '#a32739' : 'var(--text-disabled)' }}>
                            Prazo: {ticket.data_entrega ? formatDay(ticket.data_entrega) : '—'}{isOverdue(ticket, hoje) && ' · atrasada'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Inbox size={32} />
                  <p>Nenhuma demanda na fila ativa.</p>
                  <p>Novas demandas aparecerão aqui.</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Alertas rápidos</h2>
            <div className="space-y-3">
              <AlertCard title="Demandas atrasadas" description="Prazo de entrega vencido." value={atrasadas.length} tone="critical" to="/demandas?status=atrasadas" />
              <AlertCard title="Aguardando aprovação" description="Orçamentos aguardando retorno." value={aguardando.length} tone="warning" to="/demandas?status=aguardando_aprovacao" />
              <AlertCard title="Prontas para entregar" description="Prontas ainda não contam como entregues." value={prontas.length} tone="neutral" to="/demandas?status=pronta" />
            </div>
          </div>
        </div>
      </section>

      {drill && (
        <PlanningDialog title={`${drill.title} · ${drill.tickets.length}`} onClose={() => setDrill(null)}>
          {drill.note && <p className="planning-meta mb-3">{drill.note}</p>}
          {drill.tickets.length ? (
            <ul className="dash-list">
              {drill.tickets.map(t => {
                const at = delivery.byTicket.get(t.id)
                return (
                  <li key={t.id}>
                    <div className="min-w-0">
                      <Link to={`/demandas/${t.id}`} className="font-semibold">{t.titulo}</Link>
                      <p className="planning-meta">
                        {t.responsavel_nome || 'Sem responsável'} · Prazo: {t.data_entrega ? formatDay(t.data_entrega) : 'sem prazo'}
                        {t.status === 'entregue' && ` · Entregue: ${at ? formatDay(localDay(at)) : 'data não registrada'}`}
                      </p>
                    </div>
                    <TicketStatusPill status={t.status} />
                  </li>
                )
              })}
            </ul>
          ) : <p className="planning-meta">Nenhuma demanda nesta lista.</p>}
          {drill.link && <Link to={drill.link.to} className="btn btn-outline mt-4">{drill.link.label}</Link>}
        </PlanningDialog>
      )}
    </LayoutShell>
  )
}

function ChartCard({ title, subtitle, className = '', children }: { title: string; subtitle?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`ctp-card p-5 ${className}`}>
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="planning-meta mb-4">{subtitle}</p>}
      {children}
    </section>
  )
}

function EmptyChart({ text }: { text: string }) {
  return <p className="planning-meta py-8 text-center">{text}</p>
}

interface TooltipEntry { name?: string | number; value?: string | number; color?: string; payload?: { color?: string } }

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: TooltipEntry[]; label?: string | number; unit: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="dash-tooltip">
      {label !== undefined && label !== '' && <p className="planning-meta">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i}><i style={{ background: entry.payload?.color || entry.color }} /><b>{entry.value}</b> {payload.length > 1 || label === undefined || label === '' ? String(entry.name).toLowerCase() : unit}</p>
      ))}
    </div>
  )
}

function AttentionCard({ tone, icon: Icon, count, title, empty, to, action, children }: {
  tone: 'critical' | 'warning'; icon: typeof AlertTriangle; count: number; title: string; empty: string; to: string; action: string; children: ReactNode
}) {
  if (!count) {
    return <section className="ctp-card p-5 flex items-center gap-3"><CheckCircle2 size={20} color={COR.noPrazo} /><p className="text-sm">{empty}</p></section>
  }
  return (
    <section className={`dash-attention ${tone}`}>
      <header><Icon size={20} /><b>{count}</b><span>{title}</span></header>
      <ul>{children}</ul>
      {count > 5 && <p className="planning-meta">e mais {count - 5}</p>}
      <Link to={to} className="btn btn-outline btn-sm mt-3">{action}</Link>
    </section>
  )
}

function AlertCard({
  title,
  description,
  value,
  tone,
  to,
}: {
  title: string
  description: string
  value: number
  tone: 'critical' | 'warning' | 'neutral'
  to: string
}) {
  const c =
    tone === 'critical'
      ? { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B' }
      : tone === 'warning'
        ? { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E' }
        : { bg: '#F4F7FA', border: '#E2E8F0', text: '#063A70' }

  return (
    <Link
      to={to}
      className="block rounded-lg px-4 py-3 transition-colors"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold" style={{ color: c.text }}>{title}</p>
          <p className="text-xs" style={{ color: c.text, opacity: 0.8 }}>{description}</p>
        </div>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold"
          style={{ background: 'rgba(255,255,255,0.8)', color: c.text }}
        >
          {value}
        </span>
      </div>
    </Link>
  )
}
