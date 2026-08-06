import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Inbox, Clock, Factory, AlertTriangle, CheckCircle2, Truck, XCircle,
  Play, ChevronLeft, ChevronRight, Plus,
} from 'lucide-react'
import { LayoutShell } from '../components/LayoutShell'
import { TicketStatusPill } from '../components/TicketStatusPill'
import { PageHeader } from '../components/PageHeader'
import { UserAvatar } from '../components/UserAvatar'
import type { Ticket } from '../types/ticket'
import { listTickets } from '../services/tickets'
import { getActiveSessionsAll } from '../services/workSessions'
import { getTicketCardClasses, CATEGORIA_COR } from '../constants/ticketOptions'

const POLL_INTERVAL_MS = 15 * 60 * 1000 // 15 minutos

interface SummaryDef {
  to: string
  label: string
  value: number
  icon: typeof Inbox
  iconBg: string
  iconColor: string
}

export function DashboardPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [activeByTicket, setActiveByTicket] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const load = async () => {
      try {
        const [ticketsRes, activeList] = await Promise.all([
          listTickets(
            { includeCancelada: true },
            { limit: 200, orderBy: 'data_entrega', orderDirection: 'asc' },
          ),
          getActiveSessionsAll(),
        ])
        setTickets(ticketsRes.tickets)
        const map = new Map<string, string>()
        for (const a of activeList) map.set(a.ticketId, a.userName)
        setActiveByTicket(map)
      } catch {
        setTickets([])
      } finally {
        setLoading(false)
      }
    }
    load()

    const interval = setInterval(() => {
      Promise.all([
        listTickets(
          { includeCancelada: true },
          { limit: 200, orderBy: 'data_entrega', orderDirection: 'asc' },
        ),
        getActiveSessionsAll(),
      ])
        .then(([{ tickets: data }, activeList]) => {
          setTickets(data)
          const map = new Map<string, string>()
          for (const a of activeList) map.set(a.ticketId, a.userName)
          setActiveByTicket(map)
        })
        .catch(() => {})
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [])

  const recebidas = tickets.filter(
    (t) =>
      t.status === 'recebida' ||
      t.status === 'em_analise' ||
      t.status === 'orcamento_em_criacao',
  ).length
  const aguardando = tickets.filter(
    (t) =>
      t.status === 'aguardando_aprovacao' ||
      t.status === 'enviado_cliente' ||
      t.status === 'aprovado',
  ).length
  const emProducao = tickets.filter(
    (t) => t.status === 'em_producao' || t.status === 'pos_processo',
  ).length
  const hoje = new Date().toISOString().slice(0, 10)
  const atrasadas = tickets.filter(
    (t) =>
      t.data_entrega &&
      t.status !== 'entregue' &&
      t.status !== 'cancelada' &&
      t.data_entrega < hoje,
  ).length
  const prontas = tickets.filter((t) => t.status === 'pronta').length
  const entregues = tickets.filter((t) => t.status === 'entregue').length
  const canceladas = tickets.filter((t) => t.status === 'cancelada').length
  const filaAtiva = tickets.filter(
    (t) =>
      t.status !== 'entregue' &&
      t.status !== 'cancelada' &&
      (t.status === 'aguardando_aprovacao' ||
        t.status === 'enviado_cliente' ||
        t.status === 'aprovado' ||
        t.status === 'em_producao' ||
        t.status === 'pos_processo' ||
        t.status === 'em_analise'),
  )

  const PAGE_SIZE = 9
  const [carouselPage, setCarouselPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(filaAtiva.length / PAGE_SIZE))
  const filaAtivaPage = filaAtiva.slice(
    carouselPage * PAGE_SIZE,
    carouselPage * PAGE_SIZE + PAGE_SIZE,
  )
  const temMultiplasPaginas = filaAtiva.length > PAGE_SIZE

  const scrollCarousel = (dir: 'prev' | 'next') => {
    if (dir === 'prev') {
      setCarouselPage((p) => (p <= 0 ? totalPages - 1 : p - 1))
    } else {
      setCarouselPage((p) => (p >= totalPages - 1 ? 0 : p + 1))
    }
  }

  useEffect(() => {
    if (!temMultiplasPaginas || totalPages <= 1) return
    const interval = setInterval(() => {
      setCarouselPage((p) => (p >= totalPages - 1 ? 0 : p + 1))
    }, 10000)
    return () => clearInterval(interval)
  }, [temMultiplasPaginas, totalPages])

  const summary: SummaryDef[] = [
    { to: '/demandas?status=recebida,em_analise,orcamento_em_criacao', label: 'Recebidas', value: recebidas, icon: Inbox, iconBg: '#EFF6FF', iconColor: '#3B82F6' },
    { to: '/demandas?status=aguardando_aprovacao', label: 'Aguardando', value: aguardando, icon: Clock, iconBg: '#FFFBEB', iconColor: '#F59E0B' },
    { to: '/demandas?status=em_producao,pos_processo', label: 'Em produção', value: emProducao, icon: Factory, iconBg: '#F5F3FF', iconColor: '#8B5CF6' },
    { to: '/demandas?status=atrasadas', label: 'Atrasadas', value: atrasadas, icon: AlertTriangle, iconBg: '#FEF2F2', iconColor: '#EF4444' },
    { to: '/demandas?status=pronta', label: 'Prontas', value: prontas, icon: CheckCircle2, iconBg: '#F7FEE7', iconColor: '#84CC16' },
    { to: '/demandas?status=entregue', label: 'Entregues', value: entregues, icon: Truck, iconBg: '#F0FDFA', iconColor: '#14B8A6' },
    { to: '/demandas?status=cancelada', label: 'Canceladas', value: canceladas, icon: XCircle, iconBg: '#F1F5F9', iconColor: '#94A3B8' },
  ]

  return (
    <LayoutShell>
      <section className="space-y-6">
        <PageHeader
          titulo="Demandas do Espaço Maker"
          subtitulo="Acompanhe recebimento, orçamento, produção e entrega."
          acoes={
            <Link to="/demandas/nova" className="btn btn-lime">
              <Plus size={16} strokeWidth={2.5} /> Nova demanda
            </Link>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          {summary.map((s) => (
            <Link key={s.label} to={s.to} className="block">
              <div className="stat-card" style={{ padding: '1rem' }}>
                <div className="stat-icon" style={{ background: s.iconBg, width: 40, height: 40 }}>
                  <s.icon size={18} color={s.iconColor} strokeWidth={2} />
                </div>
                <div>
                  <p className="stat-value" style={{ fontSize: '1.5rem' }}>{s.value}</p>
                  <p className="stat-label" style={{ textTransform: 'none', letterSpacing: 0 }}>{s.label}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Fila ativa</h2>
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
                      <button
                        type="button"
                        onClick={() => scrollCarousel('prev')}
                        className="btn btn-ghost btn-sm"
                        aria-label="Anterior"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Página {carouselPage + 1}/{totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => scrollCarousel('next')}
                        className="btn btn-ghost btn-sm"
                        aria-label="Próximo"
                      >
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
                          <p className="mt-2 text-xs" style={{ color: 'var(--text-disabled)' }}>
                            Prazo: {ticket.data_entrega ?? '—'}
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
              <AlertCard
                title="Demandas atrasadas"
                description="Prazo de entrega vencido."
                value={atrasadas}
                tone="critical"
                to="/demandas?status=atrasadas"
              />
              <AlertCard
                title="Aguardando aprovação"
                description="Orçamentos aguardando retorno."
                value={aguardando}
                tone="warning"
                to="/demandas?status=aguardando_aprovacao,enviado_cliente,aprovado"
              />
            </div>
          </div>
        </div>
      </section>
    </LayoutShell>
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
  tone: 'critical' | 'warning'
  to: string
}) {
  const c =
    tone === 'critical'
      ? { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B' }
      : { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E' }

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
