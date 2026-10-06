import { useEffect, useRef, useState } from 'react'
import { ReportsLayout } from '../components/ReportsLayout'
import type { Ticket } from '../types/ticket'
import { listTickets } from '../services/tickets'
import {
  getWorkSessionsReport,
  type WorkSessionReportRow,
} from '../services/workSessions'

interface ReportsData {
  totalPorResponsavelSemana: { responsavel: string; total: number }[]
  /** Receita em dinheiro (tipo_receita !== 'contrapartida') */
  receitaMonetaria: number
  /** Receita em contrapartida (tipo_receita === 'contrapartida') */
  receitaContrapartida: number
  /** Receita geral = monetária + contrapartida */
  receitaGeral: number
  custoTotal: number
  /** Só receita monetária - custo (contrapartida não entra) */
  receitaLiquida: number
}

const COLS_RELATORIO = [
  'STATUS',
  'RESPONSÁVEL',
  'CLIENTE',
  'PRODUTO',
  'VALOR DO PRODUTO',
  'CUSTO',
  'HORAS TRABALHADAS',
  'RESPONSÁVEL PELAS HORAS',
  'PRAZO DE ENTREGA',
] as const

function formatHorasMinutos(horasDecimal: number): string {
  if (horasDecimal <= 0) return '0 min'
  const totalMin = horasDecimal * 60
  if (totalMin < 60) return `${Math.round(totalMin)} min`
  const h = Math.floor(totalMin / 60)
  const m = Math.round(totalMin % 60)
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

function getWorkSummaryForTicket(
  ticketId: string,
  workRows: WorkSessionReportRow[],
): { horas: number; horasStr: string; responsavel: string } {
  const forTicket = workRows.filter((r) => r.ticketId === ticketId)
  if (forTicket.length === 0) return { horas: 0, horasStr: '', responsavel: '' }
  const horas = forTicket.reduce((s, r) => s + r.horasTrabalhadas, 0)
  const responsavel = forTicket
    .map((r) => `${r.userName} (${formatHorasMinutos(r.horasTrabalhadas)})`)
    .join(', ')
  return { horas, horasStr: formatHorasMinutos(horas), responsavel }
}

function ticketToRow(
  t: Ticket,
  workRows: WorkSessionReportRow[],
): string[] {
  const valor =
    t.valor_demanda != null
      ? Number(t.valor_demanda).toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : ''
  const custoStr =
    t.custo != null
      ? Number(t.custo).toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : ''
  const { horasStr, responsavel } = getWorkSummaryForTicket(t.id, workRows)
  return [
    t.status,
    t.responsavel_nome ?? '',
    t.solicitante_nome ?? '',
    t.titulo ?? '',
    valor,
    custoStr,
    horasStr,
    responsavel,
    t.data_entrega ?? '',
  ]
}

function exportXLS(
  tickets: Ticket[],
  workRows: WorkSessionReportRow[],
) {
  const BOM = '\uFEFF'
  const header = COLS_RELATORIO.join(';')
  const rows = tickets.map((t) =>
    ticketToRow(t, workRows)
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(';'),
  )
  const csv = BOM + header + '\r\n' + rows.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-demandas-${new Date().toISOString().slice(0, 10)}.xls`
  a.click()
  URL.revokeObjectURL(url)
}

export function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [workSessionsReport, setWorkSessionsReport] = useState<
    WorkSessionReportRow[]
  >([])
  const printRef = useRef<HTMLDivElement>(null)

  const load = async (override?: { dataInicio?: string; dataFim?: string }) => {
    const inicio = override?.dataInicio ?? dataInicio
    const fim = override?.dataFim ?? dataFim
    try {
      setLoading(true)
      setError(null)
      const filters: Parameters<typeof listTickets>[0] = {}
      if (inicio) filters.dataCriacaoInicial = inicio
      if (fim) filters.dataCriacaoFinal = fim
      const { tickets: list } = await listTickets(filters, { limit: 5000 })
      setTickets(list)
      const reports = buildReports(list)
      setData(reports)
      const workRows = await getWorkSessionsReport(
        list.map((t) => t.id),
        inicio || undefined,
        fim || undefined,
      )
      setWorkSessionsReport(workRows)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao carregar relatórios.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleFiltrar = () => {
    void load()
  }

  const handleLimparFiltro = () => {
    setDataInicio('')
    setDataFim('')
    void load({ dataInicio: '', dataFim: '' })
  }

  const handleExportPDF = () => {
    if (!printRef.current) return
    const prevTitle = document.title
    document.title = `Relatório de demandas - ${new Date().toISOString().slice(0, 10)}`
    const printContent = printRef.current.innerHTML
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>${document.title}</title>
      <style>
        body { font-family: system-ui, sans-serif; font-size: 12px; padding: 16px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
        th { background: #f1f5f9; }
      </style></head><body>${printContent}</body></html>
    `)
    win.document.close()
    win.focus()
    win.print()
    win.close()
    document.title = prevTitle
  }

  return (
    <ReportsLayout>
      <section className="space-y-6">
        <header className="page-header">
          <h1>Indicadores do Espaço Maker</h1>
          <p>Produtividade da equipe, prazos e receita das demandas externas.</p>
        </header>

        {loading && (
          <div className="ctp-card px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Calculando relatórios...
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {data && !loading && !error && (
          <>
            <div className="ctp-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Demandas por responsável (7 dias)
              </p>
              <ul className="mt-3 space-y-2">
                {data.totalPorResponsavelSemana.map((row) => (
                  <li
                    key={row.responsavel}
                    className="flex items-center justify-between text-sm text-slate-700"
                  >
                    <span>{row.responsavel}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">
                      {row.total} demandas
                    </span>
                  </li>
                ))}
                {data.totalPorResponsavelSemana.length === 0 && (
                  <li className="text-sm text-slate-500">
                    Nenhuma demanda na última semana.
                  </li>
                )}
              </ul>
            </div>

            <div className="ctp-card p-4">
              <h2 className="text-sm font-semibold text-slate-700">
                Resumo financeiro
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Período filtrado · demandas externas com orçamento aprovado ou mais
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
                    Receita geral
                  </p>
                  <p className="mt-1 text-xl font-semibold text-emerald-800">
                    R$ {data.receitaGeral.toFixed(2)}
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-600">
                    monetária + contrapartida
                  </p>
                </div>
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
                    Receita monetária
                  </p>
                  <p className="mt-1 text-xl font-semibold text-emerald-800">
                    R$ {data.receitaMonetaria.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-violet-700">
                    Receita contrapartida
                  </p>
                  <p className="mt-1 text-xl font-semibold text-violet-800">
                    R$ {data.receitaContrapartida.toFixed(2)}
                  </p>
                  <p className="mt-0.5 text-xs text-violet-600">
                    material / equivalente
                  </p>
                </div>
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-amber-700">
                    Custo geral
                  </p>
                  <p className="mt-1 text-xl font-semibold text-amber-800">
                    R$ {data.custoTotal.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#063A70]">
                    Receita líquida
                  </p>
                  <p
                    className="mt-1 text-xl font-bold"
                    style={{ color: data.receitaLiquida < 0 ? '#DC2626' : '#15803D' }}
                  >
                    R$ {data.receitaLiquida.toFixed(2)}
                  </p>
                  <p className="mt-0.5 text-xs text-[#063A70]">
                    só monetária − custo
                  </p>
                </div>
              </div>
            </div>

            <div className="ctp-card p-4">
              <h2 className="text-sm font-semibold text-slate-700">
                Tempo de trabalho por demanda (play/pause)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Período filtrado · dias e horas conforme sessões de trabalho
              </p>
              {workSessionsReport.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  Nenhuma sessão de trabalho no período.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        <th className="py-3 pr-4">Demanda</th>
                        <th className="py-3 pr-4">Quem trabalhou</th>
                        <th className="py-3 pr-4 text-right">Dias</th>
                        <th className="py-3 text-right">Horas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {workSessionsReport.map((row, idx) => (
                        <tr key={`${row.ticketId}-${row.userName}-${idx}`}>
                          <td className="py-3 pr-4 text-slate-800">
                            {row.ticketTitulo}
                          </td>
                          <td className="py-3 pr-4 text-slate-700">
                            {row.userName}
                          </td>
                          <td className="py-3 pr-4 text-right text-slate-700">
                            {row.diasTrabalhados}
                          </td>
                          <td className="py-3 text-right font-semibold text-slate-800">
                            {formatHorasMinutos(row.horasTrabalhadas)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Relatório de demandas (tabela + exportação) */}
        {!loading && !error && (
          <div className="ctp-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-800">
                Relatório de demandas
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => exportXLS(tickets, workSessionsReport)}
                  className="btn btn-outline btn-sm"
                >
                  Exportar XLS
                </button>
                <button
                  type="button"
                  onClick={handleExportPDF}
                  className="btn btn-outline btn-sm"
                >
                  Exportar PDF
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg p-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
              <span className="text-sm font-medium text-slate-700">
                Período (data de criação):
              </span>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">De</span>
                <input
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="ctp-input"
                  style={{ width: 'auto' }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Até</span>
                <input
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="ctp-input"
                  style={{ width: 'auto' }}
                />
              </label>
              <button
                type="button"
                onClick={handleFiltrar}
                className="btn btn-primary btn-sm"
              >
                Filtrar
              </button>
              <button
                type="button"
                onClick={handleLimparFiltro}
                className="btn btn-ghost btn-sm"
              >
                Limpar período
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-collapse border border-slate-200 text-left text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    {COLS_RELATORIO.map((col) => (
                      <th
                        key={col}
                        className="border border-slate-200 px-3 py-2 font-semibold text-slate-700"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100">
                      {ticketToRow(t, workSessionsReport).map((cell, i) => (
                        <td
                          key={i}
                          className="border border-slate-100 px-3 py-2 text-slate-600"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {tickets.length === 0 && (
                    <tr>
                      <td
                        colSpan={COLS_RELATORIO.length}
                        className="border border-slate-100 px-3 py-4 text-center text-slate-500"
                      >
                        Nenhuma demanda encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Área usada só na impressão/PDF */}
            <div
              ref={printRef}
              className="hidden"
              aria-hidden
            >
              <table>
                <thead>
                  <tr>
                    {COLS_RELATORIO.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id}>
                      {ticketToRow(t, workSessionsReport).map((cell, i) => (
                        <td key={i}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </ReportsLayout>
  )
}

function buildReports(tickets: Ticket[]): ReportsData {
  const now = new Date()
  const hoje = now.toISOString().slice(0, 10)
  const weekAgo = new Date(now)
  weekAgo.setDate(now.getDate() - 7)

  const porResponsavel = new Map<string, number>()

  tickets.forEach((t) => {
    const created = new Date(t.data_criacao)
    if (created >= weekAgo) {
      const key = t.responsavel_nome ?? 'Sem responsável'
      porResponsavel.set(key, (porResponsavel.get(key) ?? 0) + 1)
    }
  })

  const totalPorResponsavelSemana = Array.from(porResponsavel.entries())
    .map(([responsavel, total]) => ({ responsavel, total }))
    .sort((a, b) => b.total - a.total)

  const statusAprovadoOuApos = [
    'aprovado',
    'em_producao',
    'pos_processo',
    'pronta',
    'entregue',
  ] as const

  const diasNoMes = (ano: number, mes1a12: number) => {
    return new Date(ano, mes1a12, 0).getDate()
  }

  const countRecorrenciasAteHoje = (t: Ticket): number => {
    if (
      !t.receita_recorrente ||
      t.tipo_receita === 'contrapartida' ||
      !t.receita_recorrente_inicio ||
      !t.receita_recorrente_dia_pagamento
    ) {
      return 0
    }
    const start = t.receita_recorrente_inicio
    const end = t.receita_recorrente_fim || hoje
    const endCap = end < hoje ? end : hoje
    if (endCap < start) return 0

    const [sy, sm] = start.split('-').map((x) => Number(x))
    const [ey, em] = endCap.split('-').map((x) => Number(x))
    if (!sy || !sm || !ey || !em) return 0

    const dia = Math.min(
      Math.max(1, Math.floor(Number(t.receita_recorrente_dia_pagamento))),
      31,
    )

    let count = 0
    let y = sy
    let m = sm // 1..12
    while (y < ey || (y === ey && m <= em)) {
      const lastDay = diasNoMes(y, m)
      const d = Math.min(dia, lastDay)
      const due = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (due >= start && due <= endCap) count += 1
      m += 1
      if (m === 13) {
        m = 1
        y += 1
      }
    }
    return count
  }
  const demandasAprovadasOuApos = tickets.filter(
    (t) =>
      t.tipo === 'externa' &&
      statusAprovadoOuApos.includes(
        t.status as (typeof statusAprovadoOuApos)[number],
      ) &&
      true,
  )
  const valor = (t: (typeof demandasAprovadasOuApos)[number]) =>
    t.valor_demanda ?? t.orcamento?.total ?? 0
  const receitaMonetaria = demandasAprovadasOuApos.reduce(
    (sum, t) =>
      sum +
      (t.tipo_receita === 'contrapartida'
        ? 0
        : t.receita_recorrente
          ? valor(t) * countRecorrenciasAteHoje(t)
          : t.pagamento_pago_em && t.pagamento_pago_em.slice(0, 10) <= hoje
            ? valor(t)
            : 0),
    0,
  )
  const receitaContrapartida = demandasAprovadasOuApos.reduce(
    (sum, t) =>
      sum + (t.tipo_receita === 'contrapartida' ? valor(t) : 0),
    0,
  )
  const receitaGeral = receitaMonetaria + receitaContrapartida
  const demandasParaCusto = tickets.filter((t) =>
    statusAprovadoOuApos.includes(t.status as (typeof statusAprovadoOuApos)[number]),
  )
  const custoTotal = demandasParaCusto.reduce(
    (sum, t) => sum + (t.custo ?? 0),
    0,
  )
  const receitaLiquida = receitaMonetaria - custoTotal

  return {
    totalPorResponsavelSemana,
    receitaMonetaria,
    receitaContrapartida,
    receitaGeral,
    custoTotal,
    receitaLiquida,
  }
}

