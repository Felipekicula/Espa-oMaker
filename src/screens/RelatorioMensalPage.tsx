import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type ExcelJS from 'exceljs'
import { FolderKanban, Wallet, PiggyBank, HeartHandshake } from 'lucide-react'
import { LayoutShell } from '../components/LayoutShell'
import { MetricCard } from '../components/MetricCard'
import type { Ticket, TicketStatus } from '../types/ticket'
import { listTickets, listTicketsPagosNoPeriodo } from '../services/tickets'
import { formatarData, formatarMoeda } from '../utils/formatters'

/** As 11 fases técnicas do sistema são resumidas nestas 8 categorias do relatório. */
const REPORT_STATUS_ORDER = [
  'Em análise',
  'Orçamento Gerado',
  'Orçamento Aguardando Aprovação Pedro',
  'Orçamento Aguardando Aprovação Cliente',
  'Cancelada',
  'Pedido Gerado',
  'Pedido em Execução',
  'Pedido em Entregue',
] as const

const REPORT_STATUS_MAP: Record<TicketStatus, (typeof REPORT_STATUS_ORDER)[number]> = {
  recebida: 'Em análise',
  em_analise: 'Em análise',
  orcamento_em_criacao: 'Orçamento Gerado',
  aguardando_aprovacao: 'Orçamento Aguardando Aprovação Pedro',
  enviado_cliente: 'Orçamento Aguardando Aprovação Cliente',
  cancelada: 'Cancelada',
  aprovado: 'Pedido Gerado',
  em_producao: 'Pedido em Execução',
  pos_processo: 'Pedido em Execução',
  pronta: 'Pedido em Execução',
  entregue: 'Pedido em Entregue',
}

function getReportStatus(t: Ticket) {
  return REPORT_STATUS_MAP[t.status] ?? 'Em análise'
}

function getValor(t: Ticket): number {
  return t.valor_demanda ?? t.orcamento?.total ?? 0
}

/** Parceria = orçamento cortesia (valor R$ 0,00), não é sobre tipo interna/externa. */
function isParceria(t: Ticket): boolean {
  return getValor(t) === 0
}

/**
 * Responsável só é atribuído a partir do status "aprovado", e a própria
 * atribuição sempre reseta o status para "em_analise" (ver
 * AtribuirResponsavelPage). Ou seja: um responsável definido só é sinal
 * confiável de 50% pago quando o status atual é um desses — se a demanda tem
 * responsável mas está em "Orçamento Gerado"/"Aguardando Aprovação", o
 * orçamento foi reaberto depois da atribuição e não dá pra confiar no sinal.
 */
const RESPONSAVEL_IMPLICA_50_PORCENTO: readonly TicketStatus[] = [
  'em_analise',
  'em_producao',
  'pos_processo',
  'pronta',
]

/**
 * Valor recebido, do sinal mais confiável para o mais fraco:
 *   1) "Faturamento" marcado como pago (pagamento_pago_em, dado baixa manual
 *      na demanda) → 100%, vale independente do status atual
 *   2) Status Entregue → 100% (se ainda não tinha sido marcado o faturamento)
 *   3) Já tem responsável definido e o status confirma o ciclo pós-aprovação
 *      → 50%
 *   4) Cancelada ou nenhum dos sinais acima → 0%
 */
function getValorRecebido(t: Ticket): number {
  if (t.status === 'cancelada') return 0
  const valor = getValor(t)
  if (t.pagamento_pago_em || t.status === 'entregue') return valor
  if (t.responsavel_id && RESPONSAVEL_IMPLICA_50_PORCENTO.includes(t.status)) return valor * 0.5
  return 0
}

const STATUS_TONES: Record<(typeof REPORT_STATUS_ORDER)[number], { bg: string; color: string }> = {
  'Em análise': { bg: '#F1F5F9', color: '#475569' },
  'Orçamento Gerado': { bg: '#ECFEFF', color: '#155E75' },
  'Orçamento Aguardando Aprovação Pedro': { bg: '#FFFBEB', color: '#92400E' },
  'Orçamento Aguardando Aprovação Cliente': { bg: '#FCE7D8', color: '#B5580F' },
  Cancelada: { bg: '#FEF2F2', color: '#991B1B' },
  'Pedido Gerado': { bg: '#EFF6FF', color: '#1D4ED8' },
  'Pedido em Execução': { bg: '#F5F3FF', color: '#6D28D9' },
  'Pedido em Entregue': { bg: '#F0FDF4', color: '#15803D' },
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

const PROJ_COLS = ['Data', 'Cliente', 'Projeto/Produto', 'Valor Orçado', 'Status Atual', 'Valor Recebido'] as const

// ============================================================
// Exportação Excel — réplica do Dashboard usado pela equipe,
// uma única aba, mesmas cores/seções, sem filtro e sem linhas vazias.
// ============================================================
const X = {
  navy: 'FF1F3864',
  lightBlue: 'FFEAF1FA',
  tableHead: 'FFBDD7EE',
  sectionBlue: 'FF2E5395',
  sectionGreen: 'FF548235',
  yellow: 'FFFFE699',
  gray: 'FF595959',
  grayLight: 'FF808080',
  white: 'FFFFFFFF',
  black: 'FF000000',
  rowAlt: 'FFF4F7FB',
  parcAlt: 'FFF1F8EE',
} as const

const thinBorder: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFC9C9C9' } }
const borderAll: Partial<ExcelJS.Borders> = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }

function fillCell(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

interface TotaisRelatorio {
  totalProjetos: number
  valorOrcado: number
  valorRecebido: number
  totalParcerias: number
}

/**
 * Renderiza uma seção de tabela de projetos (título + cabeçalho + linhas + total)
 * a partir da `startRow` informada e devolve a última linha ocupada.
 */
function renderProjetosSection(
  ws: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  items: Ticket[],
  emptyMessage: string,
): number {
  ws.mergeCells(`A${startRow}:J${startRow}`)
  const sectionTitle = ws.getCell(`A${startRow}`)
  sectionTitle.value = title
  sectionTitle.font = { name: 'Arial', size: 12, bold: true, color: { argb: X.white } }
  sectionTitle.alignment = { horizontal: 'left', vertical: 'middle' }
  fillCell(sectionTitle, X.sectionBlue)
  ws.getRow(startRow).height = 20

  const colsRow = startRow + 1
  const headers = ['Data', 'Cliente', 'Projeto/Produto', 'Valor Orçado (R$)', 'Status Atual', 'Valor Recebido (R$)']
  const colLetters = ['A', 'B', 'C', 'D', 'E', 'F']
  colLetters.forEach((col, i) => {
    const cell = ws.getCell(`${col}${colsRow}`)
    cell.value = headers[i]
    cell.font = { name: 'Arial', size: 10, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    fillCell(cell, X.tableHead)
    cell.border = borderAll
  })
  ws.mergeCells(`G${colsRow}:J${colsRow}`)
  fillCell(ws.getCell(`G${colsRow}`), X.tableHead)
  ws.getCell(`G${colsRow}`).border = borderAll
  ws.getRow(colsRow).height = 26

  const firstDataRow = colsRow + 1
  items.forEach((item, i) => {
    const r = firstDataRow + i
    const bg = i % 2 === 0 ? X.white : X.rowAlt
    const valor = getValor(item)
    const recebido = getValorRecebido(item)

    const cData = ws.getCell(`A${r}`)
    cData.value = new Date(item.data_criacao)
    cData.numFmt = 'dd/mm/yyyy'
    cData.font = { name: 'Arial', size: 10 }
    cData.alignment = { horizontal: 'left', vertical: 'middle' }
    fillCell(cData, bg)
    cData.border = borderAll

    const cCliente = ws.getCell(`B${r}`)
    cCliente.value = item.solicitante_nome
    cCliente.font = { name: 'Arial', size: 10 }
    cCliente.alignment = { horizontal: 'left', vertical: 'middle' }
    fillCell(cCliente, bg)
    cCliente.border = borderAll

    const cProjeto = ws.getCell(`C${r}`)
    cProjeto.value = item.titulo
    cProjeto.font = { name: 'Arial', size: 10 }
    cProjeto.alignment = { horizontal: 'left', vertical: 'middle' }
    fillCell(cProjeto, bg)
    cProjeto.border = borderAll

    const cValor = ws.getCell(`D${r}`)
    cValor.value = valor
    cValor.numFmt = '#,##0.00'
    cValor.font = { name: 'Arial', size: 10 }
    cValor.alignment = { horizontal: 'right', vertical: 'middle' }
    fillCell(cValor, bg)
    cValor.border = borderAll

    const cStatus = ws.getCell(`E${r}`)
    cStatus.value = getReportStatus(item)
    cStatus.font = { name: 'Arial', size: 10 }
    cStatus.alignment = { horizontal: 'left', vertical: 'middle' }
    fillCell(cStatus, bg)
    cStatus.border = borderAll

    const cRecebido = ws.getCell(`F${r}`)
    cRecebido.value = recebido
    cRecebido.numFmt = '#,##0.00;(#,##0.00);-'
    cRecebido.font = { name: 'Arial', size: 10 }
    cRecebido.alignment = { horizontal: 'right', vertical: 'middle' }
    fillCell(cRecebido, bg)
    cRecebido.border = borderAll

    ws.mergeCells(`G${r}:J${r}`)
    fillCell(ws.getCell(`G${r}`), bg)
    ws.getCell(`G${r}`).border = borderAll

    ws.getRow(r).height = 16
  })

  const lastDataRow = firstDataRow + items.length - 1

  if (items.length > 0) {
    const totalRow = lastDataRow + 1
    const totalValor = items.reduce((s, it) => s + getValor(it), 0)
    const totalRecebido = items.reduce((s, it) => s + getValorRecebido(it), 0)

    ws.mergeCells(`A${totalRow}:C${totalRow}`)
    const totalLabel = ws.getCell(`A${totalRow}`)
    totalLabel.value = 'Total'
    totalLabel.font = { name: 'Arial', size: 10, bold: true, color: { argb: X.navy } }
    totalLabel.alignment = { horizontal: 'left', vertical: 'middle' }
    fillCell(totalLabel, X.tableHead)
    totalLabel.border = borderAll

    const cTotalValor = ws.getCell(`D${totalRow}`)
    cTotalValor.value = totalValor
    cTotalValor.numFmt = '#,##0.00'
    cTotalValor.font = { name: 'Arial', size: 10, bold: true }
    cTotalValor.alignment = { horizontal: 'right', vertical: 'middle' }
    fillCell(cTotalValor, X.tableHead)
    cTotalValor.border = borderAll

    fillCell(ws.getCell(`E${totalRow}`), X.tableHead)
    ws.getCell(`E${totalRow}`).border = borderAll

    const cTotalRecebido = ws.getCell(`F${totalRow}`)
    cTotalRecebido.value = totalRecebido
    cTotalRecebido.numFmt = '#,##0.00'
    cTotalRecebido.font = { name: 'Arial', size: 10, bold: true }
    cTotalRecebido.alignment = { horizontal: 'right', vertical: 'middle' }
    fillCell(cTotalRecebido, X.tableHead)
    cTotalRecebido.border = borderAll

    ws.mergeCells(`G${totalRow}:J${totalRow}`)
    fillCell(ws.getCell(`G${totalRow}`), X.tableHead)
    ws.getCell(`G${totalRow}`).border = borderAll

    return totalRow
  }

  const emptyRow = lastDataRow + 1
  ws.mergeCells(`A${emptyRow}:J${emptyRow}`)
  const emptyCell = ws.getCell(`A${emptyRow}`)
  emptyCell.value = emptyMessage
  emptyCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: X.gray } }
  emptyCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(emptyRow).height = 16
  return emptyRow
}

async function exportXLSX(
  tickets: Ticket[],
  projetosDoMes: Ticket[],
  pagamentosForaDoMes: Ticket[],
  totais: TotaisRelatorio,
  lojinha: number,
  mesLabel: string,
) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Espaço Maker · Cilla Tech Park'
  wb.created = new Date()

  const ws = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }] })
  ws.columns = [
    { width: 12 }, { width: 22 }, { width: 34 }, { width: 15 },
    { width: 32 }, { width: 15 }, { width: 11 }, { width: 8 }, { width: 8 }, { width: 8 },
  ]

  // ---------- Título ----------
  ws.mergeCells('A1:J1')
  const title = ws.getCell('A1')
  title.value = `DASHBOARD — SETOR ESPAÇO MAKER (${mesLabel.toUpperCase()})`
  title.font = { name: 'Arial', size: 14, bold: true, color: { argb: X.white } }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  fillCell(title, X.navy)
  ws.getRow(1).height = 26

  ws.mergeCells('A2:J2')
  const sub = ws.getCell('A2')
  sub.value = `Gerado automaticamente a partir das demandas do sistema · ${new Date().toLocaleDateString('pt-BR')}`
  sub.font = { name: 'Arial', size: 9, italic: true, color: { argb: X.gray } }
  sub.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(2).height = 16

  // ---------- KPIs ----------
  const kpiLabelRow = 4
  const kpiValueRow = 5
  const kpiSubRow = 7
  const kpis: { label: string; value: number | string; numFmt?: string; sub: string; startCol: string; endCol: string }[] = [
    { label: 'Total de Projetos', value: totais.totalProjetos, sub: 'demandas com valor (exclui parcerias)', startCol: 'A', endCol: 'B' },
    { label: 'Valor Total Recebido (R$)', value: totais.valorRecebido, numFmt: '#,##0.00', sub: 'Responsável = 50% · Faturamento pago/Entregue = 100%', startCol: 'C', endCol: 'E' },
    { label: 'Valor Total Orçado (R$)', value: totais.valorOrcado, numFmt: '#,##0.00', sub: 'demandas que abriram orçamento no mês', startCol: 'F', endCol: 'G' },
    { label: 'Parcerias (Valor = 0)', value: totais.totalParcerias, sub: 'orçamentos cortesia do mês', startCol: 'H', endCol: 'J' },
  ]
  for (const k of kpis) {
    ws.mergeCells(`${k.startCol}${kpiLabelRow}:${k.endCol}${kpiLabelRow}`)
    const labelCell = ws.getCell(`${k.startCol}${kpiLabelRow}`)
    labelCell.value = k.label
    labelCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: X.navy } }
    labelCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    fillCell(labelCell, X.lightBlue)

    ws.mergeCells(`${k.startCol}${kpiValueRow}:${k.endCol}${kpiValueRow + 1}`)
    const valueCell = ws.getCell(`${k.startCol}${kpiValueRow}`)
    valueCell.value = k.value
    valueCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: X.black } }
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' }
    if (k.numFmt) valueCell.numFmt = k.numFmt
    fillCell(valueCell, X.lightBlue)

    ws.mergeCells(`${k.startCol}${kpiSubRow}:${k.endCol}${kpiSubRow}`)
    const subCell = ws.getCell(`${k.startCol}${kpiSubRow}`)
    subCell.value = k.sub
    subCell.font = { name: 'Arial', size: 8, italic: true, color: { argb: X.gray } }
    subCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    fillCell(subCell, X.lightBlue)
  }
  ws.getRow(kpiLabelRow).height = 20
  ws.getRow(kpiValueRow).height = 26
  ws.getRow(kpiValueRow + 1).height = 20
  ws.getRow(kpiSubRow).height = 16

  // ---------- Lojinha CTP + Total Geral ----------
  const lojinhaRow = 9
  ws.mergeCells(`A${lojinhaRow}:C${lojinhaRow}`)
  const lojinhaLabel = ws.getCell(`A${lojinhaRow}`)
  lojinhaLabel.value = 'Vendas da Lojinha CTP (manual)'
  lojinhaLabel.font = { name: 'Arial', size: 10, bold: true, color: { argb: X.navy } }
  lojinhaLabel.alignment = { horizontal: 'center', vertical: 'middle' }
  fillCell(lojinhaLabel, X.lightBlue)

  ws.mergeCells(`D${lojinhaRow}:E${lojinhaRow}`)
  const lojinhaValue = ws.getCell(`D${lojinhaRow}`)
  lojinhaValue.value = lojinha
  lojinhaValue.numFmt = '#,##0.00'
  lojinhaValue.font = { name: 'Arial', size: 13, bold: true, color: { argb: X.black } }
  lojinhaValue.alignment = { horizontal: 'center', vertical: 'middle' }
  fillCell(lojinhaValue, X.yellow)

  ws.mergeCells(`F${lojinhaRow}:G${lojinhaRow}`)
  const totalGeralLabel = ws.getCell(`F${lojinhaRow}`)
  totalGeralLabel.value = 'Total Geral Recebido (R$)'
  totalGeralLabel.font = { name: 'Arial', size: 10, bold: true, color: { argb: X.navy } }
  totalGeralLabel.alignment = { horizontal: 'center', vertical: 'middle' }
  fillCell(totalGeralLabel, X.lightBlue)

  ws.mergeCells(`H${lojinhaRow}:J${lojinhaRow}`)
  const totalGeralValue = ws.getCell(`H${lojinhaRow}`)
  totalGeralValue.value = totais.valorRecebido + lojinha
  totalGeralValue.numFmt = '#,##0.00'
  totalGeralValue.font = { name: 'Arial', size: 13, bold: true, color: { argb: X.black } }
  totalGeralValue.alignment = { horizontal: 'center', vertical: 'middle' }
  fillCell(totalGeralValue, X.lightBlue)
  ws.getRow(lojinhaRow).height = 24

  // ---------- Resumo por status ----------
  const resumoHeaderRow = 11
  ws.mergeCells(`A${resumoHeaderRow}:J${resumoHeaderRow}`)
  const resumoTitle = ws.getCell(`A${resumoHeaderRow}`)
  resumoTitle.value = 'RESUMO POR STATUS'
  resumoTitle.font = { name: 'Arial', size: 12, bold: true, color: { argb: X.white } }
  resumoTitle.alignment = { horizontal: 'left', vertical: 'middle' }
  fillCell(resumoTitle, X.sectionBlue)
  ws.getRow(resumoHeaderRow).height = 20

  const resumoColsRow = resumoHeaderRow + 1
  ws.mergeCells(`A${resumoColsRow}:D${resumoColsRow}`)
  ws.mergeCells(`E${resumoColsRow}:F${resumoColsRow}`)
  ws.mergeCells(`G${resumoColsRow}:J${resumoColsRow}`)
  ;[
    ['A', 'Status'],
    ['E', 'Qtde'],
    ['G', 'Valor Orçado no Status (R$)'],
  ].forEach(([col, label]) => {
    const cell = ws.getCell(`${col}${resumoColsRow}`)
    cell.value = label
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: X.black } }
    cell.alignment = { horizontal: col === 'A' ? 'left' : 'center', vertical: 'middle' }
    fillCell(cell, X.tableHead)
    cell.border = borderAll
  })
  ws.getRow(resumoColsRow).height = 18

  const contagemPorStatus = new Map<string, { qtde: number; valor: number }>()
  for (const label of REPORT_STATUS_ORDER) contagemPorStatus.set(label, { qtde: 0, valor: 0 })
  for (const t of tickets) {
    const label = getReportStatus(t)
    const cur = contagemPorStatus.get(label)!
    cur.qtde += 1
    cur.valor += getValor(t)
  }

  REPORT_STATUS_ORDER.forEach((label, i) => {
    const r = resumoColsRow + 1 + i
    const bg = i % 2 === 0 ? X.white : X.rowAlt
    const { qtde, valor } = contagemPorStatus.get(label)!
    ws.mergeCells(`A${r}:D${r}`)
    ws.mergeCells(`E${r}:F${r}`)
    ws.mergeCells(`G${r}:J${r}`)
    const cLabel = ws.getCell(`A${r}`)
    cLabel.value = label
    cLabel.font = { name: 'Arial', size: 10 }
    cLabel.alignment = { horizontal: 'left', vertical: 'middle' }
    fillCell(cLabel, bg)
    cLabel.border = borderAll

    const cQtde = ws.getCell(`E${r}`)
    cQtde.value = qtde
    cQtde.font = { name: 'Arial', size: 10 }
    cQtde.alignment = { horizontal: 'center', vertical: 'middle' }
    fillCell(cQtde, bg)
    cQtde.border = borderAll

    const cValor = ws.getCell(`G${r}`)
    cValor.value = valor
    cValor.numFmt = '#,##0.00;(#,##0.00);-'
    cValor.font = { name: 'Arial', size: 10 }
    cValor.alignment = { horizontal: 'right', vertical: 'middle' }
    fillCell(cValor, bg)
    cValor.border = borderAll

    ws.getRow(r).height = 16
  })
  const resumoLastRow = resumoColsRow + REPORT_STATUS_ORDER.length

  // ---------- Projetos do mês ----------
  const projLastRow = renderProjetosSection(
    ws,
    resumoLastRow + 2,
    'PROJETOS DO MÊS',
    projetosDoMes,
    'Nenhum projeto criado neste mês.',
  )

  // ---------- Pagamentos recebidos de outros meses ----------
  const pagamentosLastRow = renderProjetosSection(
    ws,
    projLastRow + 2,
    'PAGAMENTOS RECEBIDOS DE OUTROS MESES',
    pagamentosForaDoMes,
    'Nenhum pagamento de outro mês recebido neste mês.',
  )

  // ---------- Parcerias ----------
  const parcerias = tickets.filter(isParceria)
  const parcHeaderRow = pagamentosLastRow + 2
  ws.mergeCells(`A${parcHeaderRow}:J${parcHeaderRow}`)
  const parcTitle = ws.getCell(`A${parcHeaderRow}`)
  parcTitle.value = 'PARCERIAS — Projetos com Valor = R$ 0,00'
  parcTitle.font = { name: 'Arial', size: 12, bold: true, color: { argb: X.white } }
  parcTitle.alignment = { horizontal: 'left', vertical: 'middle' }
  fillCell(parcTitle, X.sectionGreen)
  ws.getRow(parcHeaderRow).height = 20

  const parcColsRow = parcHeaderRow + 1
  const parcCols: [string, string][] = [
    ['A', 'Data'],
    ['B', 'Cliente'],
    ['C', 'Projeto/Produto'],
    ['G', 'Status Atual'],
  ]
  ws.mergeCells(`C${parcColsRow}:F${parcColsRow}`)
  ws.mergeCells(`G${parcColsRow}:J${parcColsRow}`)
  parcCols.forEach(([col, label]) => {
    const cell = ws.getCell(`${col}${parcColsRow}`)
    cell.value = label
    cell.font = { name: 'Arial', size: 10, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    fillCell(cell, X.tableHead)
    cell.border = borderAll
  })
  ws.getRow(parcColsRow).height = 18

  if (parcerias.length > 0) {
    parcerias.forEach((t, i) => {
      const r = parcColsRow + 1 + i
      const bg = i % 2 === 0 ? X.white : X.parcAlt
      ws.mergeCells(`C${r}:F${r}`)
      ws.mergeCells(`G${r}:J${r}`)

      const cData = ws.getCell(`A${r}`)
      cData.value = new Date(t.data_criacao)
      cData.numFmt = 'dd/mm/yyyy'
      cData.font = { name: 'Arial', size: 10 }
      fillCell(cData, bg)
      cData.border = borderAll

      const cCliente = ws.getCell(`B${r}`)
      cCliente.value = t.solicitante_nome
      cCliente.font = { name: 'Arial', size: 10 }
      fillCell(cCliente, bg)
      cCliente.border = borderAll

      const cProjeto = ws.getCell(`C${r}`)
      cProjeto.value = t.titulo
      cProjeto.font = { name: 'Arial', size: 10 }
      fillCell(cProjeto, bg)
      cProjeto.border = borderAll

      const cStatus = ws.getCell(`G${r}`)
      cStatus.value = getReportStatus(t)
      cStatus.font = { name: 'Arial', size: 10 }
      fillCell(cStatus, bg)
      cStatus.border = borderAll

      ws.getRow(r).height = 16
    })
  } else {
    ws.mergeCells(`A${parcColsRow + 1}:J${parcColsRow + 1}`)
    const emptyCell = ws.getCell(`A${parcColsRow + 1}`)
    emptyCell.value = 'Nenhuma parceria neste mês.'
    emptyCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: X.gray } }
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(parcColsRow + 1).height = 16
  }
  const parcLastRow = parcColsRow + Math.max(parcerias.length, 1)

  // ---------- Observações ----------
  const obsRow = parcLastRow + 2
  ws.mergeCells(`A${obsRow}:J${obsRow}`)
  const obs = ws.getCell(`A${obsRow}`)
  obs.value =
    'Valor Recebido: demanda com faturamento dado baixa como pago (ou status Entregue) conta 100% do valor orçado; ' +
    'demanda com responsável definido, em Em análise/Pedido em Execução (mas sem baixa de pagamento), conta 50%, pois só se define responsável depois de pago pelo menos metade; ' +
    'sem nenhum dos dois sinais, ou cancelada, conta 0%.  •  ' +
    '"Pagamentos Recebidos de Outros Meses" são demandas criadas em mês anterior, mas cujo pagamento foi confirmado neste mês — contam no Valor Total Recebido, mas não no Valor Total Orçado.  •  ' +
    'Valor Total Orçado = soma de todas as demandas com valor que abriram orçamento no mês, qualquer status.  •  ' +
    'Parceria = projetos com valor R$ 0,00 (orçamento cortesia/interno) — não entram em "Projetos do Mês" nem no Total de Projetos.  •  ' +
    'Total Geral Recebido = Valor Total Recebido + Vendas da Lojinha CTP (célula amarela, manual).'
  obs.font = { name: 'Arial', size: 8, italic: true, color: { argb: X.grayLight } }
  obs.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
  ws.getRow(obsRow).height = 28

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `dashboard-espaco-maker-${mesLabel.replace(/\s+/g, '-').toLowerCase()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export function RelatorioMensalPage() {
  const [mes, setMes] = useState(mesAtualStr())
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [pagamentosForaDoMes, setPagamentosForaDoMes] = useState<Ticket[]>([])
  const [lojinha, setLojinha] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  const { inicio, fim, label: mesLabel } = useMemo(() => limitesDoMes(mes), [mes])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const [{ tickets: list }, pagos] = await Promise.all([
        listTickets(
          { dataCriacaoInicial: inicio, dataCriacaoFinal: fim },
          { limit: 5000, orderBy: 'data_criacao', orderDirection: 'asc' },
        ),
        listTicketsPagosNoPeriodo(inicio, fim),
      ])
      const idsDoMes = new Set(list.map((t) => t.id))
      setTickets(list)
      // Demandas criadas em outro mês, mas cujo pagamento foi confirmado agora —
      // o dinheiro entrou neste mês, então precisa contar no "Valor Recebido".
      setPagamentosForaDoMes(pagos.filter((t) => !idsDoMes.has(t.id)))
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

  // Parceria (valor R$ 0,00) é demanda interna — conta só na seção "Parcerias",
  // nunca em "Projetos do Mês" nem no "Total de Projetos" (que mede clientes
  // externos que entraram em contato no mês).
  const projetosComValor = useMemo(() => tickets.filter((t) => !isParceria(t)), [tickets])
  const pagamentosForaDoMesComValor = useMemo(
    () => pagamentosForaDoMes.filter((t) => !isParceria(t)),
    [pagamentosForaDoMes],
  )

  const totais = useMemo<TotaisRelatorio>(() => {
    const valorOrcado = projetosComValor.reduce((sum, t) => sum + getValor(t), 0)
    const valorRecebidoDoMes = projetosComValor.reduce((sum, t) => sum + getValorRecebido(t), 0)
    const valorRecebidoForaDoMes = pagamentosForaDoMesComValor.reduce((sum, t) => sum + getValorRecebido(t), 0)
    const totalParcerias = tickets.filter(isParceria).length
    return {
      totalProjetos: projetosComValor.length,
      valorOrcado,
      valorRecebido: valorRecebidoDoMes + valorRecebidoForaDoMes,
      totalParcerias,
    }
  }, [tickets, projetosComValor, pagamentosForaDoMesComValor])

  const totalGeralRecebido = totais.valorRecebido + lojinha
  const parcerias = useMemo(() => tickets.filter(isParceria), [tickets])

  const resumoPorStatus = useMemo(() => {
    const map = new Map<string, { qtde: number; valor: number }>()
    for (const label of REPORT_STATUS_ORDER) map.set(label, { qtde: 0, valor: 0 })
    for (const t of tickets) {
      const label = getReportStatus(t)
      const cur = map.get(label)!
      cur.qtde += 1
      cur.valor += getValor(t)
    }
    return REPORT_STATUS_ORDER.map((label) => ({ label, ...map.get(label)! }))
  }, [tickets])

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
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 24px; color: #0F172A; }
        h1 { font-size: 18px; margin-bottom: 2px; }
        h2 { font-size: 13px; margin: 20px 0 8px; }
        p.sub { color: #64748B; margin-top: 0; margin-bottom: 20px; }
        .summary { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
        .summary div { border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 14px; flex: 1; min-width: 140px; }
        .summary p { margin: 0; }
        .summary .label { font-size: 10px; text-transform: uppercase; color: #64748B; }
        .summary .value { font-size: 16px; font-weight: 700; margin-top: 4px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
        th { background: #BDD7EE; }
      </style></head><body>
        <h1>Dashboard — Espaço Maker (${mesLabel})</h1>
        <p class="sub">Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
        <div class="summary">
          <div><p class="label">Total de projetos</p><p class="value">${totais.totalProjetos}</p></div>
          <div><p class="label">Valor recebido</p><p class="value">${formatarMoeda(totais.valorRecebido)}</p></div>
          <div><p class="label">Valor orçado</p><p class="value">${formatarMoeda(totais.valorOrcado)}</p></div>
          <div><p class="label">Parcerias</p><p class="value">${totais.totalParcerias}</p></div>
          <div><p class="label">Total geral recebido</p><p class="value">${formatarMoeda(totalGeralRecebido)}</p></div>
        </div>
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
          <div>
            <label className="ctp-label">Vendas da Lojinha CTP (manual)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={lojinha}
              onChange={(e) => setLojinha(Number(e.target.value) || 0)}
              className="ctp-input"
              style={{ width: '160px' }}
              placeholder="0,00"
            />
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() =>
                void exportXLSX(tickets, projetosComValor, pagamentosForaDoMesComValor, totais, lojinha, mesLabel)
              }
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
                  label="Valor total recebido"
                  value={formatarMoeda(totais.valorRecebido)}
                  icon={PiggyBank}
                  iconBg="#F0FDF4"
                  iconColor="#15803D"
                />
                <MetricCard
                  label="Valor total orçado"
                  value={formatarMoeda(totais.valorOrcado)}
                  icon={Wallet}
                  iconBg="#EFF6FF"
                  iconColor="#1D4ED8"
                />
                <MetricCard
                  label="Parcerias (valor = 0)"
                  value={totais.totalParcerias}
                  icon={HeartHandshake}
                  iconBg="#F5F3FF"
                  iconColor="#6D28D9"
                />
              </div>

              <div className="ctp-card flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Total geral recebido
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Valor total recebido + Vendas da Lojinha CTP
                  </p>
                </div>
                <p className="text-2xl font-bold" style={{ color: 'var(--ctp-navy)' }}>
                  {formatarMoeda(totalGeralRecebido)}
                </p>
              </div>

              <div className="ctp-card overflow-hidden">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Resumo por status</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Qtde</th>
                        <th className="px-4 py-3">Valor orçado no status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumoPorStatus.map((r) => {
                        const tone = STATUS_TONES[r.label]
                        return (
                          <tr key={r.label}>
                            <td className="px-4 py-3">
                              <span className="badge" style={{ background: tone.bg, color: tone.color }}>
                                {r.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{r.qtde}</td>
                            <td className="px-4 py-3 font-medium text-slate-800">{formatarMoeda(r.valor)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ctp-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Projetos de {mesLabel}
                  </p>
                  <span className="text-xs text-slate-500">
                    {projetosComValor.length} projeto(s)
                    {pagamentosForaDoMesComValor.length > 0 &&
                      ` · +${pagamentosForaDoMesComValor.length} pagamento(s) de outros meses`}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        {PROJ_COLS.map((c) => (
                          <th key={c} className="px-4 py-3">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {projetosComValor.map((t) => {
                        const status = getReportStatus(t)
                        const tone = STATUS_TONES[status]
                        const recebido = getValorRecebido(t)
                        return (
                          <tr key={t.id}>
                            <td className="px-4 py-3 text-slate-700">{formatarData(t.data_criacao)}</td>
                            <td className="px-4 py-3 text-slate-700">{t.solicitante_nome}</td>
                            <td className="px-4 py-3">
                              <Link to={`/demandas/${t.id}`} className="font-medium text-slate-800 hover:underline">
                                {t.titulo}
                              </Link>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-800">{formatarMoeda(getValor(t))}</td>
                            <td className="px-4 py-3">
                              <span className="badge" style={{ background: tone.bg, color: tone.color }}>
                                {status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{recebido > 0 ? formatarMoeda(recebido) : '—'}</td>
                          </tr>
                        )
                      })}
                      {projetosComValor.length === 0 && (
                        <tr>
                          <td colSpan={PROJ_COLS.length} className="px-4 py-8 text-center text-sm text-slate-500">
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
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Pagamentos recebidos de outros meses
                    </p>
                    <p className="text-xs text-slate-500">
                      Demandas criadas antes de {mesLabel.toLowerCase()}, mas com pagamento confirmado agora.
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">{pagamentosForaDoMesComValor.length} pagamento(s)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        {PROJ_COLS.map((c) => (
                          <th key={c} className="px-4 py-3">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagamentosForaDoMesComValor.map((t) => {
                        const status = getReportStatus(t)
                        const tone = STATUS_TONES[status]
                        const recebido = getValorRecebido(t)
                        return (
                          <tr key={t.id}>
                            <td className="px-4 py-3 text-slate-700">{formatarData(t.data_criacao)}</td>
                            <td className="px-4 py-3 text-slate-700">{t.solicitante_nome}</td>
                            <td className="px-4 py-3">
                              <Link to={`/demandas/${t.id}`} className="font-medium text-slate-800 hover:underline">
                                {t.titulo}
                              </Link>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-800">{formatarMoeda(getValor(t))}</td>
                            <td className="px-4 py-3">
                              <span className="badge" style={{ background: tone.bg, color: tone.color }}>
                                {status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{recebido > 0 ? formatarMoeda(recebido) : '—'}</td>
                          </tr>
                        )
                      })}
                      {pagamentosForaDoMesComValor.length === 0 && (
                        <tr>
                          <td colSpan={PROJ_COLS.length} className="px-4 py-8 text-center text-sm text-slate-500">
                            Nenhum pagamento de outro mês recebido em {mesLabel}.
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
                    Parcerias — projetos com valor R$ 0,00
                  </p>
                  <span className="text-xs text-slate-500">{parcerias.length} parceria(s)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Projeto/Produto</th>
                        <th className="px-4 py-3">Status Atual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parcerias.map((t) => (
                        <tr key={t.id}>
                          <td className="px-4 py-3 text-slate-700">{formatarData(t.data_criacao)}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{t.solicitante_nome}</td>
                          <td className="px-4 py-3 text-slate-700">{t.titulo}</td>
                          <td className="px-4 py-3 text-slate-700">{getReportStatus(t)}</td>
                        </tr>
                      ))}
                      {parcerias.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                            Nenhuma parceria neste mês.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Área usada só na impressão/PDF */}
              <div ref={printRef} className="hidden" aria-hidden>
                <h2>Projetos do mês</h2>
                <table>
                  <thead>
                    <tr>
                      {PROJ_COLS.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {projetosComValor.map((t) => (
                      <tr key={t.id}>
                        <td>{formatarData(t.data_criacao)}</td>
                        <td>{t.solicitante_nome}</td>
                        <td>{t.titulo}</td>
                        <td>{formatarMoeda(getValor(t))}</td>
                        <td>{getReportStatus(t)}</td>
                        <td>{getValorRecebido(t) > 0 ? formatarMoeda(getValorRecebido(t)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pagamentosForaDoMesComValor.length > 0 && (
                  <>
                    <h2>Pagamentos recebidos de outros meses</h2>
                    <table>
                      <thead>
                        <tr>
                          {PROJ_COLS.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagamentosForaDoMesComValor.map((t) => (
                          <tr key={t.id}>
                            <td>{formatarData(t.data_criacao)}</td>
                            <td>{t.solicitante_nome}</td>
                            <td>{t.titulo}</td>
                            <td>{formatarMoeda(getValor(t))}</td>
                            <td>{getReportStatus(t)}</td>
                            <td>{getValorRecebido(t) > 0 ? formatarMoeda(getValorRecebido(t)) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </>
          )
        )}
      </section>
    </LayoutShell>
  )
}
