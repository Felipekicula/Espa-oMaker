/**
 * Calculadora de Orçamento — Impressão 3D / Fabricação
 * Fórmulas fiéis à "Planilha de Orçamentos Ver.01".
 * Materiais e impressoras vêm do Supabase (Config. da Calculadora).
 */
import { useEffect, useMemo, useState } from 'react'
import { Settings2, Info, ChevronDown, ChevronUp, Download, Link as LinkIcon, Inbox, Check } from 'lucide-react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { LayoutShell } from '../components/LayoutShell'
import { formatarMoeda } from '../utils/formatters'
import { listMateriais, listImpressoras, type Material, type Impressora } from '../services/calculadora'
import { listTickets, vincularOrcamentoAoPedido } from '../services/tickets'
import type { Ticket } from '../types/ticket'

/** Status da caixa de entrada que ainda podem receber/atualizar um orçamento. */
const PEDIDOS_INBOX_STATUSES: Ticket['status'][] = [
  'recebida',
  'orcamento_em_criacao',
  'aguardando_aprovacao',
  'enviado_cliente',
]

const FATORES = [
  { key: 'organico', label: 'Fator Orgânico', valor: 0.1, badge: '+10%', desc: 'Peças com geometria orgânica complexa' },
  { key: 'mecanico', label: 'Fator Mecânico', valor: 0.2, badge: '+20%', desc: 'Peças mecânicas com encaixes e tolerâncias' },
  { key: 'prospeccao', label: 'Fator Prospecção', valor: -0.1, badge: '-10%', desc: 'Desconto para prospecção e fidelização' },
]

interface Inputs {
  valorHomemHora: number
  custoKWh: number
  tempoSetup: number
  tempoImpressao: number
  gramsMaterial: number
  impressora: string
  material: string
  tempoPos: number
  pctConsumiveis: number
  pctFalha: number
  adicionalFixo: number
  descAdicional: string
  pctMargemLucro: number
  pctImpostos: number
  pctCustosFixos: number
  fatores: Record<string, boolean>
  quantidadePecas: number
}

const DEFAULTS: Inputs = {
  valorHomemHora: 63.75,
  custoKWh: 0.62,
  tempoSetup: 0.1,
  tempoImpressao: 1.0,
  gramsMaterial: 15.0,
  impressora: 'Industrial',
  material: 'PLA',
  tempoPos: 0.1,
  pctConsumiveis: 0.0,
  pctFalha: 5.0,
  adicionalFixo: 0.0,
  descAdicional: '',
  pctMargemLucro: 20.0,
  pctImpostos: 6.0,
  pctCustosFixos: 2.0,
  fatores: { organico: false, mecanico: false, prospeccao: false },
  quantidadePecas: 1,
}

function calcular(
  inp: Inputs,
  materiaisMap: Record<string, number>,
  impressorasMap: Record<string, { manutH: number; potW: number }>,
) {
  const imp = impressorasMap[inp.impressora] ?? Object.values(impressorasMap)[0] ?? { manutH: 1.2, potW: 300 }
  const kgPrice = materiaisMap[inp.material] ?? 130

  const custoSetup = inp.tempoSetup * inp.valorHomemHora
  const custoEnergia = inp.tempoImpressao * (imp.potW / 1000) * inp.custoKWh
  const custoManutencao = inp.tempoImpressao * imp.manutH
  const custoMaterial = (inp.gramsMaterial / 1000) * kgPrice
  const custoPos = inp.tempoPos * inp.valorHomemHora

  const subtotalDireto = custoSetup + custoEnergia + custoManutencao + custoMaterial + custoPos
  const custoConsumiveis = inp.adicionalFixo + (custoMaterial + custoPos) * (inp.pctConsumiveis / 100)
  const custoFalha = subtotalDireto * (inp.pctFalha / 100)
  const custoTotalProducao = subtotalDireto + custoConsumiveis + custoFalha

  const markupDivisor = 1 - (inp.pctMargemLucro + inp.pctImpostos + inp.pctCustosFixos) / 100
  const somaFatores = FATORES.reduce((acc, f) => acc + (inp.fatores[f.key] ? f.valor : 0), 0)
  const precoFinal = markupDivisor > 0 ? (custoTotalProducao / markupDivisor) * (1 + somaFatores) : 0
  const qt = Math.max(1, inp.quantidadePecas)
  const precoUnitario = precoFinal / qt

  return {
    custoSetup, custoEnergia, custoManutencao, custoMaterial, custoPos,
    subtotalDireto, custoConsumiveis, custoFalha, custoTotalProducao,
    markupDivisor, somaFatores, precoFinal, precoUnitario,
  }
}

export function OrcamentoCalculadoraPage() {
  const [materiais, setMateriais] = useState<Material[]>([])
  const [impressoras, setImpressoras] = useState<Impressora[]>([])
  const [carregado, setCarregado] = useState(false)
  const [inp, setInp] = useState<Inputs>({ ...DEFAULTS, fatores: { ...DEFAULTS.fatores } })
  const [configAberta, setConfigAberta] = useState(false)
  const [gerando, setGerando] = useState(false)

  // --- Vínculo com pedido da caixa de entrada ---
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [pedidos, setPedidos] = useState<Ticket[]>([])
  const [pedidoId, setPedidoId] = useState<string>(searchParams.get('pedido') ?? '')
  const [vinculando, setVinculando] = useState(false)
  const [vinculoOk, setVinculoOk] = useState<string | null>(null)
  const [vinculoErro, setVinculoErro] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listMateriais(), listImpressoras()])
      .then(([m, i]) => {
        setMateriais(m)
        setImpressoras(i)
        setInp((prev) => ({
          ...prev,
          material: m.some((x) => x.nome === prev.material) ? prev.material : m[0]?.nome ?? prev.material,
          impressora: i.some((x) => x.nome === prev.impressora) ? prev.impressora : i[0]?.nome ?? prev.impressora,
        }))
      })
      .catch(() => {})
      .finally(() => setCarregado(true))
  }, [])

  useEffect(() => {
    listTickets({ statusIn: PEDIDOS_INBOX_STATUSES }, { limit: 500 })
      .then((r) => setPedidos(r.tickets))
      .catch(() => {})
  }, [])

  const pedidoSelecionado = useMemo(
    () => pedidos.find((p) => p.id === pedidoId) ?? null,
    [pedidos, pedidoId],
  )

  const materiaisMap = useMemo(() => Object.fromEntries(materiais.map((m) => [m.nome, m.precoPorKg])), [materiais])
  const impressorasMap = useMemo(
    () => Object.fromEntries(impressoras.map((i) => [i.nome, { manutH: i.manutH, potW: i.potW }])),
    [impressoras],
  )

  const calc = useMemo(() => calcular(inp, materiaisMap, impressorasMap), [inp, materiaisMap, impressorasMap])

  const upd = <K extends keyof Inputs>(k: K, v: Inputs[K]) => setInp((prev) => ({ ...prev, [k]: v }))
  const toggleFator = (key: string) =>
    setInp((prev) => ({ ...prev, fatores: { ...prev.fatores, [key]: !prev.fatores[key] } }))

  const vincularAoPedido = async () => {
    if (!pedidoSelecionado || calc.precoFinal < 0) return
    setVinculando(true)
    setVinculoOk(null)
    setVinculoErro(null)
    try {
      await vincularOrcamentoAoPedido(
        pedidoSelecionado.id,
        {
          preco_por_peca: Number(calc.precoUnitario.toFixed(2)),
          quantidade_orcamento: Math.max(1, inp.quantidadePecas),
          total_orcamento: Number(calc.precoFinal.toFixed(2)),
          observacoes_orcamento: inp.descAdicional || null,
          avancarFase: true,
        },
        pedidoSelecionado.status,
      )
      setVinculoOk(
        `Orçamento de ${formatarMoeda(calc.precoFinal)} vinculado ao pedido "${pedidoSelecionado.titulo}".`,
      )
      // Remove o pedido da lista (já tem orçamento; fase avançou).
      setPedidos((prev) => prev.filter((p) => p.id !== pedidoSelecionado.id))
      setPedidoId('')
    } catch (err) {
      setVinculoErro(
        err instanceof Error ? err.message : 'Erro ao vincular orçamento ao pedido.',
      )
    } finally {
      setVinculando(false)
    }
  }

  const baixarPDF = async () => {
    setGerando(true)
    const wrapper = document.createElement('div')
    try {
      const { default: html2pdf } = await import('html2pdf.js')
      const imp = impressorasMap[inp.impressora] ?? { manutH: 0, potW: 0 }
      const fatoresAtivos = FATORES.filter((f) => inp.fatores[f.key])
      const dataGeracao = new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' })
      const nomeArquivo = `orcamento-${new Date().toISOString().slice(0, 10)}.pdf`

      const row = (label: string, val: string, alt = false) => `
        <tr style="background:${alt ? '#f9fafb' : '#fff'}">
          <td style="padding:5px 9px;font-size:10px;color:#374151;border-bottom:1px solid #f0f0f0">${label}</td>
          <td style="padding:5px 9px;font-size:10px;font-weight:700;text-align:right;white-space:nowrap;border-bottom:1px solid #f0f0f0;color:#111">${val}</td>
        </tr>`
      const sec = (title: string) => `
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#063A70;padding:5px 0 4px;border-bottom:2px solid #A1F01F;margin-bottom:7px">${title}</div>`

      const costsRows = [
        { d: `Setup e Design (${inp.tempoSetup}h × R$${inp.valorHomemHora}/h)`, v: formatarMoeda(calc.custoSetup) },
        { d: `Energia — ${inp.impressora} (${imp.potW}W × ${inp.tempoImpressao}h × R$${inp.custoKWh})`, v: formatarMoeda(calc.custoEnergia) },
        { d: `Manutenção — ${inp.impressora} (${inp.tempoImpressao}h × R$${imp.manutH}/h)`, v: formatarMoeda(calc.custoManutencao) },
        { d: `Material — ${inp.material} (${inp.gramsMaterial}g × R$${materiaisMap[inp.material] ?? 0}/kg)`, v: formatarMoeda(calc.custoMaterial) },
        { d: `Pós-Processamento (${inp.tempoPos}h × R$${inp.valorHomemHora}/h)`, v: formatarMoeda(calc.custoPos) },
        ...(calc.custoConsumiveis > 0 ? [{ d: `Consumíveis${inp.descAdicional ? ` — ${inp.descAdicional}` : ''}`, v: formatarMoeda(calc.custoConsumiveis) }] : []),
        { d: `Taxa de Falha (${inp.pctFalha}% × subtotal direto)`, v: formatarMoeda(calc.custoFalha) },
      ].map((r, i) => row(r.d, r.v, i % 2 !== 0)).join('')

      const fatoresRows = fatoresAtivos.length > 0
        ? fatoresAtivos.map((f, i) => row(`${f.label}`, f.badge, i % 2 !== 0)).join('')
        : `<tr><td colspan="2" style="padding:5px 9px;font-size:10px;color:#9ca3af;font-style:italic">Nenhum fator ativo</td></tr>`

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#fff;width:794px;box-sizing:border-box">
          <div style="background:#063A70;padding:18px 28px 14px;display:flex;justify-content:space-between;align-items:flex-end">
            <div>
              <div style="font-size:8px;color:rgba(255,255,255,0.5);letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">Cilla Tech Park — Espaço Maker</div>
              <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px;line-height:1">Orçamento Técnico</div>
              <div style="font-size:8.5px;color:rgba(255,255,255,0.45);margin-top:4px">Planilha de Orçamentos Ver.01</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:8px;color:rgba(255,255,255,0.35);margin-top:3px">${dataGeracao}</div>
            </div>
          </div>
          <div style="display:flex;gap:0;padding:16px 20px 12px">
            <div style="flex:1;padding-right:14px;border-right:1px solid #e5e7eb;display:flex;flex-direction:column;gap:14px">
              <div>
                ${sec('Parâmetros Técnicos')}
                <table style="width:100%;border-collapse:collapse"><tbody>
                  <tr><td style="padding:3px 0;font-size:9px;color:#9ca3af;width:42%">Impressora / Máquina</td><td style="padding:3px 0;font-size:10px;font-weight:600">${inp.impressora} · ${imp.potW}W · R$${imp.manutH}/h</td></tr>
                  <tr><td style="padding:3px 0;font-size:9px;color:#9ca3af">Material</td><td style="padding:3px 0;font-size:10px;font-weight:600">${inp.material} — R$${materiaisMap[inp.material] ?? 0}/kg</td></tr>
                  <tr><td style="padding:3px 0;font-size:9px;color:#9ca3af">Tempo de Setup</td><td style="padding:3px 0;font-size:10px;font-weight:600">${inp.tempoSetup}h</td></tr>
                  <tr><td style="padding:3px 0;font-size:9px;color:#9ca3af">Tempo de Impressão</td><td style="padding:3px 0;font-size:10px;font-weight:600">${inp.tempoImpressao}h</td></tr>
                  <tr><td style="padding:3px 0;font-size:9px;color:#9ca3af">Material Usado</td><td style="padding:3px 0;font-size:10px;font-weight:600">${inp.gramsMaterial}g</td></tr>
                  <tr><td style="padding:3px 0;font-size:9px;color:#9ca3af">Pós-Processamento</td><td style="padding:3px 0;font-size:10px;font-weight:600">${inp.tempoPos}h</td></tr>
                  <tr><td style="padding:3px 0;font-size:9px;color:#9ca3af">Quantidade de Peças</td><td style="padding:3px 0;font-size:10px;font-weight:600">${inp.quantidadePecas} peça(s)</td></tr>
                </tbody></table>
              </div>
              <div>
                ${sec('Breakdown de Custos de Produção')}
                <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb">
                  <thead><tr style="background:#f3f4f6">
                    <th style="padding:5px 9px;font-size:8px;text-align:left;color:#6b7280;font-weight:700;text-transform:uppercase">Descrição</th>
                    <th style="padding:5px 9px;font-size:8px;text-align:right;color:#6b7280;font-weight:700;text-transform:uppercase">Valor</th>
                  </tr></thead>
                  <tbody>
                    ${costsRows}
                    <tr style="background:#dbeafe"><td style="padding:6px 9px;font-size:10px;font-weight:700;color:#1e3a8a">Subtotal Direto</td><td style="padding:6px 9px;font-size:10px;font-weight:700;text-align:right;color:#1e3a8a;white-space:nowrap">${formatarMoeda(calc.subtotalDireto)}</td></tr>
                    <tr style="background:#bfdbfe"><td style="padding:7px 9px;font-size:11px;font-weight:800;color:#063A70">CUSTO TOTAL DE PRODUÇÃO</td><td style="padding:7px 9px;font-size:11px;font-weight:800;text-align:right;color:#063A70;white-space:nowrap">${formatarMoeda(calc.custoTotalProducao)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div style="width:270px;padding-left:14px;display:flex;flex-direction:column;gap:14px">
              <div>
                ${sec('Precificação e Margens')}
                <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb"><tbody>
                  ${row('Margem de Lucro', `${inp.pctMargemLucro}%`)}
                  ${row('Impostos', `${inp.pctImpostos}%`, true)}
                  ${row('Custos Fixos', `${inp.pctCustosFixos}%`)}
                  ${row('Taxa de Falha', `${inp.pctFalha}% s/ subtotal`, true)}
                  <tr style="background:#f0f9ff"><td style="padding:6px 9px;font-size:10px;font-weight:700;color:#063A70">Markup Divisor</td><td style="padding:6px 9px;font-size:11px;font-weight:800;text-align:right;color:${calc.markupDivisor < 0.3 ? '#dc2626' : '#063A70'}">${(calc.markupDivisor * 100).toFixed(1)}%</td></tr>
                </tbody></table>
              </div>
              <div>
                ${sec('Fatores de Ajuste')}
                <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb"><tbody>
                  ${fatoresRows}
                  <tr style="background:#f0fdf4"><td style="padding:6px 9px;font-size:10px;font-weight:700;color:#15803d">Soma dos Fatores</td><td style="padding:6px 9px;font-size:11px;font-weight:800;text-align:right;color:${calc.somaFatores >= 0 ? '#15803d' : '#dc2626'}">${calc.somaFatores >= 0 ? '+' : ''}${(calc.somaFatores * 100).toFixed(0)}%</td></tr>
                </tbody></table>
              </div>
            </div>
          </div>
          <div style="background:#063A70;padding:16px 20px">
            <div style="display:flex;gap:12px;align-items:stretch">
              <div style="flex:1;background:rgba(255,255,255,0.07);border-radius:8px;padding:12px 16px;border:1px solid rgba(255,255,255,0.12)">
                <div style="font-size:7.5px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:5px">Custo Total de Produção</div>
                <div style="font-size:20px;font-weight:800;color:rgba(255,255,255,0.8);line-height:1">${formatarMoeda(calc.custoTotalProducao)}</div>
              </div>
              <div style="flex:1.4;background:rgba(161,240,31,0.13);border:2px solid #A1F01F;border-radius:10px;padding:12px 18px">
                <div style="font-size:7.5px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:5px">PREÇO DE VENDA FINAL</div>
                <div style="font-size:30px;font-weight:900;color:#A1F01F;letter-spacing:-1px;line-height:1">${formatarMoeda(calc.precoFinal)}</div>
                <div style="font-size:8.5px;color:rgba(255,255,255,0.4);margin-top:5px">${inp.quantidadePecas} peça(s) · margem ${inp.pctMargemLucro}% · impostos ${inp.pctImpostos}%</div>
              </div>
              <div style="flex:1;background:rgba(255,255,255,0.07);border-radius:8px;padding:12px 16px;border:1px solid rgba(255,255,255,0.12)">
                <div style="font-size:7.5px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:5px">Preço por Unidade</div>
                <div style="font-size:20px;font-weight:900;color:#fff;line-height:1">${formatarMoeda(calc.precoUnitario)}</div>
              </div>
            </div>
          </div>
          <div style="padding:7px 20px;background:#f3f4f6;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:7.5px;color:#9ca3af">Cilla Tech Park — Espaço Maker</span>
            <span style="font-size:7.5px;color:#9ca3af">Valores calculados com base na Planilha de Orçamentos Ver.01 · Sujeito a alteração</span>
          </div>
        </div>`

      wrapper.innerHTML = html
      await html2pdf()
        .set({
          margin: 0,
          filename: nomeArquivo,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(wrapper.firstElementChild as HTMLElement)
        .save()
    } finally {
      setGerando(false)
    }
  }

  const NInput = ({ campo, label, suffix, prefix, step = 0.1, min = 0, hint }: {
    campo: keyof Inputs; label: string; suffix?: string; prefix?: string; step?: number; min?: number; hint?: string
  }) => (
    <div>
      <label style={LS}>{label}</label>
      <div style={{ position: 'relative' }}>
        {prefix && <span style={PFXS}>{prefix}</span>}
        <input
          type="number" step={step} min={min}
          className="ctp-input"
          style={{ paddingLeft: prefix ? '30px' : undefined, paddingRight: suffix ? '36px' : undefined, fontSize: '13px' }}
          value={inp[campo] as number}
          onChange={(e) => upd(campo, Number(e.target.value) as never)}
        />
        {suffix && <span style={SFXS}>{suffix}</span>}
      </div>
      {hint && <p style={HNTS}>{hint}</p>}
    </div>
  )

  const CRow = ({ label, valor, bold, topBorder }: { label: string; valor: number; bold?: boolean; topBorder?: boolean }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderTop: topBorder ? '1.5px solid var(--border-default)' : undefined, marginTop: topBorder ? '6px' : undefined, paddingTop: topBorder ? '8px' : undefined }}>
      <span style={{ fontSize: '11.5px', color: bold ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: bold ? 700 : 400, flex: 1, lineHeight: 1.3 }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: bold ? 800 : 600, color: bold ? 'var(--ctp-navy)' : 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: '8px' }}>
        {formatarMoeda(valor)}
      </span>
    </div>
  )

  const StepHead = ({ n, label, color }: { n: string; label: string; color: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'white' }}>{n}</span>
      </div>
      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
    </div>
  )

  const semConfig = carregado && (materiais.length === 0 || impressoras.length === 0)

  return (
    <LayoutShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1>Calculadora de orçamento</h1>
            <p>Precificação de impressão 3D / fabricação — Planilha Ver.01</p>
          </div>
          <Link to="/configuracoes-calculadora" className="btn btn-outline btn-sm" style={{ gap: '6px', flexShrink: 0 }}>
            <Settings2 size={13} /> Materiais e máquinas
          </Link>
        </div>

        {semConfig && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Cadastre materiais e impressoras em{' '}
            <Link to="/configuracoes-calculadora" className="font-semibold underline">
              Config. da Calculadora
            </Link>{' '}
            para resultados precisos.
          </div>
        )}

        {/* Vínculo com pedido da caixa de entrada */}
        <div className="ctp-card" style={{ padding: '1rem 1.125rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Inbox size={15} color="var(--ctp-navy)" />
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Vincular a um pedido da caixa de entrada
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.75rem' }}>
            <div style={{ flex: '1 1 320px', minWidth: '240px' }}>
              <label style={LS}>Pedido</label>
              <select
                className="ctp-input"
                style={{ fontSize: '13px' }}
                value={pedidoId}
                onChange={(e) => {
                  setPedidoId(e.target.value)
                  setVinculoOk(null)
                  setVinculoErro(null)
                }}
              >
                <option value="">Nenhum (orçamento avulso)</option>
                {pedidos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.titulo} — {p.solicitante_nome}
                    {p.orcamento ? ` (orçamento atual ${formatarMoeda(p.orcamento.total)})` : ''}
                  </option>
                ))}
              </select>
              <p style={HNTS}>
                Ao vincular, o orçamento calculado é gravado no pedido e a fase avança
                para “Esperando aprovação (Pedro)”.
              </p>
            </div>
            <button
              type="button"
              onClick={vincularAoPedido}
              disabled={!pedidoId || vinculando || calc.precoFinal < 0}
              className="btn btn-primary"
              style={{ gap: '6px', flexShrink: 0 }}
            >
              <LinkIcon size={14} />
              {vinculando ? 'Vinculando…' : 'Vincular orçamento ao pedido'}
            </button>
          </div>
          {pedidoSelecionado && (
            <button
              type="button"
              onClick={() => navigate(`/demandas/${pedidoSelecionado.id}`)}
              className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold"
              style={{ color: 'var(--ctp-navy)' }}
            >
              Abrir pedido “{pedidoSelecionado.titulo}”
            </button>
          )}
          {vinculoOk && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
              <Check size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{vinculoOk}</span>
            </div>
          )}
          {vinculoErro && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
              {vinculoErro}
            </div>
          )}
        </div>

        <div className="ctp-card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', minHeight: 0, flexWrap: 'wrap' }}>
            {/* LEFT: inputs */}
            <div style={{ flex: '1 1 420px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', borderRight: '1px solid var(--border-default)' }}>
              <div style={{ border: '1px solid var(--border-default)', borderRadius: '10px', overflow: 'hidden' }}>
                <button
                  onClick={() => setConfigAberta((o) => !o)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-muted)', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Settings2 size={12} color="var(--text-muted)" />
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Configurações Gerais
                    </span>
                  </div>
                  {configAberta ? <ChevronUp size={12} color="var(--text-muted)" /> : <ChevronDown size={12} color="var(--text-muted)" />}
                </button>
                {configAberta && (
                  <div style={{ padding: '0.875rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', background: 'var(--bg-card)' }}>
                    <NInput campo="valorHomemHora" label="Homem/Hora" prefix="R$" step={0.25} hint="Padrão: R$ 63,75/h" />
                    <NInput campo="custoKWh" label="Custo Energia (kWh)" prefix="R$" step={0.01} hint="Padrão: R$ 0,62/kWh" />
                  </div>
                )}
              </div>

              <div className="ctp-card" style={{ padding: '1rem' }}>
                <StepHead n="1" label="Setup e Design" color="#3B82F6" />
                <NInput campo="tempoSetup" label="Tempo de Setup" suffix="h" step={0.05} hint={`= ${formatarMoeda(calc.custoSetup)} mão de obra`} />
              </div>

              <div className="ctp-card" style={{ padding: '1rem' }}>
                <StepHead n="2" label="Impressão" color="#F97316" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <NInput campo="tempoImpressao" label="Tempo de Impressão" suffix="h" step={0.5} />
                  <NInput campo="gramsMaterial" label="Material Usado" suffix="g" step={1} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
                  <div>
                    <label style={LS}>Impressora Usada</label>
                    <select className="ctp-input" style={{ fontSize: '13px' }} value={inp.impressora} onChange={(e) => upd('impressora', e.target.value)}>
                      {impressoras.map((i) => (
                        <option key={i.id} value={i.nome}>{i.nome}</option>
                      ))}
                    </select>
                    <p style={HNTS}>{impressorasMap[inp.impressora]?.potW ?? 0}W · R$ {impressorasMap[inp.impressora]?.manutH ?? 0}/h manutenção</p>
                  </div>
                  <div>
                    <label style={LS}>Material</label>
                    <select className="ctp-input" style={{ fontSize: '13px' }} value={inp.material} onChange={(e) => upd('material', e.target.value)}>
                      {materiais.map((m) => (
                        <option key={m.id} value={m.nome}>{m.nome} — R$ {m.precoPorKg}/kg</option>
                      ))}
                    </select>
                    <p style={HNTS}>R$ {materiaisMap[inp.material] ?? 0}/kg → R$ {((materiaisMap[inp.material] ?? 0) / 1000).toFixed(3)}/g</p>
                  </div>
                </div>
              </div>

              <div className="ctp-card" style={{ padding: '1rem' }}>
                <StepHead n="3" label="Pós-Processamento" color="#8B5CF6" />
                <NInput campo="tempoPos" label="Tempo de Pós-Processamento" suffix="h" step={0.05} hint={`= ${formatarMoeda(calc.custoPos)} mão de obra`} />
              </div>

              <div className="ctp-card" style={{ padding: '1rem' }}>
                <StepHead n="⚡" label="Custos Indiretos" color="#EF4444" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <NInput campo="pctConsumiveis" label="Consumíveis %" suffix="%" step={1} hint="Sobre material + pós-proc." />
                  <NInput campo="pctFalha" label="Taxa de Falha %" suffix="%" step={1} hint="Sobre subtotal direto" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.625rem', marginTop: '0.75rem', alignItems: 'end' }}>
                  <NInput campo="adicionalFixo" label="Adicional Fixo" prefix="R$" step={1} />
                  <div>
                    <label style={LS}>Descrição do Adicional</label>
                    <input className="ctp-input" style={{ fontSize: '13px' }} placeholder="Ex: Kit chaveiro, suporte…" value={inp.descAdicional} onChange={(e) => upd('descAdicional', e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="ctp-card" style={{ padding: '1rem' }}>
                <StepHead n="%" label="Precificação" color="#22C55E" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <NInput campo="pctMargemLucro" label="Margem Lucro %" suffix="%" step={1} />
                  <NInput campo="pctImpostos" label="Impostos %" suffix="%" step={0.5} />
                  <NInput campo="pctCustosFixos" label="Custos Fixos %" suffix="%" step={0.5} />
                </div>
                <div style={{ marginTop: '0.75rem', padding: '8px 10px', background: 'var(--bg-muted)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Markup Divisor (1 − soma%)</span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: calc.markupDivisor < 0.3 ? '#EF4444' : 'var(--ctp-navy)' }}>
                    {(calc.markupDivisor * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ marginTop: '0.875rem' }}>
                  <label style={{ ...LS, marginBottom: '8px', display: 'block' }}>Fatores de Ajuste</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {FATORES.map((f) => {
                      const ativo = inp.fatores[f.key]
                      const positivo = f.valor > 0
                      return (
                        <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 11px', borderRadius: '8px', cursor: 'pointer', border: `1.5px solid ${ativo ? (positivo ? '#22C55E' : '#EF4444') : 'var(--border-default)'}`, background: ativo ? (positivo ? '#F0FDF4' : '#FEF2F2') : 'var(--bg-muted)', transition: 'all 0.15s' }}>
                          <input type="checkbox" checked={ativo} onChange={() => toggleFator(f.key)} style={{ accentColor: positivo ? '#22C55E' : '#EF4444', width: '15px', height: '15px', flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>{f.label}</p>
                            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{f.desc}</p>
                          </div>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: positivo ? '#16A34A' : '#DC2626', background: positivo ? '#DCFCE7' : '#FEE2E2', padding: '2px 8px', borderRadius: '99px' }}>{f.badge}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="ctp-card" style={{ padding: '1rem' }}>
                <NInput campo="quantidadePecas" label="Quantidade Total de Peças" step={1} min={1} hint="Divide o preço final para obter o valor unitário" />
              </div>
            </div>

            {/* RIGHT: resultados */}
            <div style={{ flex: '1 1 272px', minWidth: '260px', padding: '1.125rem', background: 'var(--bg-muted)', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div style={{ background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-default)', padding: '0.875rem' }}>
                <p style={PANELT}>Breakdown de Custos</p>
                <div style={{ marginBottom: '6px' }}>
                  <p style={GROUPL('#3B82F6')}>Setup & Design</p>
                  <CRow label="Mão de Obra Setup" valor={calc.custoSetup} />
                </div>
                <div style={{ marginBottom: '6px' }}>
                  <p style={GROUPL('#F97316')}>Impressão</p>
                  <CRow label="Energia" valor={calc.custoEnergia} />
                  <CRow label="Manutenção" valor={calc.custoManutencao} />
                  <CRow label="Material" valor={calc.custoMaterial} />
                </div>
                <div>
                  <p style={GROUPL('#8B5CF6')}>Pós-Processamento</p>
                  <CRow label="Mão de Obra Pós" valor={calc.custoPos} />
                </div>
                <CRow label="SUBTOTAL DIRETO" valor={calc.subtotalDireto} bold topBorder />
                <div style={{ marginTop: '8px' }}>
                  <p style={GROUPL('#EF4444')}>Indiretos</p>
                  <CRow label="Consumíveis / Adicional" valor={calc.custoConsumiveis} />
                  <CRow label={`Custo de Falha (${inp.pctFalha}%)`} valor={calc.custoFalha} />
                </div>
                <CRow label="CUSTO TOTAL PRODUÇÃO" valor={calc.custoTotalProducao} bold topBorder />
              </div>

              <div style={{ borderRadius: '12px', background: 'var(--ctp-navy)', padding: '1.125rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Preço de Venda Final</p>
                  <p style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--ctp-lime)', letterSpacing: '-0.04em', lineHeight: 1 }}>{formatarMoeda(calc.precoFinal)}</p>
                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>{inp.quantidadePecas} peça(s) total</p>
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.75rem' }}>
                  <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Preço por Unidade</p>
                  <p style={{ fontSize: '1.375rem', fontWeight: 800, color: 'white' }}>{formatarMoeda(calc.precoUnitario)}</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '7px', background: 'rgba(6,58,112,0.06)', borderRadius: '8px', padding: '9px 11px' }}>
                <Info size={12} color="var(--ctp-navy)" style={{ flexShrink: 0, marginTop: '1px' }} />
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  O <strong>markup divisor</strong> divide o custo de produção; os <strong>fatores</strong> aplicam ajuste no preço final.
                </p>
              </div>

              <button onClick={baixarPDF} disabled={gerando || calc.precoFinal < 0} className="btn btn-lime" style={{ width: '100%', justifyContent: 'center', fontWeight: 800, fontSize: '13px', padding: '10px', gap: '6px' }}>
                <Download size={14} />
                {gerando ? 'Gerando PDF…' : 'Baixar PDF do orçamento'}
              </button>
              <Link to="/configuracoes-calculadora" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', fontSize: '13px', padding: '9px', gap: '6px' }}>
                <LinkIcon size={13} /> Editar materiais e máquinas
              </Link>
            </div>
          </div>
        </div>
      </div>
    </LayoutShell>
  )
}

const LS: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const HNTS: React.CSSProperties = { fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }
const PFXS: React.CSSProperties = { position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--text-muted)', pointerEvents: 'none' }
const SFXS: React.CSSProperties = { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: 'var(--text-muted)', pointerEvents: 'none' }
const PANELT: React.CSSProperties = { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '10px' }
const GROUPL = (color: string): React.CSSProperties => ({ fontSize: '10px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px', marginTop: '6px' })
