import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Inbox, Calculator } from 'lucide-react'
import { LayoutShell } from '../components/LayoutShell'
import { TicketStatusPill } from '../components/TicketStatusPill'
import type { Ticket } from '../types/ticket'
import { listTickets, updateTicketStatus } from '../services/tickets'
import { formatarMoeda } from '../utils/formatters'
import { useAuth } from '../auth/AuthContext'

const FASE_ORCAMENTO: { value: Ticket['status']; label: string }[] = [
  { value: 'recebida', label: 'Recebida' },
  { value: 'orcamento_em_criacao', label: 'Orçamento em criação' },
  { value: 'aguardando_aprovacao', label: 'Esperando aprovação (Pedro)' },
  { value: 'enviado_cliente', label: 'Enviado ao cliente' },
  { value: 'aprovado', label: 'Orçamento aprovado → definir responsável' },
  { value: 'cancelada', label: 'Cancelar demanda' },
]

/** Status que ainda estão no fluxo da caixa de entrada (workflow de orçamento). */
const INBOX_STATUSES: Ticket['status'][] = [
  'recebida',
  'orcamento_em_criacao',
  'aguardando_aprovacao',
  'enviado_cliente',
]

export function InboxTriagemPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  /** Evita “piscar” do select enquanto o PATCH não termina */
  const [selectDraft, setSelectDraft] = useState<Record<string, Ticket['status']>>(
    {},
  )
  const { appUser } = useAuth()
  const navigate = useNavigate()

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const ticketsResult = await listTickets(
        { statusIn: INBOX_STATUSES },
        { limit: 500 },
      )
      setTickets(ticketsResult.tickets)
    } catch (err) {
      const raw =
        err && typeof err === 'object' && 'message' in err
          ? String((err as Error).message)
          : 'Erro ao carregar caixa de entrada.'
      setError(raw)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const displayStatus = (t: Ticket) => selectDraft[t.id] ?? t.status

  const handleFaseChange = async (ticket: Ticket, newStatus: Ticket['status']) => {
    if (newStatus === ticket.status) {
      setSelectDraft((d) => {
        const n = { ...d }
        delete n[ticket.id]
        return n
      })
      return
    }

    if (newStatus === 'cancelada') {
      if (
        !window.confirm(
          'Cancelar esta demanda? Ela sairá do fluxo de orçamento.',
        )
      ) {
        setSelectDraft((d) => {
          const n = { ...d }
          delete n[ticket.id]
          return n
        })
        return
      }
    } else if (newStatus === 'aprovado') {
      const precisaResponsavel = !ticket.responsavel_id
      if (
        !window.confirm(
          precisaResponsavel
            ? 'Marcar orçamento como aprovado? A demanda sai da caixa de entrada. Ir para definir o responsável?'
            : 'Marcar orçamento como aprovado? A demanda sai da caixa (já tem responsável atribuído).',
        )
      ) {
        setSelectDraft((d) => {
          const n = { ...d }
          delete n[ticket.id]
          return n
        })
        return
      }
    }

    try {
      setSavingId(ticket.id)
      setError(null)
      await updateTicketStatus(ticket.id, { status: newStatus })

      if (newStatus === 'aprovado') {
        setTickets((prev) => prev.filter((x) => x.id !== ticket.id))
        setSelectDraft((d) => {
          const n = { ...d }
          delete n[ticket.id]
          return n
        })
        if (!ticket.responsavel_id) {
          navigate('/atribuir')
        }
        return
      }
      if (newStatus === 'cancelada') {
        setTickets((prev) => prev.filter((x) => x.id !== ticket.id))
      } else {
        setTickets((prev) =>
          prev.map((x) =>
            x.id === ticket.id ? { ...x, status: newStatus } : x,
          ),
        )
      }
      setSelectDraft((d) => {
        const n = { ...d }
        delete n[ticket.id]
        return n
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao atualizar fase.'
      setError(message)
      setSelectDraft((d) => {
        const n = { ...d }
        delete n[ticket.id]
        return n
      })
    } finally {
      setSavingId(null)
    }
  }

  const isFelipe = appUser?.role === 'felipe'
  const selectClass = 'ctp-input min-w-[14rem] max-w-full'

  return (
    <LayoutShell>
      <section className="space-y-6">
        <header className="page-header">
          <h1>Caixa de entrada</h1>
          <p>
            Workflow do orçamento. Escolha a fase de cada demanda. Ao aprovar o
            orçamento, você pode ir direto para definir o responsável.
          </p>
        </header>

        {!isFelipe && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Apenas o usuário de triagem (Felipe) pode alterar a fase. Você pode
            visualizar.
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="ctp-card overflow-hidden">
          <div className="flex items-center gap-2 px-7 py-3.5" style={{ borderBottom: '1px solid var(--border-default)' }}>
            <span className="badge" style={{ background: 'rgba(6,58,112,0.08)', color: 'var(--ctp-navy)' }}>
              {tickets.length}
            </span>
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {tickets.length === 1 ? 'demanda na caixa de entrada' : 'demandas na caixa de entrada'}
            </span>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Carregando...
            </div>
          ) : (
            <ul>
              {tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex flex-col gap-3 px-7 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  style={{ borderTop: '1px solid var(--border-default)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(6,58,112,0.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <button
                        type="button"
                        onClick={() => navigate(`/demandas/${ticket.id}`)}
                        className="text-left font-semibold transition-colors"
                        style={{ color: 'var(--text-primary)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ctp-navy)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                      >
                        {ticket.titulo}
                      </button>
                      <TicketStatusPill status={ticket.status} />
                    </div>
                    <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                      {ticket.solicitante_nome}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {ticket.orcamento ? (
                        <span className="text-[12px] font-semibold" style={{ color: 'var(--ctp-navy)' }}>
                          Orçamento: {formatarMoeda(ticket.orcamento.total)}
                        </span>
                      ) : (
                        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                          Sem orçamento
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(`/orcamento?pedido=${ticket.id}`)}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold transition-colors"
                        style={{ color: 'var(--ctp-navy)' }}
                      >
                        <Calculator size={12} />
                        {ticket.orcamento ? 'Refazer orçamento' : 'Criar orçamento'}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 sm:items-end">
                    <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      Fase do orçamento
                    </label>
                    <select
                      className={selectClass}
                      disabled={!isFelipe || savingId === ticket.id}
                      value={displayStatus(ticket)}
                      onChange={(e) => {
                        const v = e.target.value as Ticket['status']
                        setSelectDraft((d) => ({ ...d, [ticket.id]: v }))
                        void handleFaseChange(ticket, v)
                      }}
                    >
                      {FASE_ORCAMENTO.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {savingId === ticket.id && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Salvando…</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && tickets.length === 0 && (
            <div className="empty-state">
              <Inbox size={32} />
              <p>Nenhuma demanda na caixa de entrada.</p>
              <p>Novas solicitações aparecerão aqui.</p>
            </div>
          )}
        </div>
      </section>
    </LayoutShell>
  )
}
