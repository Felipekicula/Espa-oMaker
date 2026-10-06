import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReportsLayout } from '../components/ReportsLayout'
import type { Ticket, TicketCategoria, TicketTipo } from '../types/ticket'
import { listTickets } from '../services/tickets'
import { CATEGORIAS } from '../constants/ticketOptions'

function brl(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

type MoneyRow = { receita: number; custo: number; monetaria: number; contrapartida: number }

function diasNoMes(ano: number, mes1a12: number) {
  return new Date(ano, mes1a12, 0).getDate()
}

function countRecorrenciasNoPeriodo(t: Ticket, inicio: string, fim: string): number {
  if (
    !t.receita_recorrente ||
    t.tipo_receita === 'contrapartida' ||
    !t.receita_recorrente_inicio ||
    !t.receita_recorrente_dia_pagamento
  ) {
    return 0
  }
  const start = t.receita_recorrente_inicio
  const end = t.receita_recorrente_fim || fim
  const endCap = end < fim ? end : fim
  const startCap = start > inicio ? start : inicio
  if (endCap < startCap) return 0

  const [sy, sm] = startCap.split('-').map((x) => Number(x))
  const [ey, em] = endCap.split('-').map((x) => Number(x))
  if (!sy || !sm || !ey || !em) return 0

  const dia = Math.min(
    Math.max(1, Math.floor(Number(t.receita_recorrente_dia_pagamento))),
    31,
  )

  let count = 0
  let y = sy
  let m = sm
  while (y < ey || (y === ey && m <= em)) {
    const lastDay = diasNoMes(y, m)
    const d = Math.min(dia, lastDay)
    const due = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (due >= startCap && due <= endCap) count += 1
    m += 1
    if (m === 13) {
      m = 1
      y += 1
    }
  }
  return count
}

function getValorReceita(t: Ticket): number {
  return t.valor_demanda ?? t.orcamento?.total ?? 0
}

function getReceitaReconhecidaNoPeriodo(t: Ticket, inicio: string, fim: string): { monetaria: number; contrapartida: number } {
  const valor = getValorReceita(t)
  if (valor <= 0) return { monetaria: 0, contrapartida: 0 }

  // Contrapartida: considera reconhecida pela janela de criação (não temos data de "aprovação" no modelo)
  if (t.tipo_receita === 'contrapartida') {
    const created = (t.data_criacao ?? '').slice(0, 10)
    if (created && created >= inicio && created <= fim) return { monetaria: 0, contrapartida: valor }
    return { monetaria: 0, contrapartida: 0 }
  }

  // Monetária recorrente: reconhece todos os vencimentos dentro do período
  if (t.receita_recorrente) {
    const n = countRecorrenciasNoPeriodo(t, inicio, fim)
    return { monetaria: valor * n, contrapartida: 0 }
  }

  // Monetária não recorrente: só reconhece quando marcado como pago (pagamento_pago_em)
  const pago = t.pagamento_pago_em?.slice(0, 10) ?? ''
  if (pago && pago >= inicio && pago <= fim) return { monetaria: valor, contrapartida: 0 }
  return { monetaria: 0, contrapartida: 0 }
}

function addRow(a: MoneyRow, b: MoneyRow): MoneyRow {
  return {
    receita: a.receita + b.receita,
    custo: a.custo + b.custo,
    monetaria: a.monetaria + b.monetaria,
    contrapartida: a.contrapartida + b.contrapartida,
  }
}

function rowFromTicket(t: Ticket, inicio: string, fim: string): MoneyRow {
  const { monetaria, contrapartida } = getReceitaReconhecidaNoPeriodo(t, inicio, fim)
  const receita = monetaria + contrapartida
  const custo = t.custo ?? 0
  return { receita, custo, monetaria, contrapartida }
}

function labelCategoria(c: TicketCategoria): string {
  return CATEGORIAS.find((x) => x.value === c)?.label ?? c
}

export function FinancialReportsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  const hoje = new Date().toISOString().slice(0, 10)
  const inicioEfetivo = dataInicio || '2000-01-01'
  const fimEfetivo = dataFim || hoje

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const filters: Parameters<typeof listTickets>[0] = {}
      if (dataInicio) filters.dataCriacaoInicial = dataInicio
      if (dataFim) filters.dataCriacaoFinal = dataFim
      const { tickets: list } = await listTickets(filters, { limit: 5000 })
      setTickets(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar relatório financeiro.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const base = useMemo(() => {
    // Financeiro considera só o que está aprovado ou após (evita contar recebidas/canceladas)
    const statusAprovadoOuApos = new Set([
      'aprovado',
      'em_producao',
      'pos_processo',
      'pronta',
      'entregue',
    ])
    return tickets.filter((t) => statusAprovadoOuApos.has(t.status))
  }, [tickets])

  const totals = useMemo(() => {
    const zero: MoneyRow = { receita: 0, custo: 0, monetaria: 0, contrapartida: 0 }
    return base.reduce((acc, t) => addRow(acc, rowFromTicket(t, inicioEfetivo, fimEfetivo)), zero)
  }, [base, inicioEfetivo, fimEfetivo])

  const porTipo = useMemo(() => {
    const map = new Map<TicketTipo, MoneyRow>()
    for (const t of base) {
      const key = t.tipo
      const cur = map.get(key) ?? { receita: 0, custo: 0, monetaria: 0, contrapartida: 0 }
      map.set(key, addRow(cur, rowFromTicket(t, inicioEfetivo, fimEfetivo)))
    }
    return Array.from(map.entries())
      .map(([tipo, row]) => ({ tipo, ...row, resultado: row.monetaria - row.custo }))
      .sort((a, b) => b.resultado - a.resultado)
  }, [base, inicioEfetivo, fimEfetivo])

  const porCategoria = useMemo(() => {
    const map = new Map<TicketCategoria, MoneyRow>()
    for (const t of base) {
      const key = t.categoria
      const cur = map.get(key) ?? { receita: 0, custo: 0, monetaria: 0, contrapartida: 0 }
      map.set(key, addRow(cur, rowFromTicket(t, inicioEfetivo, fimEfetivo)))
    }
    return Array.from(map.entries())
      .map(([categoria, row]) => ({ categoria, ...row, resultado: row.monetaria - row.custo }))
      .sort((a, b) => b.resultado - a.resultado)
  }, [base, inicioEfetivo, fimEfetivo])

  const topDemandas = useMemo(() => {
    return base
      .map((t) => {
        const row = rowFromTicket(t, inicioEfetivo, fimEfetivo)
        return {
          id: t.id,
          titulo: t.titulo,
          solicitante: t.solicitante_nome,
          tipo: t.tipo,
          categoria: t.categoria,
          monetaria: row.monetaria,
          contrapartida: row.contrapartida,
          custo: row.custo,
          resultado: row.monetaria - row.custo,
        }
      })
      .filter((x) => x.monetaria !== 0 || x.contrapartida !== 0 || x.custo !== 0)
      .sort((a, b) => b.resultado - a.resultado)
      .slice(0, 12)
  }, [base, inicioEfetivo, fimEfetivo])

  return (
    <ReportsLayout>
      <section className="space-y-6">
        <header className="page-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1>Relatório financeiro</h1>
            <p>
              Visão completa de receitas, custos e resultados. Receita monetária só contabiliza quando <strong>paga</strong> ou quando configurada como <strong>recorrente</strong>.
            </p>
          </div>
          <Link to="/relatorios" className="text-sm font-semibold" style={{ color: 'var(--ctp-navy)' }}>
            Ver indicadores gerais →
          </Link>
        </header>

        <div className="ctp-card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="ctp-label">Início</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="ctp-input"
              style={{ width: 'auto' }}
            />
          </div>
          <div>
            <label className="ctp-label">Fim</label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="ctp-input"
              style={{ width: 'auto' }}
            />
          </div>
          <button type="button" onClick={() => void load()} className="btn btn-primary">
            Aplicar
          </button>
          <button
            type="button"
            onClick={() => {
              setDataInicio('')
              setDataFim('')
              setTimeout(() => void load(), 0)
            }}
            className="btn btn-outline"
          >
            Limpar
          </button>
          <div className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            Período: <span className="font-medium text-slate-700">{inicioEfetivo}</span> a{' '}
            <span className="font-medium text-slate-700">{fimEfetivo}</span>
          </div>
        </div>

        {loading && (
          <div className="ctp-card px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Calculando financeiro...
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card label="Receita monetária (reconhecida)" value={brl(totals.monetaria)} tone="emerald" />
              <Card label="Receita contrapartida" value={brl(totals.contrapartida)} tone="sky" />
              <Card label="Receita total" value={brl(totals.receita)} tone="indigo" />
              <Card label="Custos" value={brl(totals.custo)} tone="rose" />
              <Card label="Resultado (monetária - custo)" value={brl(totals.monetaria - totals.custo)} tone="slate" />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="ctp-card overflow-hidden">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Por tipo de demanda</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Receita monetária</th>
                        <th className="px-4 py-3">Contrapartida</th>
                        <th className="px-4 py-3">Custos</th>
                        <th className="px-4 py-3">Resultado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {porTipo.map((r) => (
                        <tr key={r.tipo}>
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {r.tipo === 'externa' ? 'Externa' : 'Interna'}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{brl(r.monetaria)}</td>
                          <td className="px-4 py-3 text-slate-700">{brl(r.contrapartida)}</td>
                          <td className="px-4 py-3 text-slate-700">{brl(r.custo)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{brl(r.resultado)}</td>
                        </tr>
                      ))}
                      {porTipo.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                            Sem dados no período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ctp-card overflow-hidden">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Por categoria</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="ctp-table w-full">
                    <thead>
                      <tr>
                        <th className="px-4 py-3">Categoria</th>
                        <th className="px-4 py-3">Receita monetária</th>
                        <th className="px-4 py-3">Contrapartida</th>
                        <th className="px-4 py-3">Custos</th>
                        <th className="px-4 py-3">Resultado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {porCategoria.map((r) => (
                        <tr key={r.categoria}>
                          <td className="px-4 py-3 font-medium text-slate-800">{labelCategoria(r.categoria)}</td>
                          <td className="px-4 py-3 text-slate-700">{brl(r.monetaria)}</td>
                          <td className="px-4 py-3 text-slate-700">{brl(r.contrapartida)}</td>
                          <td className="px-4 py-3 text-slate-700">{brl(r.custo)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{brl(r.resultado)}</td>
                        </tr>
                      ))}
                      {porCategoria.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                            Sem dados no período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="ctp-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Top demandas por resultado</p>
                <span className="text-xs text-slate-500">Resultado = monetária reconhecida − custo</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 py-3">Demanda</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Categoria</th>
                      <th className="px-4 py-3">Monetária</th>
                      <th className="px-4 py-3">Contrapartida</th>
                      <th className="px-4 py-3">Custos</th>
                      <th className="px-4 py-3">Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {topDemandas.map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          <Link to={`/demandas/${d.id}`} className="hover:underline">
                            {d.titulo}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{d.solicitante}</td>
                        <td className="px-4 py-3 text-slate-700">{d.tipo === 'externa' ? 'Externa' : 'Interna'}</td>
                        <td className="px-4 py-3 text-slate-700">{labelCategoria(d.categoria)}</td>
                        <td className="px-4 py-3 text-slate-700">{brl(d.monetaria)}</td>
                        <td className="px-4 py-3 text-slate-700">{brl(d.contrapartida)}</td>
                        <td className="px-4 py-3 text-slate-700">{brl(d.custo)}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{brl(d.resultado)}</td>
                      </tr>
                    ))}
                    {topDemandas.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                          Sem dados no período.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
    </ReportsLayout>
  )
}

function Card({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'emerald' | 'sky' | 'indigo' | 'rose' | 'slate'
}) {
  const tones: Record<typeof tone, string> = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
  }
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

