import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type ExcelJS from 'exceljs'
import { FolderKanban, Wallet, PiggyBank, Building2 } from 'lucide-react'
import { LayoutShell } from '../components/LayoutShell'
import { MetricCard } from '../components/MetricCard'
import { TicketStatusPill, STATUS_LABELS } from '../components/TicketStatusPill'
import type { Ticket, TicketStatus } from '../types/ticket'
import { listTickets } from '../services/tickets'
import { listPrefeitura } from '../services/prefeitura'
import type { RegistroPrefeitura } from '../services/prefeitura'
import { formatarData, formatarMoeda } from '../utils/formatters'

function getValor(t: Ticket): number {
  return t.valor_demanda ?? t.orcamento?.total ?? 0
}

/** Solicitações internas identificadas como "CTP" não entram no relatório. */
function isSolicitanteCTP(nome: string | null | undefined): boolean {
  return (nome ?? '').trim().toUpperCase() === 'CTP'
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

const COLS = ['Data', 'Solicitante', 'Demanda', 'Status', 'Valor', 'Pagamento'] as const

const XLSX_COLORS = {
  navy: 'FF063A70',
  lime: 'FFA1F01F',
  white: 'FFFFFFFF',
  border: 'FFE2E8F0',
  gray: 'FF64748B',
  rowAlt: 'FFF8FAFC',
  kpi: {
    slate: { fill: 'FFEEF2F7', value: 'FF063A70' },
    blue: { fill: 'FFEFF6FF', value: 'FF1D4ED8' },
    green: { fill: 'FFF0FDF4', value: 'FF15803D' },
    violet: { fill: 'FFF5F3FF', value: 'FF6D28D9' },
  },
  pagamento: {
    green: { fill: 'FFF0FDF4', text: 'FF15803D' },
    amber: { fill: 'FFFFFBEB', text: 'FF92400E' },
    sky: { fill: 'FFEFF6FF', text: 'FF1D4ED8' },
    slate: { fill: 'FFF1F5F9', text: 'FF475569' },
  },
} as const

const thinBorder: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: XLSX_COLORS.border } }

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: XLSX_COLORS.white }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_COLORS.navy } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
  })
  row.height = 22
}

function addKpiCard(
  sheet: ExcelJS.Worksheet,
  startCol: string,
  labelRow: number,
  label: string,
  value: string,
  tone: keyof typeof XLSX_COLORS.kpi,
) {
  const endCol = String.fromCharCode(startCol.charCodeAt(0) + 1)
  const { fill, value: valueColor } = XLSX_COLORS.kpi[tone]

  sheet.mergeCells(`${startCol}${labelRow}:${endCol}${labelRow}`)
  const labelCell = sheet.getCell(`${startCol}${labelRow}`)
  labelCell.value = label.toUpperCase()
  labelCell.font = { size: 9, bold: true, color: { argb: XLSX_COLORS.gray } }
  labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  sheet.mergeCells(`${startCol}${labelRow + 1}:${endCol}${labelRow + 2}`)
  const valueCell = sheet.getCell(`${startCol}${labelRow + 1}`)
  valueCell.value = value
  valueCell.font = { size: 18, bold: true, color: { argb: valueColor } }
  valueCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  for (let r = labelRow; r <= labelRow + 2; r++) {
    for (const col of [startCol, endCol]) {
      const cell = sheet.getCell(`${col}${r}`)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      cell.border = {
        top: r === labelRow ? thinBorder : undefined,
        bottom: r === labelRow + 2 ? thinBorder : undefined,
        left: col === startCol ? thinBorder : undefined,
        right: col === endCol ? thinBorder : undefined,
      }
    }
  }
  sheet.getRow(labelRow).height = 18
  sheet.getRow(labelRow + 1).height = 22
  sheet.getRow(labelRow + 2).height = 22
}

interface TotaisRelatorio {
  totalProjetos: number
  valorOrcado: number
  valorRecebido: number
  totalParcerias: number
}

async function exportXLSX(
  tickets: Ticket[],
  parcerias: RegistroPrefeitura[],
  totais: TotaisRelatorio,
  mesLabel: string,
) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Espaço Maker · Cilla Tech Park'
  wb.created = new Date()

  // ---------------- Aba 1: Resumo (dashboard) ----------------
  const resumo = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }] })
  resumo.columns = [
    { width: 2 }, { width: 22 }, { width: 20 }, { width: 3 },
    { width: 22 }, { width: 20 }, { width: 3 },
    { width: 22 }, { width: 20 }, { width: 3 },
    { width: 22 }, { width: 20 }, { width: 2 },
  ]

  resumo.mergeCells('B2:L2')
  const title = resumo.getCell('B2')
  title.value = 'Relatório Mensal — Espaço Maker'
  title.font = { size: 18, bold: true, color: { argb: XLSX_COLORS.navy } }
  resumo.getRow(2).height = 26

  resumo.mergeCells('B3:L3')
  const subtitle = resumo.getCell('B3')
  subtitle.value = `${mesLabel} · gerado em ${new Date().toLocaleDateString('pt-BR')}`
  subtitle.font = { size: 11, color: { argb: XLSX_COLORS.gray } }

  addKpiCard(resumo, 'B', 5, 'Total de projetos', String(totais.totalProjetos), 'slate')
  addKpiCard(resumo, 'E', 5, 'Valor total orçado', formatarMoeda(totais.valorOrcado), 'blue')
  addKpiCard(resumo, 'H', 5, 'Valor total recebido', formatarMoeda(totais.valorRecebido), 'green')
  addKpiCard(resumo, 'K', 5, 'Parcerias (prefeitura)', String(totais.totalParcerias), 'violet')

  const breakdownStart = 10
  resumo.mergeCells(`B${breakdownStart}:C${breakdownStart}`)
  const breakdownTitle = resumo.getCell(`B${breakdownStart}`)
  breakdownTitle.value = 'Projetos por status'
  breakdownTitle.font = { size: 12, bold: true, color: { argb: XLSX_COLORS.navy } }

  const contagemPorStatus = new Map<string, number>()
  for (const t of tickets) {
    contagemPorStatus.set(t.status, (contagemPorStatus.get(t.status) ?? 0) + 1)
  }
  const headerBreakdownRow = resumo.getRow(breakdownStart + 1)
  headerBreakdownRow.getCell(2).value = 'Status'
  headerBreakdownRow.getCell(3).value = 'Quantidade'
  styleHeaderRow(headerBreakdownRow)
  resumo.mergeCells(`D${breakdownStart + 1}:L${breakdownStart + 1}`)

  let r = breakdownStart + 2
  Array.from(contagemPorStatus.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count], idx) => {
      const row = resumo.getRow(r)
      row.getCell(2).value = STATUS_LABELS[status as TicketStatus] ?? status
      row.getCell(3).value = count
      for (const col of [2, 3]) {
        const cell = row.getCell(col)
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? XLSX_COLORS.white : XLSX_COLORS.rowAlt },
        }
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
      }
      r += 1
    })
  if (contagemPorStatus.size === 0) {
    resumo.getRow(r).getCell(2).value = 'Nenhum projeto no período.'
    r += 1
  }

  resumo.mergeCells(`B${r + 1}:L${r + 1}`)
  const nota = resumo.getCell(`B${r + 1}`)
  nota.value = 'Detalhamento completo de cada projeto na aba "Projetos". Parcerias com prefeituras na aba "Parcerias".'
  nota.font = { size: 9, italic: true, color: { argb: XLSX_COLORS.gray } }

  // ---------------- Aba 2: Projetos ----------------
  const projetos = wb.addWorksheet('Projetos', { views: [{ state: 'frozen', ySplit: 1 }] })
  projetos.columns = [
    { header: 'Data', key: 'data', width: 13 },
    { header: 'Solicitante', key: 'solicitante', width: 24 },
    { header: 'Demanda', key: 'demanda', width: 38 },
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Valor', key: 'valor', width: 16, style: { numFmt: '"R$" #,##0.00' } },
    { header: 'Pagamento', key: 'pagamento', width: 16 },
  ]
  styleHeaderRow(projetos.getRow(1))

  tickets.forEach((t, idx) => {
    const pag = getPagamentoInfo(t)
    const row = projetos.addRow({
      data: formatarData(t.data_criacao),
      solicitante: t.solicitante_nome,
      demanda: t.titulo,
      status: STATUS_LABELS[t.status],
      valor: getValor(t),
      pagamento: pag.label,
    })
    const bg = idx % 2 === 0 ? XLSX_COLORS.white : XLSX_COLORS.rowAlt
    row.eachCell((cell, colNumber) => {
      cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
      if (colNumber === 6) {
        const tone = XLSX_COLORS.pagamento[pag.tone]
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fill } }
        cell.font = { color: { argb: tone.text }, bold: true, size: 10 }
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      }
    })
  })

  if (tickets.length > 0) {
    const totalRow = projetos.addRow({
      data: '', solicitante: '', demanda: '', status: 'Total', valor: tickets.reduce((s, t) => s + getValor(t), 0), pagamento: '',
    })
    totalRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: XLSX_COLORS.navy } }
      cell.border = { top: { style: 'medium', color: { argb: XLSX_COLORS.navy } } }
    })
  }
  projetos.autoFilter = { from: 'A1', to: 'F1' }

  // ---------------- Aba 3: Parcerias ----------------
  const parceriasSheet = wb.addWorksheet('Parcerias', { views: [{ state: 'frozen', ySplit: 1 }] })
  parceriasSheet.columns = [
    { header: 'Data', key: 'data', width: 13 },
    { header: 'Município', key: 'municipio', width: 26 },
    { header: 'Contato', key: 'contato', width: 24 },
    { header: 'Status', key: 'status', width: 18 },
  ]
  styleHeaderRow(parceriasSheet.getRow(1))
  parcerias.forEach((p, idx) => {
    const row = parceriasSheet.addRow({
      data: formatarData(p.criadoEm),
      municipio: p.municipio,
      contato: p.contato,
      status: p.status,
    })
    const bg = idx % 2 === 0 ? XLSX_COLORS.white : XLSX_COLORS.rowAlt
    row.eachCell((cell) => {
      cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
    })
  })
  if (parcerias.length > 0) {
    parceriasSheet.autoFilter = { from: 'A1', to: 'D1' }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-mensal-${mesLabel.replace(/\s+/g, '-').toLowerCase()}.xlsx`
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
      setTickets(
        list.filter((t) => t.status !== 'cancelada' && !isSolicitanteCTP(t.solicitante_nome)),
      )
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
            <button
              type="button"
              onClick={() => void exportXLSX(tickets, parcerias, totais, mesLabel)}
              className="btn btn-outline btn-sm"
            >
              Exportar Excel
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
                          <td>{t.titulo}</td>
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
