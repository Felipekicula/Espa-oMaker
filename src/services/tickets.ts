import { supabase } from '../lib/supabaseClient'
import type {
  Ticket,
  TicketCategoria,
  TicketPrioridade,
  TicketStatus,
  TicketTipo,
  TicketOrigem,
} from '../types/ticket'

function extractMissingColumnName(message: string): string | null {
  const m = message.match(
    /column\s+([a-zA-Z0-9_]+\.)?("?)([a-zA-Z0-9_]+)\2\s+does not exist/i,
  )
  return m?.[3] ?? null
}

function isMissingColumnError(err: unknown): err is { message: string } {
  return !!(
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as any).message === 'string' &&
    /column .* does not exist/i.test(String((err as any).message))
  )
}

export interface TicketFilters {
  search?: string
  status?: TicketStatus | 'atrasadas' | 'prazo_hoje'
  /** Múltiplos status (ex.: recebida + em_analise + orcamento_em_criacao para "Recebidas") */
  statusIn?: TicketStatus[]
  responsavelId?: string
  prioridade?: TicketPrioridade
  categoria?: TicketCategoria
  tipo?: TicketTipo
  origem?: TicketOrigem
  /** Filtro por data de entrega (prazo) */
  dataInicial?: string
  dataFinal?: string
  /** Filtro por data de criação (para relatórios por período) */
  dataCriacaoInicial?: string
  dataCriacaoFinal?: string
  /** Incluir demandas canceladas no resultado (ex.: dashboard para contar no card) */
  includeCancelada?: boolean
  /** Demandas em que o usuário é responsável OU colaborador (minhas demandas) */
  responsavelOuColaboradorId?: string
}

export interface ListTicketsOptions {
  limit?: number
  offset?: number
  /** Ordenar por prazo (data_entrega): mais próximo primeiro. Padrão data_criacao desc. */
  orderBy?: 'data_criacao' | 'data_entrega'
  orderDirection?: 'asc' | 'desc'
}

export interface ListTicketsResult {
  tickets: Ticket[]
  hasMore: boolean
}

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 5000

const TICKETS_SELECT_BASE = `
  id,
  codigo,
  titulo,
  descricao,
  tipo,
  origem,
  solicitante_nome,
  solicitante_telefone,
  categoria,
  prioridade,
  status,
  responsavel_id,
  colaborador_id,
  data_criacao,
  data_entrega,
  material_impressao,
  cor,
  quantidade_pecas,
  tamanho_escala,
  observacoes_tecnicas,
  preco_por_peca,
  quantidade_orcamento,
  total_orcamento,
  desconto,
  observacoes_orcamento,
  status_orcamento,
  sem_cobranca,
  valor_demanda,
  tipo_receita,
  contrapartida_material,
  contrapartida_quantidade,
  custo,
  nivel_dificuldade,
  excluida_em,
  responsavel:responsavel_id ( id, name, avatar_url )
`

const TICKETS_SELECT_EXTENDED = `
  ${TICKETS_SELECT_BASE},
  orcamento_pago_em,
  pagamento_tipo,
  pagamento_data,
  pagamento_pago_em,
  receita_recorrente,
  receita_recorrente_dia_pagamento,
  receita_recorrente_inicio,
  receita_recorrente_fim
`

export async function listTickets(
  filters: TicketFilters = {},
  options: ListTicketsOptions = {},
): Promise<ListTicketsResult> {
  const limit = Math.min(
    options.limit ?? DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  )
  const offset = options.offset ?? 0
  const fetchSize = limit + 1
  const run = async (select: string): Promise<ListTicketsResult> => {
    let query = supabase.from('tickets').select(select)

    query = query.is('excluida_em', null)

    const hoje = new Date().toISOString().slice(0, 10)
    if (filters.statusIn?.length) {
      query = query.in('status', filters.statusIn)
    } else if (filters.status === 'atrasadas') {
      query = query
        .lt('data_entrega', hoje)
        .neq('status', 'entregue')
        .neq('status', 'cancelada')
    } else if (filters.status && filters.status !== 'prazo_hoje') {
      query = query.eq('status', filters.status)
    }

    if (
      !filters.includeCancelada &&
      filters.status !== 'cancelada' &&
      !filters.statusIn?.length
    ) {
      query = query.neq('status', 'cancelada')
    }

    if (filters.responsavelOuColaboradorId) {
      query = query.or(
        `responsavel_id.eq.${filters.responsavelOuColaboradorId},colaborador_id.eq.${filters.responsavelOuColaboradorId}`,
      )
    } else if (filters.responsavelId) {
      query = query.eq('responsavel_id', filters.responsavelId)
    }

    if (filters.prioridade) {
      query = query.eq('prioridade', filters.prioridade)
    }

    if (filters.categoria) {
      query = query.eq('categoria', filters.categoria)
    }

    if (filters.tipo) {
      query = query.eq('tipo', filters.tipo)
    }

    if (filters.origem) {
      query = query.eq('origem', filters.origem)
    }

    if (filters.dataInicial) {
      query = query.gte('data_entrega', filters.dataInicial)
    }
    if (filters.dataFinal) {
      query = query.lte('data_entrega', filters.dataFinal)
    }

    if (filters.dataCriacaoInicial) {
      query = query.gte('data_criacao', filters.dataCriacaoInicial)
    }
    if (filters.dataCriacaoFinal) {
      query = query.lte('data_criacao', filters.dataCriacaoFinal)
    }

    if (filters.search) {
      const term = `%${filters.search}%`
      query = query.or(
        `titulo.ilike.${term},descricao.ilike.${term},solicitante_nome.ilike.${term},codigo.ilike.${term}`,
      )
    }

    const orderBy = options.orderBy ?? 'data_criacao'
    const orderDir =
      options.orderDirection ?? (orderBy === 'data_entrega' ? 'asc' : 'desc')
    const ascending = orderDir === 'asc'

    if (orderBy === 'data_entrega') {
      query = query.order('data_entrega', {
        ascending,
        nullsFirst: !ascending,
      })
    } else {
      query = query.order('data_criacao', { ascending: false })
    }

    const { data, error } = await query.range(offset, offset + fetchSize - 1)
    if (error) throw error

    const rows = data ?? []
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const tickets = page.map(mapRowToTicket)
    return { tickets, hasMore }
  }

  try {
    return await run(TICKETS_SELECT_EXTENDED)
  } catch (err) {
    if (isMissingColumnError(err)) {
      return await run(TICKETS_SELECT_BASE)
    }
    throw err
  }
}

/** Quantidade de demandas em que o usuário é resp/colab criadas após a data (YYYY-MM-DD). Para badge de não lidos. */
export async function getMinhasDemandasUnreadCount(
  userId: string,
  sinceDate: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .is('excluida_em', null)
    .or(`responsavel_id.eq.${userId},colaborador_id.eq.${userId}`)
    .gt('data_criacao', sinceDate)

  if (error) return 0
  return count ?? 0
}

/** Quantidade de demandas na caixa de entrada (workflow de orçamento) criadas após a data (YYYY-MM-DD). Para badge de não lidos. */
export async function getTriagemUnreadCount(sinceDate: string): Promise<number> {
  const { count, error } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .is('excluida_em', null)
    .in('status', [
      'recebida',
      'orcamento_em_criacao',
      'aguardando_aprovacao',
      'enviado_cliente',
    ])
    .gt('data_criacao', sinceDate)

  if (error) return 0
  return count ?? 0
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const run = async (select: string): Promise<Ticket | null> => {
    const { data, error } = await supabase
      .from('tickets')
      .select(select)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return mapRowToTicket(data)
  }

  try {
    return await run(TICKETS_SELECT_EXTENDED)
  } catch (err) {
    if (isMissingColumnError(err)) {
      return await run(TICKETS_SELECT_BASE)
    }
    throw err
  }
}

/** Marca a demanda como excluída (some das listas; na página fica só leitura). Exclui as tasks da demanda. */
export async function setTicketExcluida(id: string): Promise<void> {
  const { error: deleteTasksError } = await supabase
    .from('ticket_tasks')
    .delete()
    .eq('ticket_id', id)

  if (deleteTasksError) throw deleteTasksError

  const { error } = await supabase
    .from('tickets')
    .update({ excluida_em: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}

export interface CreateTicketInput {
  titulo: string
  descricao?: string
  tipo: TicketTipo
  /** Default 'interno'. Use 'formulario' para demandas do link público/WhatsApp. */
  origem?: TicketOrigem
  solicitante_nome: string
  solicitante_telefone?: string
  categoria: TicketCategoria
  prioridade: TicketPrioridade
  data_entrega?: string
  valor_demanda?: number | null
  pagamento_tipo?: 'avista' | 'a_definir' | null
  pagamento_data?: string | null
  receita_recorrente?: boolean
  receita_recorrente_dia_pagamento?: number | null
  receita_recorrente_inicio?: string | null
  receita_recorrente_fim?: string | null
  tipo_receita?: 'monetaria' | 'contrapartida' | null
  contrapartida_material?: string | null
  contrapartida_quantidade?: number | null
  custo?: number | null
  material_impressao?: string
  cor?: string
  quantidade_pecas?: number
  tamanho_escala?: string
  observacoes_tecnicas?: string
  preco_por_peca?: number
  quantidade_orcamento?: number
  desconto?: number
  observacoes_orcamento?: string
  status_orcamento?: 'aguardando_aprovacao' | 'aprovado' | 'reprovado'
  sem_cobranca?: boolean
  /** Se definido (ex.: executor que cria a própria demanda), já entra com responsável. */
  responsavel_id?: string | null
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const payload: Record<string, unknown> = {
      titulo: input.titulo,
      descricao: input.descricao,
      tipo: input.tipo,
      origem: input.origem ?? 'interno',
      solicitante_nome: input.solicitante_nome,
      solicitante_telefone: input.solicitante_telefone,
      categoria: input.categoria,
      prioridade: input.prioridade,
      data_entrega: input.data_entrega ?? null,
      valor_demanda: input.valor_demanda ?? null,
      // Campos novos: não força default para manter compatibilidade com bancos antigos.
      ...(input.pagamento_tipo !== undefined ? { pagamento_tipo: input.pagamento_tipo } : {}),
      ...(input.pagamento_data !== undefined ? { pagamento_data: input.pagamento_data } : {}),
      ...(input.receita_recorrente !== undefined ? { receita_recorrente: input.receita_recorrente } : {}),
      ...(input.receita_recorrente_dia_pagamento !== undefined
        ? { receita_recorrente_dia_pagamento: input.receita_recorrente_dia_pagamento }
        : {}),
      ...(input.receita_recorrente_inicio !== undefined
        ? { receita_recorrente_inicio: input.receita_recorrente_inicio }
        : {}),
      ...(input.receita_recorrente_fim !== undefined
        ? { receita_recorrente_fim: input.receita_recorrente_fim }
        : {}),
      tipo_receita: input.tipo_receita ?? 'monetaria',
      contrapartida_material: input.contrapartida_material ?? null,
      contrapartida_quantidade: input.contrapartida_quantidade ?? null,
      custo: input.custo ?? null,
      material_impressao: input.material_impressao ?? null,
      cor: input.cor ?? null,
      quantidade_pecas: input.quantidade_pecas ?? null,
      tamanho_escala: input.tamanho_escala ?? null,
      observacoes_tecnicas: input.observacoes_tecnicas ?? null,
      preco_por_peca: input.preco_por_peca ?? null,
      quantidade_orcamento: input.quantidade_orcamento ?? null,
      total_orcamento:
        input.preco_por_peca && input.quantidade_orcamento
          ? input.preco_por_peca * input.quantidade_orcamento
          : null,
      desconto: input.desconto ?? null,
      observacoes_orcamento: input.observacoes_orcamento ?? null,
      status_orcamento: input.status_orcamento ?? null,
      sem_cobranca: input.sem_cobranca ?? false,
      ...(input.responsavel_id
        ? { responsavel_id: input.responsavel_id }
        : {}),
    }

  const insertTry = async (p: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from('tickets')
      .insert(p)
      .select()
      .single()
    if (error) throw error
    return mapRowToTicket(data)
  }

  try {
    return await insertTry(payload)
  } catch (err) {
    if (isMissingColumnError(err)) {
      const col = extractMissingColumnName(err.message)
      if (col && col in payload) {
        const next = { ...payload }
        delete (next as any)[col]
        return await insertTry(next)
      }
    }
    throw err
  }
}

export interface UpdateTicketStatusInput {
  status: TicketStatus
  data_entrega?: string | null
}

const TICKET_SELECT_WITH_RESPONSAVEL = `
  id,
  codigo,
  titulo,
  descricao,
  tipo,
  origem,
  solicitante_nome,
  solicitante_telefone,
  categoria,
  prioridade,
  status,
  responsavel_id,
  colaborador_id,
  data_criacao,
  data_entrega,
  material_impressao,
  cor,
  quantidade_pecas,
  tamanho_escala,
  observacoes_tecnicas,
  preco_por_peca,
  quantidade_orcamento,
  total_orcamento,
  desconto,
  observacoes_orcamento,
  status_orcamento,
  sem_cobranca,
  valor_demanda,
  orcamento_pago_em,
  pagamento_tipo,
  pagamento_data,
  pagamento_pago_em,
  receita_recorrente,
  receita_recorrente_dia_pagamento,
  receita_recorrente_inicio,
  receita_recorrente_fim,
  nivel_dificuldade,
  excluida_em,
  responsavel:responsavel_id ( id, name, avatar_url )
`

export async function setTicketPagamentoPago(
  id: string,
  pago: boolean,
): Promise<Ticket> {
  const { data, error } = await supabase
    .from('tickets')
    .update({ pagamento_pago_em: pago ? new Date().toISOString() : null })
    .eq('id', id)
    .select(TICKET_SELECT_WITH_RESPONSAVEL)
    .single()

  if (error) throw error
  return mapRowToTicket(data)
}

export async function setTicketOrcamentoPago(
  id: string,
  pago: boolean,
): Promise<Ticket> {
  const { data, error } = await supabase
    .from('tickets')
    .update({ orcamento_pago_em: pago ? new Date().toISOString() : null })
    .eq('id', id)
    .select(TICKET_SELECT_WITH_RESPONSAVEL)
    .single()

  if (error) throw error
  return mapRowToTicket(data)
}

export async function updateTicketStatus(
  id: string,
  payload: UpdateTicketStatusInput,
): Promise<Ticket> {
  const updatePayload: Record<string, unknown> = {
    status: payload.status,
  }
  if (payload.data_entrega !== undefined) {
    updatePayload.data_entrega = payload.data_entrega
  }

  const { data, error } = await supabase
    .from('tickets')
    .update(updatePayload)
    .eq('id', id)
    .select(TICKET_SELECT_WITH_RESPONSAVEL)
    .single()

  if (error) {
    throw error
  }

  return mapRowToTicket(data)
}

/** Atualização de dados gerais da demanda (Felipe e responsável/colaborador podem editar tudo). */
export interface UpdateTicketDadosInput {
  titulo?: string
  descricao?: string | null
  solicitante_nome?: string
  solicitante_telefone?: string | null
  categoria?: TicketCategoria
  prioridade?: TicketPrioridade
  data_entrega?: string | null
  valor_demanda?: number | null
  pagamento_tipo?: 'avista' | 'a_definir' | null
  pagamento_data?: string | null
  pagamento_pago_em?: string | null
  receita_recorrente?: boolean
  receita_recorrente_dia_pagamento?: number | null
  receita_recorrente_inicio?: string | null
  receita_recorrente_fim?: string | null
  tipo_receita?: 'monetaria' | 'contrapartida' | null
  contrapartida_material?: string | null
  contrapartida_quantidade?: number | null
  custo?: number | null
  material_impressao?: string | null
  cor?: string | null
  quantidade_pecas?: number | null
  tamanho_escala?: string | null
  observacoes_tecnicas?: string | null
  nivel_dificuldade?: import('../types/ticket').NivelDificuldade | null
}

export async function updateTicketDados(
  id: string,
  payload: UpdateTicketDadosInput,
): Promise<Ticket> {
  const updatePayload: Record<string, unknown> = {}
  if (payload.titulo !== undefined) updatePayload.titulo = payload.titulo
  if (payload.descricao !== undefined) updatePayload.descricao = payload.descricao
  if (payload.solicitante_nome !== undefined)
    updatePayload.solicitante_nome = payload.solicitante_nome
  if (payload.solicitante_telefone !== undefined)
    updatePayload.solicitante_telefone = payload.solicitante_telefone
  if (payload.categoria !== undefined) updatePayload.categoria = payload.categoria
  if (payload.prioridade !== undefined) updatePayload.prioridade = payload.prioridade
  if (payload.data_entrega !== undefined)
    updatePayload.data_entrega = payload.data_entrega
  if (payload.material_impressao !== undefined)
    updatePayload.material_impressao = payload.material_impressao
  if (payload.cor !== undefined) updatePayload.cor = payload.cor
  if (payload.quantidade_pecas !== undefined)
    updatePayload.quantidade_pecas = payload.quantidade_pecas
  if (payload.tamanho_escala !== undefined)
    updatePayload.tamanho_escala = payload.tamanho_escala
  if (payload.observacoes_tecnicas !== undefined)
    updatePayload.observacoes_tecnicas = payload.observacoes_tecnicas
  if (payload.valor_demanda !== undefined)
    updatePayload.valor_demanda = payload.valor_demanda
  if (payload.pagamento_tipo !== undefined)
    updatePayload.pagamento_tipo = payload.pagamento_tipo
  if (payload.pagamento_data !== undefined)
    updatePayload.pagamento_data = payload.pagamento_data
  if (payload.pagamento_pago_em !== undefined)
    updatePayload.pagamento_pago_em = payload.pagamento_pago_em
  if (payload.receita_recorrente !== undefined)
    updatePayload.receita_recorrente = payload.receita_recorrente
  if (payload.receita_recorrente_dia_pagamento !== undefined)
    updatePayload.receita_recorrente_dia_pagamento = payload.receita_recorrente_dia_pagamento
  if (payload.receita_recorrente_inicio !== undefined)
    updatePayload.receita_recorrente_inicio = payload.receita_recorrente_inicio
  if (payload.receita_recorrente_fim !== undefined)
    updatePayload.receita_recorrente_fim = payload.receita_recorrente_fim
  if (payload.tipo_receita !== undefined)
    updatePayload.tipo_receita = payload.tipo_receita
  if (payload.contrapartida_material !== undefined)
    updatePayload.contrapartida_material = payload.contrapartida_material
  if (payload.contrapartida_quantidade !== undefined)
    updatePayload.contrapartida_quantidade = payload.contrapartida_quantidade
  if (payload.custo !== undefined) updatePayload.custo = payload.custo
  if (payload.nivel_dificuldade !== undefined)
    updatePayload.nivel_dificuldade = payload.nivel_dificuldade

  const { data, error } = await supabase
    .from('tickets')
    .update(updatePayload)
    .eq('id', id)
    .select(
      `
      *,
      responsavel:responsavel_id ( id, name, avatar_url )
    `,
    )
    .single()

  if (error) throw error
  return mapRowToTicket(data)
}

export interface UpdateTicketResponsavelInput {
  responsavel_id: string | null
  colaborador_id?: string | null
  /** Ao atribuir na triagem, avança para em_analise para a demanda sair da caixa de entrada */
  status?: TicketStatus
  data_entrega?: string | null
}

export async function updateTicketResponsavel(
  id: string,
  payload: UpdateTicketResponsavelInput,
): Promise<Ticket> {
  const updatePayload: Record<string, unknown> = {
    responsavel_id: payload.responsavel_id,
    colaborador_id: payload.colaborador_id ?? null,
  }
  if (payload.status !== undefined) updatePayload.status = payload.status
  if (payload.data_entrega !== undefined) updatePayload.data_entrega = payload.data_entrega

  const { data, error } = await supabase
    .from('tickets')
    .update(updatePayload)
    .eq('id', id)
    .select(
      `
      *,
      responsavel:responsavel_id ( id, name, avatar_url )
    `,
    )
    .single()

  if (error) {
    throw error
  }

  return mapRowToTicket(data)
}

export interface UpdateTicketOrcamentoInput {
  preco_por_peca: number
  quantidade_orcamento: number
  desconto?: number
  observacoes_orcamento?: string
  status_orcamento: 'aguardando_aprovacao' | 'aprovado' | 'reprovado'
  sem_cobranca?: boolean
}

export async function updateTicketOrcamento(
  id: string,
  payload: UpdateTicketOrcamentoInput,
): Promise<Ticket> {
  const total = payload.preco_por_peca * payload.quantidade_orcamento

  const { data, error } = await supabase
    .from('tickets')
    .update({
      preco_por_peca: payload.preco_por_peca,
      quantidade_orcamento: payload.quantidade_orcamento,
      total_orcamento: total,
      desconto: payload.desconto ?? null,
      observacoes_orcamento: payload.observacoes_orcamento ?? null,
      status_orcamento: payload.status_orcamento,
      sem_cobranca: payload.sem_cobranca ?? false,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw error
  }

  return mapRowToTicket(data)
}

export interface VincularOrcamentoInput {
  /** Preço unitário calculado (por peça). */
  preco_por_peca: number
  /** Quantidade total de peças do orçamento. */
  quantidade_orcamento: number
  /** Total do orçamento (preço final da calculadora). */
  total_orcamento: number
  observacoes_orcamento?: string | null
  /**
   * Se true, avança a demanda para "Esperando aprovação (Pedro)"
   * (status = aguardando_aprovacao). Se a demanda já estiver numa fase
   * posterior, o status não é rebaixado.
   */
  avancarFase?: boolean
}

/**
 * Vincula o orçamento gerado na calculadora a um pedido da caixa de entrada.
 * Grava os valores de orçamento no ticket e, opcionalmente, avança a fase.
 */
export async function vincularOrcamentoAoPedido(
  id: string,
  input: VincularOrcamentoInput,
  /** Status atual da demanda (para não rebaixar a fase). */
  statusAtual?: TicketStatus,
): Promise<Ticket> {
  const updatePayload: Record<string, unknown> = {
    preco_por_peca: input.preco_por_peca,
    quantidade_orcamento: input.quantidade_orcamento,
    total_orcamento: input.total_orcamento,
    status_orcamento: 'aguardando_aprovacao',
    observacoes_orcamento: input.observacoes_orcamento ?? null,
    valor_demanda: input.total_orcamento,
  }

  // Fases anteriores à "esperando aprovação" — só nelas faz sentido avançar.
  const fasesIniciais: TicketStatus[] = ['recebida', 'orcamento_em_criacao']
  if (
    input.avancarFase &&
    (!statusAtual || fasesIniciais.includes(statusAtual))
  ) {
    updatePayload.status = 'aguardando_aprovacao'
  }

  const { data, error } = await supabase
    .from('tickets')
    .update(updatePayload)
    .eq('id', id)
    .select(TICKET_SELECT_WITH_RESPONSAVEL)
    .single()

  if (error) throw error
  return mapRowToTicket(data)
}

export interface TicketComment {
  id: number
  ticket_id: string
  created_at: string
  author_name: string
  body: string
}

export async function listComments(ticketId: string): Promise<TicketComment[]> {
  const { data, error } = await supabase
    .from('ticket_comments')
    .select(
      `
        id,
        ticket_id,
        created_at,
        body,
        author:author_id ( id, name )
      `,
    )
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (
    data?.map((row: any) => ({
      id: row.id,
      ticket_id: row.ticket_id,
      created_at: row.created_at,
      body: row.body,
      author_name: row.author?.name ?? 'Usuário',
    })) ?? []
  )
}

export async function addComment(
  ticketId: string,
  body: string,
  authorId: string,
): Promise<void> {
  const { error } = await supabase
    .from('ticket_comments')
    .insert({ ticket_id: ticketId, body, author_id: authorId })

  if (error) throw error
}

// --- Tasks da demanda ---

export type TicketTaskStatus = 'pendente' | 'em_producao' | 'concluido'

export interface TicketTask {
  id: number
  ticket_id: string
  titulo: string
  descricao: string | null
  responsavel_id: string
  responsavel_nome: string
  created_by: string | null
  created_by_nome: string | null
  created_at: string
  status: TicketTaskStatus
}

/** Tasks atribuídas a um responsável (para exibir em "Minhas demandas"). */
export interface TicketTaskWithDemanda extends TicketTask {
  ticket_titulo: string
}

/** Contagem de demandas e tasks por pessoa (para "Minhas demandas"). Demandas = onde a pessoa é responsável ou colaborador; tasks = onde é responsável. Só demandas não excluídas e não canceladas. */
export interface DemandasTasksCountPorUsuario {
  user_id: string
  user_name: string
  demandas_count: number
  tasks_count: number
}

export async function getDemandasAndTasksCountPerUser(): Promise<
  DemandasTasksCountPorUsuario[]
> {
  const { data: ticketsData } = await supabase
    .from('tickets')
    .select('id, responsavel_id, colaborador_id')
    .is('excluida_em', null)
    .neq('status', 'cancelada')
    .limit(5000)

  const tickets = ticketsData ?? []
  const demandasPorUser = new Map<string, number>()
  const ticketIdsNaoExcluidos = new Set<string>()

  for (const t of tickets) {
    ticketIdsNaoExcluidos.add(t.id)
    if (t.responsavel_id) {
      demandasPorUser.set(
        t.responsavel_id,
        (demandasPorUser.get(t.responsavel_id) ?? 0) + 1,
      )
    }
    if (t.colaborador_id && t.colaborador_id !== t.responsavel_id) {
      demandasPorUser.set(
        t.colaborador_id,
        (demandasPorUser.get(t.colaborador_id) ?? 0) + 1,
      )
    }
  }

  const ids = Array.from(ticketIdsNaoExcluidos)
  const tasksPorUser = new Map<string, number>()
  if (ids.length > 0) {
    const chunk = 200
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk)
      const { data: tasksData } = await supabase
        .from('ticket_tasks')
        .select('responsavel_id')
        .in('ticket_id', slice)
      for (const row of tasksData ?? []) {
        if (row.responsavel_id) {
          tasksPorUser.set(
            row.responsavel_id,
            (tasksPorUser.get(row.responsavel_id) ?? 0) + 1,
          )
        }
      }
    }
  }

  const userIds = new Set([
    ...demandasPorUser.keys(),
    ...tasksPorUser.keys(),
  ])
  if (userIds.size === 0) return []

  const { data: usersData } = await supabase
    .from('app_users')
    .select('id, name')
    .in('id', Array.from(userIds))

  const names = new Map<string, string>()
  for (const u of usersData ?? []) {
    names.set(u.id, u.name ?? '—')
  }

  return Array.from(userIds)
    .map((user_id) => ({
      user_id,
      user_name: names.get(user_id) ?? '—',
      demandas_count: demandasPorUser.get(user_id) ?? 0,
      tasks_count: tasksPorUser.get(user_id) ?? 0,
    }))
    .filter((r) => r.demandas_count > 0 || r.tasks_count > 0)
    .sort((a, b) => a.user_name.localeCompare(b.user_name))
}

export async function listTasksByResponsavel(
  responsavelId: string,
): Promise<TicketTaskWithDemanda[]> {
  const { data, error } = await supabase
    .from('ticket_tasks')
    .select(
      `
        id,
        ticket_id,
        titulo,
        descricao,
        responsavel_id,
        created_by,
        created_at,
        status,
        responsavel:responsavel_id ( id, name ),
        creator:created_by ( id, name ),
        ticket:ticket_id ( id, titulo )
      `,
    )
    .eq('responsavel_id', responsavelId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (
    data?.map((row: any) => ({
      id: row.id,
      ticket_id: row.ticket_id,
      titulo: row.titulo,
      descricao: row.descricao ?? null,
      responsavel_id: row.responsavel_id,
      responsavel_nome: row.responsavel?.name ?? '—',
      created_by: row.created_by ?? null,
      created_by_nome: row.creator?.name ?? null,
      created_at: row.created_at,
      status: row.status,
      ticket_titulo: row.ticket?.titulo ?? 'Demanda',
    })) ?? []
  )
}

export async function listTicketTasks(ticketId: string): Promise<TicketTask[]> {
  const { data, error } = await supabase
    .from('ticket_tasks')
    .select(
      `
        id,
        ticket_id,
        titulo,
        descricao,
        responsavel_id,
        created_by,
        created_at,
        status,
        responsavel:responsavel_id ( id, name ),
        creator:created_by ( id, name )
      `,
    )
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (
    data?.map((row: any) => ({
      id: row.id,
      ticket_id: row.ticket_id,
      titulo: row.titulo,
      descricao: row.descricao ?? null,
      responsavel_id: row.responsavel_id,
      responsavel_nome: row.responsavel?.name ?? '—',
      created_by: row.created_by ?? null,
      created_by_nome: row.creator?.name ?? null,
      created_at: row.created_at,
      status: row.status,
    })) ?? []
  )
}

export interface CreateTicketTaskInput {
  titulo: string
  descricao?: string | null
  responsavel_id: string
}

export async function createTicketTask(
  ticketId: string,
  input: CreateTicketTaskInput,
): Promise<TicketTask> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login para criar tasks.')

  const { data, error } = await supabase
    .from('ticket_tasks')
    .insert({
      ticket_id: ticketId,
      titulo: input.titulo,
      descricao: input.descricao ?? null,
      responsavel_id: input.responsavel_id,
      created_by: user.id,
      status: 'pendente',
    })
    .select(
      `
        id,
        ticket_id,
        titulo,
        descricao,
        responsavel_id,
        created_by,
        created_at,
        status,
        responsavel:responsavel_id ( id, name ),
        creator:created_by ( id, name )
      `,
    )
    .single()

  if (error) throw error

  const row = data as any
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    titulo: row.titulo,
    descricao: row.descricao ?? null,
    responsavel_id: row.responsavel_id,
    responsavel_nome: row.responsavel?.name ?? '—',
    created_by: row.created_by ?? null,
    created_by_nome: row.creator?.name ?? null,
    created_at: row.created_at,
    status: row.status,
  }
}

export async function updateTicketTaskStatus(
  taskId: number,
  status: TicketTaskStatus,
): Promise<void> {
  const { error } = await supabase
    .from('ticket_tasks')
    .update({ status })
    .eq('id', taskId)

  if (error) throw error
}

/** Qualquer usuário autenticado pode alterar o responsável da task. */
export async function updateTicketTaskResponsavel(
  taskId: number,
  responsavel_id: string,
): Promise<void> {
  const { error } = await supabase
    .from('ticket_tasks')
    .update({ responsavel_id })
    .eq('id', taskId)

  if (error) throw error
}

export interface UpdateTicketTaskInput {
  titulo?: string
  descricao?: string | null
}

/** Editar título e/ou descrição da task. */
export async function updateTicketTask(
  taskId: number,
  input: UpdateTicketTaskInput,
): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (input.titulo !== undefined) payload.titulo = input.titulo
  if (input.descricao !== undefined) payload.descricao = input.descricao
  if (Object.keys(payload).length === 0) return

  const { error } = await supabase
    .from('ticket_tasks')
    .update(payload)
    .eq('id', taskId)

  if (error) throw error
}

/** Excluir uma task. */
export async function deleteTicketTask(taskId: number): Promise<void> {
  const { error } = await supabase
    .from('ticket_tasks')
    .delete()
    .eq('id', taskId)

  if (error) throw error
}

export interface TicketFile {
  id: number
  ticket_id: string
  created_at: string
  kind: 'foto' | 'arquivo'
  file_name: string
  public_url: string
}

const BUCKET = 'ticket-files'

/** Limite máximo por arquivo (50 MB no plano Free do Supabase). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export async function uploadTicketFile(
  ticketId: string,
  file: File,
  kind: 'foto' | 'arquivo',
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login para enviar anexos.')

  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    throw new Error(
      `Arquivo muito grande (máx. ${mb} MB). Comprima o arquivo ou use um menor.`,
    )
  }

  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (uploadError) {
    const msg = uploadError.message ?? ''
    if (
      /maximum allowed size|exceeded.*size|object.*size/i.test(msg) ||
      uploadError.message?.includes('Payload too large')
    ) {
      throw new Error(
        'Arquivo maior que o limite do Storage. No Supabase: Storage → Settings, aumente o "Global file size limit" (ex.: 50 MB). No bucket "ticket-files", em Editar, aumente o limite de tamanho por arquivo.',
      )
    }
    throw uploadError
  }

  const { error: insertError } = await supabase.from('ticket_files').insert({
    ticket_id: ticketId,
    uploaded_by: user.id,
    kind,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  })

  if (insertError) throw insertError
}

/** Limite por foto no formulário público (10 MB). */
export const MAX_PUBLIC_PHOTO_BYTES = 10 * 1024 * 1024

/**
 * Upload de foto ou arquivo (ex.: STL/3MF) sem login (formulário público /solicitar).
 * Só funciona para tickets com origem = 'formulario'.
 */
export async function uploadTicketFilePublic(
  ticketId: string,
  file: File,
  kind: 'foto' | 'arquivo' = 'foto',
): Promise<void> {
  const maxBytes =
    kind === 'arquivo' ? MAX_UPLOAD_BYTES : MAX_PUBLIC_PHOTO_BYTES
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024))
    throw new Error(`Arquivo muito grande (máx. ${mb} MB).`)
  }

  const ext = file.name.split('.').pop() ?? (kind === 'foto' ? 'jpg' : 'bin')
  const path = `${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (uploadError) {
    const msg = uploadError.message ?? ''
    if (
      /maximum allowed size|exceeded.*size|object.*size/i.test(msg) ||
      uploadError.message?.includes('Payload too large')
    ) {
      const maxMb = Math.round(maxBytes / (1024 * 1024))
      throw new Error(
        `Arquivo maior que o limite. Use um arquivo de até ${maxMb} MB.`,
      )
    }
    throw uploadError
  }

  const { error: insertError } = await supabase.from('ticket_files').insert({
    ticket_id: ticketId,
    uploaded_by: null,
    kind,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  })

  if (insertError) throw insertError
}

export async function listTicketFiles(ticketId: string): Promise<TicketFile[]> {
  const { data, error } = await supabase
    .from('ticket_files')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (
    data?.map((row) => {
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(row.storage_path)
      return {
        id: row.id,
        ticket_id: row.ticket_id,
        created_at: row.created_at,
        kind: row.kind,
        file_name: row.file_name,
        public_url: publicUrlData.publicUrl,
      } as TicketFile
    }) ?? []
  )
}

/** Remove um anexo (foto ou arquivo) da demanda: exclui do storage e da tabela ticket_files. */
export async function deleteTicketFile(fileId: number): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login para excluir anexos.')

  const { data: row, error: fetchError } = await supabase
    .from('ticket_files')
    .select('ticket_id, storage_path')
    .eq('id', fileId)
    .single()

  if (fetchError || !row) throw new Error('Anexo não encontrado.')

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([row.storage_path])

  if (storageError) {
    console.warn('Erro ao remover arquivo do storage:', storageError)
  }

  const { error: deleteError } = await supabase
    .from('ticket_files')
    .delete()
    .eq('id', fileId)

  if (deleteError) throw deleteError
}

function mapRowToTicket(row: any): Ticket {
  const normalizeDateOnly = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null
    const trimmed = value.trim()
    const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
    return m ? m[1] : trimmed
  }

  const impressao3d =
    row.categoria === 'servicos_3d'
      ? {
          material: (row.material_impressao ?? 'PLA') as any,
          cor: row.cor,
          quantidade_pecas: row.quantidade_pecas,
          tamanho_escala: row.tamanho_escala,
          observacoes_tecnicas: row.observacoes_tecnicas,
        }
      : undefined

  // Considera orçamento lançado quando os campos existem (não-nulos),
  // inclusive quando o valor é 0 (cortesia / sem cobrança).
  const orcamento =
    row.preco_por_peca != null && row.quantidade_orcamento != null
      ? {
          preco_por_peca: Number(row.preco_por_peca),
          quantidade: Number(row.quantidade_orcamento),
          total: Number(row.total_orcamento ?? 0),
          desconto: row.desconto ? Number(row.desconto) : null,
          observacoes: row.observacoes_orcamento,
          status: row.status_orcamento ?? 'aguardando_aprovacao',
          sem_cobranca: !!row.sem_cobranca,
        }
      : undefined

  return {
    id: row.id,
    codigo: row.codigo ?? null,
    titulo: row.titulo,
    descricao: row.descricao ?? null,
    tipo: row.tipo,
    origem: (row.origem ?? 'interno') as TicketOrigem,
    solicitante_nome: row.solicitante_nome,
    solicitante_telefone: row.solicitante_telefone ?? null,
    categoria: row.categoria,
    prioridade: row.prioridade,
    status: row.status,
    responsavel_id: row.responsavel_id ?? null,
    responsavel_nome: row.responsavel?.name ?? null,
    responsavel_avatar_url: row.responsavel?.avatar_url ?? null,
    colaborador_id: row.colaborador_id ?? null,
    data_criacao: row.data_criacao,
    data_entrega: normalizeDateOnly(row.data_entrega),
    valor_demanda: row.valor_demanda != null ? Number(row.valor_demanda) : null,
    orcamento_pago_em: row.orcamento_pago_em ?? null,
    pagamento_tipo: row.pagamento_tipo ?? null,
    pagamento_data: normalizeDateOnly(row.pagamento_data),
    pagamento_pago_em: row.pagamento_pago_em ?? null,
    receita_recorrente: !!row.receita_recorrente,
    receita_recorrente_dia_pagamento:
      row.receita_recorrente_dia_pagamento != null
        ? Number(row.receita_recorrente_dia_pagamento)
        : null,
    receita_recorrente_inicio: normalizeDateOnly(row.receita_recorrente_inicio),
    receita_recorrente_fim: normalizeDateOnly(row.receita_recorrente_fim),
    tipo_receita: row.tipo_receita ?? null,
    contrapartida_material: row.contrapartida_material ?? null,
    contrapartida_quantidade:
      row.contrapartida_quantidade != null
        ? Number(row.contrapartida_quantidade)
        : null,
    custo: row.custo != null ? Number(row.custo) : null,
    nivel_dificuldade: row.nivel_dificuldade ?? null,
    impressao3d,
    orcamento: orcamento ?? null,
    excluida_em: row.excluida_em ?? null,
  }
}

