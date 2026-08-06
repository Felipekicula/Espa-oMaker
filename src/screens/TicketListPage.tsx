import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutShell } from '../components/LayoutShell'
import { TicketStatusPill } from '../components/TicketStatusPill'
import { UserAvatar } from '../components/UserAvatar'
import type {
  Ticket,
  TicketCategoria,
  TicketPrioridade,
  TicketStatus,
  TicketTipo,
} from '../types/ticket'
import {
  listTickets,
  listTasksByResponsavel,
} from '../services/tickets'
import type { TicketTaskWithDemanda } from '../services/tickets'
import { getActiveSessionsAll } from '../services/workSessions'
import { listAppUsers } from '../services/appUsers'
import type { AppUserOption } from '../services/appUsers'
import { useAuth } from '../auth/AuthContext'
import { getTicketCardClasses, CATEGORIA_COR } from '../constants/ticketOptions'
import { CATEGORIA_LABELS } from '../components/Badges'

const TASK_STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_producao: 'Em produção',
  concluido: 'Concluído',
}

const PAGE_SIZE = 80

function formatPrazo(data: string | null | undefined): string {
  if (!data) return '—'
  const d = data.split('-')
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : data
}

export function TicketListPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<TicketStatus | 'atrasadas' | ''>('')
  const [prioridade, setPrioridade] = useState<TicketPrioridade | ''>('')
  const [categoria, setCategoria] = useState<TicketCategoria | ''>('')
  const [tipo, setTipo] = useState<TicketTipo | ''>('')
  const [dataInicial, setDataInicial] = useState('')
  const [dataFinal, setDataFinal] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [appUsers, setAppUsers] = useState<AppUserOption[]>([])
  const location = useLocation()
  const { appUser } = useAuth()
  const isMinhasDemandas = location.pathname === '/demandas/minhas'
  const [myTasks, setMyTasks] = useState<TicketTaskWithDemanda[]>([])
  const [activeByTicket, setActiveByTicket] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const pStatus = params.get('status')
    if (pStatus) setStatus(pStatus as TicketStatus | '')
  }, [location.search])

  const filters = {
    search: search || undefined,
    status: status || undefined,
    prioridade: prioridade || undefined,
    categoria: categoria || undefined,
    tipo: tipo || undefined,
    dataInicial: dataInicial || undefined,
    dataFinal: dataFinal || undefined,
    responsavelId: responsavelId || undefined,
  }

  const load = async (
    pageOffset?: number,
    overrides?: Partial<typeof filters> & {
      statusIn?: TicketStatus[]
      responsavelOuColaboradorId?: string
      responsavelId?: string
    },
  ) => {
    const isInitial = pageOffset === undefined || pageOffset === 0
    const mergedFilters = {
      ...filters,
      ...overrides,
      ...(isMinhasDemandas && appUser?.id
        ? { responsavelOuColaboradorId: appUser.id }
        : {}),
    }
    try {
      if (isInitial) {
        setLoading(true)
        setError(null)
      }
      const offset = isInitial ? 0 : pageOffset ?? 0
      const [ticketsRes, activeList] = await Promise.all([
        listTickets(mergedFilters, {
          limit: PAGE_SIZE,
          offset,
          orderBy: 'data_entrega',
          orderDirection: 'asc',
        }),
        getActiveSessionsAll(),
      ])
      const { tickets: data, hasMore: more } = ticketsRes
      const list = data ?? []
      const exibirLista =
        mergedFilters.status === 'cancelada' || mergedFilters.statusIn
          ? list
          : list.filter((t) => t.status !== 'cancelada')
      if (isInitial) {
        setTickets(exibirLista)
        const map = new Map<string, string>()
        for (const a of activeList) map.set(a.ticketId, a.userName)
        setActiveByTicket(map)
      } else {
        setTickets((prev) => [...prev, ...exibirLista])
      }
      setHasMore(more)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao carregar demandas.'
      setError(message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    await load(tickets.length)
  }

  useEffect(() => {
    if (!isMinhasDemandas) {
      listAppUsers().then(setAppUsers).catch(() => setAppUsers([]))
    }
  }, [isMinhasDemandas])

  useEffect(() => {
    if (isMinhasDemandas) {
      load(0)
      if (appUser?.id) {
        listTasksByResponsavel(appUser.id)
          .then((tasks) => setMyTasks(tasks.filter((t) => t.status !== 'concluido')))
          .catch(() => setMyTasks([]))
      } else {
        setMyTasks([])
      }
      return
    }
    const params = new URLSearchParams(location.search)
    const statusParam = params.get('status')
    if (!statusParam) {
      load(0)
      return
    }
    if (statusParam.includes(',')) {
      const statusIn = statusParam.split(',') as TicketStatus[]
      load(0, { statusIn })
    } else {
      load(0, { status: statusParam as TicketStatus })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname, isMinhasDemandas, appUser?.id])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    load(0)
  }

  const limparFiltros = () => {
    setSearch('')
    setStatus('')
    setPrioridade('')
    setCategoria('')
    setTipo('')
    setDataInicial('')
    setDataFinal('')
    setResponsavelId('')
    setTimeout(() => load(0), 0)
  }

  const minhas = tickets.filter(
    (t) =>
      t.responsavel_id === appUser?.id || t.colaborador_id === appUser?.id,
  )

  /** Em “Minhas” ou “Todas” sem filtro só “Entregue”: ativos primeiro, entregues em card separado. */
  const separarEntregues =
    isMinhasDemandas || (!isMinhasDemandas && status !== 'entregue')

  const ticketsEmAndamento = separarEntregues
    ? tickets.filter((t) => t.status !== 'entregue')
    : tickets
  const ticketsEntregues = separarEntregues
    ? tickets.filter((t) => t.status === 'entregue')
    : []

  const renderTicketRow = (ticket: Ticket) => {
    const whoActive = activeByTicket.get(ticket.id)
    return (
    <tr
      key={ticket.id}
      className={`transition-colors ${getTicketCardClasses(ticket.categoria, ticket.prioridade)}`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: CATEGORIA_COR[ticket.categoria] ?? '#94A3B8' }}
            title={CATEGORIA_LABELS[ticket.categoria]}
          />
          {whoActive && (
            <span
              className="shrink-0 rounded-full bg-emerald-500 p-1 text-white"
              title={`${whoActive} está trabalhando nesta demanda`}
              aria-label={`${whoActive} em trabalho`}
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          )}
          <div className="min-w-0">
            <Link
              to={`/demandas/${ticket.id}`}
              className="font-semibold text-slate-800 hover:text-[#063A70]"
            >
              {ticket.titulo}
            </Link>
            <p className="text-xs text-slate-500">
              {ticket.solicitante_nome}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-slate-700">
        {ticket.responsavel_nome ? (
          <UserAvatar
            avatarUrl={ticket.responsavel_avatar_url}
            name={ticket.responsavel_nome}
            size="sm"
            showName
          />
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3">
        <TicketStatusPill status={ticket.status} />
      </td>
      <td className="px-4 py-3 text-slate-600">
        {formatPrazo(ticket.data_entrega)}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          to={`/demandas/${ticket.id}`}
          className="font-semibold text-[#063A70] hover:text-[#042c56]"
        >
          Ver
        </Link>
      </td>
    </tr>
  )
  }

  return (
    <LayoutShell>
      <section className="space-y-6">
        <header className="page-header flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1>{isMinhasDemandas ? 'Minhas demandas' : 'Todas as demandas'}</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              {isMinhasDemandas ? (
                <>
                  Demandas em que você é responsável ou colaborador.{' '}
                  {!loading && (
                    <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      {ticketsEmAndamento.length} em andamento, {ticketsEntregues.length} entregue{ticketsEntregues.length !== 1 ? 's' : ''}
                      {myTasks.length > 0 && ` · ${myTasks.length} task${myTasks.length !== 1 ? 's' : ''}`}.
                    </span>
                  )}
                </>
              ) : separarEntregues ? (
                <>
                  Demandas em andamento primeiro; entregues ficam no bloco abaixo.{' '}
                  {!loading && (
                    <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      {ticketsEmAndamento.length} em andamento, {ticketsEntregues.length}{' '}
                      entregue{ticketsEntregues.length !== 1 ? 's' : ''}.
                    </span>
                  )}
                </>
              ) : (
                'Lista filtrada por status Entregue.'
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMinhasDemandas && (
              <Link to="/demandas" className="btn btn-outline">
                Ver todas as demandas
              </Link>
            )}
            <Link to="/demandas/nova" className="btn btn-lime">
              + Nova demanda
            </Link>
          </div>
        </header>

        <form
          onSubmit={handleSubmit}
          className="ctp-card flex flex-wrap items-center gap-3 p-3"
        >
          <div className="relative min-w-[200px] flex-1">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título"
              className="ctp-input"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus | 'atrasadas' | '')}
            className="ctp-input"
            style={{ width: 'auto' }}
          >
            <option value="">Todos os status</option>
            <option value="recebida">Recebida</option>
            <option value="em_analise">Em análise</option>
            <option value="orcamento_em_criacao">Orçamento em criação</option>
            <option value="aguardando_aprovacao">Esperando aprovação (Pedro)</option>
            <option value="enviado_cliente">Enviado ao cliente</option>
            <option value="aprovado">Aprovado</option>
            <option value="em_producao">Em produção</option>
            <option value="pos_processo">Pós-processo</option>
            <option value="pronta">Pronta</option>
            <option value="entregue">Entregue</option>
            <option value="cancelada">Cancelada</option>
            <option value="atrasadas">Atrasadas</option>
          </select>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TicketTipo | '')}
            className="ctp-input"
            style={{ width: 'auto' }}
          >
            <option value="">Todos os tipos</option>
            <option value="interna">Interna</option>
            <option value="externa">Externa</option>
          </select>
          {!isMinhasDemandas && (
            <select
              value={responsavelId}
              onChange={(e) => setResponsavelId(e.target.value)}
              className="ctp-input"
              style={{ width: 'auto' }}
            >
              <option value="">Todos os responsáveis</option>
              {appUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
          <button type="submit" className="btn btn-primary">
            Filtrar
          </button>
          <button type="button" onClick={limparFiltros} className="btn btn-ghost">
            Limpar
          </button>
        </form>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {isMinhasDemandas && (
          <div className="ctp-card p-5">
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Tasks atribuídas a mim
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Tasks de qualquer demanda em que você é o responsável.
            </p>
            {myTasks.length === 0 ? (
              <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>Nenhuma task atribuída a você.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {myTasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800">{task.titulo}</p>
                      <p className="text-xs text-slate-500">
                        Demanda: {task.ticket_titulo}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        task.status === 'concluido'
                          ? 'bg-emerald-100 text-emerald-800'
                          : task.status === 'em_producao'
                            ? 'bg-violet-100 text-violet-800'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {TASK_STATUS_LABEL[task.status] ?? task.status}
                    </span>
                    <Link
                      to={`/demandas/${task.ticket_id}`}
                      className="shrink-0 text-sm font-semibold text-[#063A70] hover:text-[#042c56]"
                    >
                      Ver demanda
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isMinhasDemandas ? (
          <>
            <div className="ctp-card overflow-hidden">
              <div className="px-7 py-3.5" style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-muted)' }}>
                <h2 className="text-sm font-semibold text-slate-700">
                  Em andamento
                </h2>
                <p className="text-xs text-slate-500">
                  Demandas ainda não entregues.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="ctp-table w-full">
                  <thead>
                    <tr>
                      <th className="px-4 py-3">Demanda</th>
                      <th className="px-4 py-3">Responsável</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Prazo</th>
                      <th className="w-16 px-4 py-3 text-right">Ver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          Carregando demandas...
                        </td>
                      </tr>
                    ) : (
                      ticketsEmAndamento.map(renderTicketRow)
                    )}
                  </tbody>
                </table>
              </div>
              {!loading && ticketsEmAndamento.length === 0 && ticketsEntregues.length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-slate-500">
                  Nenhuma demanda encontrada.
                </div>
              )}
              {!loading && ticketsEmAndamento.length === 0 && ticketsEntregues.length > 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  Nenhuma demanda em andamento.
                </div>
              )}
            </div>
            {ticketsEntregues.length > 0 && (
              <div className="ctp-card overflow-hidden">
                <div className="px-7 py-3.5" style={{ borderBottom: '1px solid var(--border-default)', background: 'rgba(161,240,31,0.10)' }}>
                  <h2 className="text-sm font-semibold text-slate-700">
                    Entregues
                  </h2>
                  <p className="text-xs text-slate-500">
                    Demandas já finalizadas e entregues.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        <th className="px-4 py-3">Demanda</th>
                        <th className="px-4 py-3">Responsável</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Prazo</th>
                        <th className="w-16 px-4 py-3 text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ticketsEntregues.map(renderTicketRow)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {hasMore && !loading && (
              <div className="ctp-card px-4 py-3">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="btn btn-outline w-full"
                >
                  {loadingMore ? 'Carregando...' : 'Carregar mais'}
                </button>
              </div>
            )}
          </>
        ) : status === 'entregue' ? (
          <div className="ctp-card overflow-hidden">
            <div className="px-7 py-3.5" style={{ borderBottom: '1px solid var(--border-default)', background: 'rgba(161,240,31,0.10)' }}>
              <h2 className="text-sm font-semibold text-slate-700">Entregues</h2>
              <p className="text-xs text-slate-500">
                Demandas com status entregue (filtro ativo).
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3">Demanda</th>
                    <th className="px-4 py-3">Responsável</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Prazo</th>
                    <th className="w-16 px-4 py-3 text-right">Ver</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        Carregando demandas...
                      </td>
                    </tr>
                  ) : (
                    tickets.map(renderTicketRow)
                  )}
                </tbody>
              </table>
            </div>
            {!loading && tickets.length === 0 && (
              <div className="px-4 py-12 text-center text-sm text-slate-500">
                Nenhuma demanda encontrada.
              </div>
            )}
            {hasMore && !loading && (
              <div className="border-t border-slate-100 px-4 py-3">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="btn btn-outline w-full"
                >
                  {loadingMore ? 'Carregando...' : 'Carregar mais'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="ctp-card overflow-hidden">
              <div className="px-7 py-3.5" style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-muted)' }}>
                <h2 className="text-sm font-semibold text-slate-700">
                  Em andamento
                </h2>
                <p className="text-xs text-slate-500">
                  Demandas ainda não entregues (outros status).
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="ctp-table w-full">
                  <thead>
                    <tr>
                      <th className="px-4 py-3">Demanda</th>
                      <th className="px-4 py-3">Responsável</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Prazo</th>
                      <th className="w-16 px-4 py-3 text-right">Ver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          Carregando demandas...
                        </td>
                      </tr>
                    ) : (
                      ticketsEmAndamento.map(renderTicketRow)
                    )}
                  </tbody>
                </table>
              </div>
              {!loading &&
                ticketsEmAndamento.length === 0 &&
                ticketsEntregues.length === 0 && (
                  <div className="px-4 py-12 text-center text-sm text-slate-500">
                    Nenhuma demanda encontrada.
                  </div>
                )}
              {!loading &&
                ticketsEmAndamento.length === 0 &&
                ticketsEntregues.length > 0 && (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">
                    Nenhuma demanda em andamento com estes filtros.
                  </div>
                )}
            </div>
            {ticketsEntregues.length > 0 && (
              <div className="ctp-card overflow-hidden">
                <div className="px-7 py-3.5" style={{ borderBottom: '1px solid var(--border-default)', background: 'rgba(161,240,31,0.10)' }}>
                  <h2 className="text-sm font-semibold text-slate-700">
                    Entregues
                  </h2>
                  <p className="text-xs text-slate-500">
                    Demandas já finalizadas e entregues.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        <th className="px-4 py-3">Demanda</th>
                        <th className="px-4 py-3">Responsável</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Prazo</th>
                        <th className="w-16 px-4 py-3 text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ticketsEntregues.map(renderTicketRow)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {hasMore && !loading && (
              <div className="ctp-card px-4 py-3">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="btn btn-outline w-full"
                >
                  {loadingMore ? 'Carregando...' : 'Carregar mais'}
                </button>
              </div>
            )}
          </>
        )}

        {!isMinhasDemandas && minhas.length > 0 && (
          <div className="ctp-card p-4">
            <h2 className="text-sm font-semibold text-slate-700">
              Minhas demandas
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Onde você é responsável ou colaborador.
            </p>
            <ul className="mt-3 space-y-2">
              {minhas.slice(0, 5).map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <Link
                    to={`/demandas/${ticket.id}`}
                    className="text-slate-700 hover:text-[#063A70]"
                  >
                    {ticket.titulo}
                  </Link>
                  <TicketStatusPill status={ticket.status} />
                </li>
              ))}
            </ul>
            <Link
              to="/demandas/minhas"
              className="mt-3 inline-block text-sm font-semibold text-[#063A70] hover:text-[#042c56]"
            >
              Ver todas as minhas →
            </Link>
          </div>
        )}
      </section>
    </LayoutShell>
  )
}
