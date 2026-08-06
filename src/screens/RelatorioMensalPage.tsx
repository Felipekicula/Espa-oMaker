import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban, Wallet, PiggyBank, Building2 } from 'lucide-react'
import { LayoutShell } from '../components/LayoutShell'
import { MetricCard } from '../components/MetricCard'
import { TicketStatusPill, STATUS_LABELS } from '../components/TicketStatusPill'
import type { Ticket } from '../types/ticket'
import { listTickets } from '../services/tickets'
import { listPrefeitura } from '../services/prefeitura'
import type { RegistroPrefeitura } from '../services/prefeitura'
import { formatarData, formatarMoeda } from '../utils/formatters'

function getValor(t: Ticket): number {
  return t.valor_demanda ?? t.orcamento?.total ?? 0
}

type PagamentoInfo = { label: string; tone: 'green' | 'amber' | 'sky' | 'slate' }

function getPagamentoInfo(t: Ticket): PagamentoInfo {
  if (t.tipo_receita === 'contrapartida') return { label: 'Contrapartida', tone: 'sky' }
  if (t.receita_recorrente) return { label: 'Recorrente', tone: 'sky' }
  if (t.pagamento_pago_em) return { label: 'Pago 100%', tone: 'green' }
  return { label: 'Pendente', tone: 'amber' }
}

const PAGAMENTO_TONES: Record<PagamentoInfo['tone'], { bg: string; color: string }> = {
  green: { bg: '#F0FDF4', color: '#15803D' },
  amber: { bg: '#FFFBEB', color: '#92400E' },
  sky: { bg: '#EFF6FF', color: '#1D4ED8' },
  slate: { bg: '#F1F5F9', color: '#475569' },
}

function mesAtualStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function limitesDoMes(mes: string): { inicio: string; fim: string; label: string } {
  const [ano, m] = mes.split('-').map(Number)
  const inicio = `${mes}-01`
  const ultimoDia = new Date(ano, m, 0).getDate()
  const fim = `${mes}-${String(ultimoDia).padStart(2, '0')}`
  const label = new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
  return { inicio, fim, label: label.charAt(0).toUpperCase() + label.slice(1) }
}

const COLS = ['Data', 'Solicitante', 'Descrição', 'Status', 'Valor', 'Pagamento'] as const

function exportXLS(tickets: Ticket[], mesLabel: string) {
  const BOM = '﻿'
  const header = COLS.join(';')
  const rows = tickets.map((t) => {
    const pag = getPagamentoInfo(t)
    return [
      formatarData(t.data_criacao),
      t.solicitante_nome,
      t.descricao || t.titulo,
      STATUS_LABELS[t.status],
      formatarMoeda(getValor(t)),
      pag.label,
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(';')
  })
  const csv = BOM + header + '\r\n' + rows.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-mensal-${mesLabel.replace(/\s+/g, '-').toLowerCase()}.xls`
  a.click()
  URL.revokeObjectURL(url)
}

export function RelatorioMensalPage() {
  const [mes, setMes] = useState(mesAtualStr())
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [parcerias, setParcerias] = useState<RegistroPrefeitura[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  const { inicio, fim, label: mesLabel } = useMemo(() => limitesDoMes(mes), [mes])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const [{ tickets: list }, prefeituraList] = await Promise.all([
        listTickets(
          { dataCriacaoInicial: inicio, dataCriacaoFinal: fim },
          { limit: 5000, orderBy: 'data_criacao', orderDirection: 'asc' },
        ),
        listPrefeitura(),
      ])
      setTickets(list.filter((t) => t.status !== 'cancelada'))
      setParcerias(
        prefeituraList.filter((p) => {
          const criado = p.criadoEm.slice(0, 10)
          return criado >= inicio && criado <= fim
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar relatório mensal.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes])

  const totais = useMemo(() => {
    const valorOrcado = tickets.reduce((sum, t) => sum + getValor(t), 0)
    const valorRecebido = tickets.reduce((sum, t) => {
      const pago = t.tipo_receita !== 'contrapartida' && !t.receita_recorrente && t.pagamento_pago_em
      return sum + (pago ? getValor(t) : 0)
    }, 0)
    return {
      totalProjetos: tickets.length,
      valorOrcado,
      valorRecebido,
      totalParcerias: parcerias.length,
    }
  }, [tickets, parcerias])

  const handleExportPDF = () => {
    if (!printRef.current) return
    const prevTitle = document.title
    document.title = `Relatório mensal - ${mesLabel}`
    const printContent = printRef.current.innerHTML
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>${document.title}</title>
      <style>
        body { font-family: system-ui, sans-serif; font-size: 12px; padding: 24px; color: #0F172A; }
        h1 { font-size: 18px; margin-bottom: 2px; }
        h2 { font-size: 13px; margin: 20px 0 8px; }
        p.sub { color: #64748B; margin-top: 0; margin-bottom: 20px; }
        .summary { display: flex; gap: 16px; margin-bottom: 20px; }
        .summary div { border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 14px; flex: 1; }
        .summary p { margin: 0; }
        .summary .label { font-size: 10px; text-transform: uppercase; color: #64748B; }
        .summary .value { font-size: 16px; font-weight: 700; margin-top: 4px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
        th { background: #f1f5f9; }
      </style></head><body>
        <h1>Relatório mensal — ${mesLabel}</h1>
        <p class="sub">Espaço Maker · gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
        <div class="summary">
          <div><p class="label">Total de projetos</p><p class="value">${totais.totalProjetos}</p></div>
          <div><p class="label">Valor orçado</p><p class="value">${formatarMoeda(totais.valorOrcado)}</p></div>
          <div><p class="label">Valor recebido</p><p class="value">${formatarMoeda(totais.valorRecebido)}</p></div>
          <div><p class="label">Parcerias</p><p class="value">${totais.totalParcerias}</p></div>
        </div>
        <h2>Projetos do mês</h2>
        ${printContent}
      </body></html>
    `)
    win.document.close()
    win.focus()
    win.print()
    win.close()
    document.title = prevTitle
  }

  return (
    <LayoutShell>
      <section className="space-y-6">
        <header className="page-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1>Relatório mensal</h1>
            <p>Fechamento do mês: projetos, valores orçados/recebidos e parcerias.</p>
          </div>
          <Link to="/relatorios/financeiro" className="text-sm font-semibold" style={{ color: 'var(--ctp-navy)' }}>
            Ver relatório financeiro →
          </Link>
        </header>

        <div className="ctp-card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="ctp-label">Mês</label>
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="ctp-input"
              style={{ width: 'auto' }}
            />
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => exportXLS(tickets, mesLabel)} className="btn btn-outline btn-sm">
              Exportar XLS
            </button>
            <button type="button" onClick={handleExportPDF} className="btn btn-outline btn-sm">
              Exportar PDF
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="ctp-card px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Calculando relatório de {mesLabel}...
          </div>
        ) : (
          !error && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Total de projetos" value={totais.totalProjetos} icon={FolderKanban} />
                <MetricCard
                  label="Valor total orçado"
                  value={formatarMoeda(totais.valorOrcado)}
                  icon={Wallet}
                  iconBg="#EFF6FF"
                  iconColor="#1D4ED8"
                />
                <MetricCard
                  label="Valor total recebido"
                  value={formatarMoeda(totais.valorRecebido)}
                  icon={PiggyBank}
                  iconBg="#F0FDF4"
                  iconColor="#15803D"
                />
                <MetricCard
                  label="Parcerias (prefeitura)"
                  value={totais.totalParcerias}
                  icon={Building2}
                  iconBg="#F5F3FF"
                  iconColor="#6D28D9"
                />
              </div>

              <div className="ctp-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Projetos de {mesLabel}
                  </p>
                  <span className="text-xs text-slate-500">{tickets.length} projeto(s)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        {COLS.map((c) => (
                          <th key={c} className="px-4 py-3">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((t) => {
                        const pag = getPagamentoInfo(t)
                        const tone = PAGAMENTO_TONES[pag.tone]
                        return (
                          <tr key={t.id}>
                            <td className="px-4 py-3 text-slate-700">{formatarData(t.data_criacao)}</td>
                            <td className="px-4 py-3 text-slate-700">{t.solicitante_nome}</td>
                            <td className="px-4 py-3">
                              <Link to={`/demandas/${t.id}`} className="font-medium text-slate-800 hover:underline">
                                {t.titulo}
                              </Link>
                              {t.descricao && (
                                <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{t.descricao}</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <TicketStatusPill status={t.status} />
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-800">{formatarMoeda(getValor(t))}</td>
                            <td className="px-4 py-3">
                              <span className="badge" style={{ background: tone.bg, color: tone.color }}>
                                {pag.label}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                      {tickets.length === 0 && (
                        <tr>
                          <td colSpan={COLS.length} className="px-4 py-8 text-center text-sm text-slate-500">
                            Nenhum projeto criado em {mesLabel}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ctp-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Parcerias com prefeituras em {mesLabel}
                  </p>
                  <span className="text-xs text-slate-500">{parcerias.length} parceria(s)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Município</th>
                        <th className="px-4 py-3">Contato</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parcerias.map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-3 text-slate-700">{formatarData(p.criadoEm)}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{p.municipio}</td>
                          <td className="px-4 py-3 text-slate-700">{p.contato}</td>
                          <td className="px-4 py-3 text-slate-700">{p.status}</td>
                        </tr>
                      ))}
                      {parcerias.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                            Nenhuma parceria registrada em {mesLabel}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Área usada só na impressão/PDF */}
              <div ref={printRef} className="hidden" aria-hidden>
                <table>
                  <thead>
                    <tr>
                      {COLS.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => {
                      const pag = getPagamentoInfo(t)
                      return (
                        <tr key={t.id}>
                          <td>{formatarData(t.data_criacao)}</td>
                          <td>{t.solicitante_nome}</td>
                          <td>{t.descricao || t.titulo}</td>
                          <td>{STATUS_LABELS[t.status]}</td>
                          <td>{formatarMoeda(getValor(t))}</td>
                          <td>{pag.label}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </section>
    </LayoutShell>
  )
}
