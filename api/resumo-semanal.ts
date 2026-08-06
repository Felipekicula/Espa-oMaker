/**
 * Função serverless (Vercel) — Resumo semanal de demandas atribuídas.
 *
 * Consulta as demandas com responsável e prazo até o fim desta semana
 * (incluindo atrasadas de antes que continuam em aberto), agrupa por
 * responsável e envia um email para a chefe (CHEFE_EMAIL) via Resend,
 * para acompanhamento e cobrança de prazos.
 *
 * Disparo:
 *  - Automático: Vercel Cron (ver "crons" no vercel.json). A Vercel envia
 *    o header Authorization: Bearer <CRON_SECRET> automaticamente.
 *  - Manual: botão no app (POST) com o token do usuário logado no header.
 *
 * Variáveis de ambiente (Vercel → Settings → Environment Variables):
 *  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (leitura dos tickets)
 *  - RESEND_API_KEY                            (envio do email)
 *  - EMAIL_FROM                                (remetente; ex.: onboarding@resend.dev)
 *  - CHEFE_EMAIL                               (destinatário; aceita vários separados por vírgula)
 *  - CRON_SECRET                               (protege o disparo automático)
 */

import { createClient } from '@supabase/supabase-js'

/* Vercel injeta objetos req/res no estilo Node. Tipagem leve para não
   depender de @vercel/node no build. */
type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
}
type Res = {
  status: (code: number) => Res
  json: (body: unknown) => void
}

const PRIORIDADE_LABEL: Record<string, string> = {
  urgente: 'Urgente',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
}

const STATUS_LABEL: Record<string, string> = {
  recebida: 'Recebida',
  em_analise: 'Em análise',
  orcamento_em_criacao: 'Orçamento em criação',
  aguardando_aprovacao: 'Esperando aprovação (Pedro)',
  enviado_cliente: 'Enviado ao cliente',
  aprovado: 'Aprovado',
  em_producao: 'Em produção',
  pos_processo: 'Pós-processo',
  pronta: 'Pronta',
}

interface TicketRow {
  id: string
  codigo: string | null
  titulo: string
  solicitante_nome: string | null
  prioridade: string
  status: string
  data_entrega: string
  responsavel: { name: string | null } | null
}

/** Datas da semana (segunda a domingo) e hoje, no fuso de Brasília (UTC-3). */
function semanaBRT() {
  const agoraBRT = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const y = agoraBRT.getUTCFullYear()
  const m = agoraBRT.getUTCMonth()
  const d = agoraBRT.getUTCDate()
  const dow = agoraBRT.getUTCDay() // 0=Dom ... 6=Sáb
  const diffSegunda = (dow + 6) % 7
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10)
  const hoje = fmt(new Date(Date.UTC(y, m, d)))
  const segunda = fmt(new Date(Date.UTC(y, m, d - diffSegunda)))
  const domingo = fmt(new Date(Date.UTC(y, m, d - diffSegunda + 6)))
  return { hoje, segunda, domingo }
}

function brDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export default async function handler(req: Req, res: Res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev'
  const to = (process.env.CHEFE_EMAIL || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  const cronSecret = process.env.CRON_SECRET

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).' })
  }
  if (!resendKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY não configurada.' })
  }
  if (to.length === 0) {
    return res.status(500).json({ error: 'CHEFE_EMAIL não configurado.' })
  }

  const admin = createClient(supabaseUrl, serviceKey)

  // --- Autorização ---
  const authHeader = req.headers['authorization']
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader
  const token = (raw || '').replace(/^Bearer\s+/i, '').trim()

  let autorizado = false
  if (cronSecret && token && token === cronSecret) {
    autorizado = true // disparo automático da Vercel
  } else if (token) {
    const { data } = await admin.auth.getUser(token) // disparo manual (usuário logado)
    if (data?.user) autorizado = true
  }
  if (!autorizado) {
    return res.status(401).json({ error: 'Não autorizado.' })
  }

  // --- Consulta ---
  const { hoje, segunda, domingo } = semanaBRT()

  const { data, error } = await admin
    .from('tickets')
    .select(
      'id, codigo, titulo, solicitante_nome, prioridade, status, data_entrega, responsavel:responsavel_id ( name )',
    )
    .is('excluida_em', null)
    .not('responsavel_id', 'is', null)
    .not('data_entrega', 'is', null)
    .lte('data_entrega', domingo)
    .neq('status', 'entregue')
    .neq('status', 'cancelada')
    .order('data_entrega', { ascending: true })

  if (error) {
    return res.status(500).json({ error: `Erro ao consultar demandas: ${error.message}` })
  }

  const tickets = (data ?? []) as unknown as TicketRow[]

  // --- Agrupa por responsável ---
  interface Grupo {
    nome: string
    atrasadas: TicketRow[]
    semana: TicketRow[]
  }
  const grupos = new Map<string, Grupo>()
  for (const t of tickets) {
    const nome = t.responsavel?.name ?? 'Sem responsável'
    if (!grupos.has(nome)) grupos.set(nome, { nome, atrasadas: [], semana: [] })
    const g = grupos.get(nome)!
    if (t.data_entrega < hoje) g.atrasadas.push(t)
    else g.semana.push(t)
  }
  const gruposOrdenados = [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome))

  const totalAtrasadas = tickets.filter((t) => t.data_entrega < hoje).length
  const totalSemana = tickets.length - totalAtrasadas

  // --- HTML do email ---
  const NAVY = '#063A70'
  const LIME = '#A1F01F'

  const linha = (t: TicketRow, atrasada: boolean) => {
    const prazo = brDate(t.data_entrega)
    const cor = atrasada ? '#DC2626' : '#111827'
    const tag = atrasada
      ? `<span style="background:#FEE2E2;color:#991B1B;font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px;white-space:nowrap">ATRASADA</span>`
      : ''
    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF2F6;font-size:13px;color:${cor};font-weight:600">
          ${esc(t.titulo)} ${tag}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF2F6;font-size:12px;color:#6B7280">${esc(t.solicitante_nome ?? '—')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF2F6;font-size:12px;color:${cor};font-weight:700;white-space:nowrap">${prazo}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF2F6;font-size:12px;color:#6B7280;white-space:nowrap">${STATUS_LABEL[t.status] ?? t.status}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF2F6;font-size:12px;color:#6B7280;white-space:nowrap">${PRIORIDADE_LABEL[t.prioridade] ?? t.prioridade}</td>
      </tr>`
  }

  const cabecalhoTabela = `
    <tr style="background:#F3F6FA">
      <th style="text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280">Demanda</th>
      <th style="text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280">Solicitante</th>
      <th style="text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280">Prazo</th>
      <th style="text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280">Status</th>
      <th style="text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280">Prioridade</th>
    </tr>`

  const blocosPorPessoa = gruposOrdenados
    .map((g) => {
      const linhas = [
        ...g.atrasadas.map((t) => linha(t, true)),
        ...g.semana.map((t) => linha(t, false)),
      ].join('')
      const contadores = `${g.atrasadas.length > 0 ? `<span style="color:#DC2626;font-weight:700">${g.atrasadas.length} atrasada(s)</span> · ` : ''}${g.semana.length} nesta semana`
      return `
        <div style="margin:0 0 22px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <h3 style="margin:0;font-size:15px;color:${NAVY}">${esc(g.nome)}</h3>
            <span style="font-size:12px;color:#6B7280">${contadores}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #EEF2F6;border-radius:8px;overflow:hidden">
            ${cabecalhoTabela}
            ${linhas}
          </table>
        </div>`
    })
    .join('')

  const corpo =
    gruposOrdenados.length === 0
      ? `<p style="font-size:14px;color:#374151">Nenhuma demanda com prazo até <strong>${brDate(domingo)}</strong> no momento. Tudo em dia! 🎉</p>`
      : blocosPorPessoa

  const html = `
  <div style="background:#F1F5F9;padding:24px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0">
      <div style="background:${NAVY};padding:22px 26px">
        <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1.5px;text-transform:uppercase">Cilla Tech Park — Espaço Maker</div>
        <div style="font-size:20px;font-weight:800;color:#fff;margin-top:4px">Resumo semanal de demandas</div>
        <div style="font-size:12px;color:${LIME};margin-top:6px">Semana de ${brDate(segunda)} a ${brDate(domingo)}</div>
      </div>
      <div style="padding:22px 26px">
        <div style="display:flex;gap:10px;margin-bottom:20px">
          <div style="flex:1;background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 14px">
            <div style="font-size:24px;font-weight:800;color:#DC2626;line-height:1">${totalAtrasadas}</div>
            <div style="font-size:11px;color:#991B1B;text-transform:uppercase;letter-spacing:0.5px;margin-top:3px">Atrasadas</div>
          </div>
          <div style="flex:1;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 14px">
            <div style="font-size:24px;font-weight:800;color:${NAVY};line-height:1">${totalSemana}</div>
            <div style="font-size:11px;color:#075985;text-transform:uppercase;letter-spacing:0.5px;margin-top:3px">Com prazo nesta semana</div>
          </div>
        </div>
        ${corpo}
      </div>
      <div style="padding:14px 26px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:11px;color:#94A3B8">
        Enviado automaticamente pelo sistema do Espaço Maker para acompanhamento de prazos.
      </div>
    </div>
  </div>`

  const assunto = `Resumo semanal de demandas — ${totalAtrasadas} atrasada(s), ${totalSemana} nesta semana`

  // --- Envio via Resend ---
  const envio = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject: assunto, html }),
  })

  if (!envio.ok) {
    const detalhe = await envio.text()
    return res.status(502).json({ error: 'Falha ao enviar email pelo Resend.', detalhe })
  }

  return res.status(200).json({
    ok: true,
    enviadoPara: to,
    totalAtrasadas,
    totalSemana,
    pessoas: gruposOrdenados.length,
  })
}
