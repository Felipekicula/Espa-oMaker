import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutShell } from '../components/LayoutShell'
import { TicketStatusPill } from '../components/TicketStatusPill'
import { UserAvatar } from '../components/UserAvatar'
import type { Ticket } from '../types/ticket'
import { listTickets } from '../services/tickets'

function formatPrazo(data: string | null | undefined): string {
  if (!data) return '—'
  const d = data.split('-')
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : data
}

export function WhatsAppDemandsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const { tickets: data } = await listTickets(
          { origem: 'formulario' },
          { limit: 500, orderBy: 'data_criacao', orderDirection: 'desc' },
        )
        setTickets(data)
      } catch (err) {
        const raw =
          err && typeof err === 'object' && 'message' in err
            ? String((err as Error).message)
            : 'Erro ao carregar demandas.'
        const isMissingColumn =
          /origem|column.*does not exist|não existe/i.test(raw)
        const message = isMissingColumn
          ? 'A coluna "origem" ainda não existe no banco. Execute no SQL Editor do Supabase (local ou remoto) o script: supabase/fix-origem-formulario.sql'
          : raw
        setError(message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const semResponsavel = tickets.filter((t) => !t.responsavel_id)
  const comResponsavel = tickets.filter((t) => !!t.responsavel_id)

  const renderTabela = (rows: Ticket[], emptyText: string) => {
    if (loading) {
      return (
        <div className="p-8 text-center text-sm text-slate-500">
          Carregando…
        </div>
      )
    }
    if (rows.length === 0) {
      return (
        <div className="p-8 text-center text-sm text-slate-500">
          {emptyText}
        </div>
      )
    }
    return (
      <div className="overflow-x-auto">
        <table className="ctp-table">
          <thead>
            <tr>
              <th>Demanda</th>
              <th>Solicitante</th>
              <th>Status</th>
              <th>Responsável</th>
              <th>Prazo</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {t.titulo}
                  </p>
                  {t.codigo && (
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {t.codigo}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {t.solicitante_nome}
                  {t.solicitante_telefone && (
                    <span className="block text-xs text-slate-400">
                      {t.solicitante_telefone}
                    </span>
                  )}
                  {t.registrado_por && (
                    <span className="mt-0.5 block text-xs" style={{ color: 'var(--ctp-navy)' }}>
                      Registrado por {t.registrado_por}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <TicketStatusPill status={t.status} />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {t.responsavel_nome ? (
                    <UserAvatar
                      avatarUrl={t.responsavel_avatar_url}
                      name={t.responsavel_nome}
                      size="sm"
                      showName
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatPrazo(t.data_entrega)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    to={`/demandas/${t.id}`}
                    className="font-semibold text-[#063A70] hover:underline"
                  >
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <LayoutShell>
      <section className="space-y-6">
        <header className="page-header">
          <h1>Demandas WhatsApp</h1>
          <p>
            Solicitações vindas do formulário público (link WhatsApp). Atribua responsável e altere status no detalhe para seguir o fluxo.
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="ctp-card overflow-hidden">
          <div className="flex items-center gap-2 px-7 py-3.5" style={{ borderBottom: '1px solid var(--border-default)' }}>
            <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>
              {semResponsavel.length}
            </span>
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              sem responsável
            </span>
          </div>
          {renderTabela(
            semResponsavel,
            'Nenhuma demanda do link WhatsApp sem responsável no momento.',
          )}
        </div>

        <div className="ctp-card overflow-hidden">
          <div className="flex items-center gap-2 px-7 py-3.5" style={{ borderBottom: '1px solid var(--border-default)' }}>
            <span className="badge" style={{ background: 'rgba(161,240,31,0.18)', color: '#3F6212' }}>
              {comResponsavel.length}
            </span>
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              com responsável
            </span>
          </div>
          {renderTabela(
            comResponsavel,
            'Nenhuma demanda do link WhatsApp com responsável no momento.',
          )}
        </div>
      </section>
    </LayoutShell>
  )
}
