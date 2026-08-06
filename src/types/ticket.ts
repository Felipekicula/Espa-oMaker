export type TicketTipo = 'interna' | 'externa'

export type TicketOrigem = 'interno' | 'formulario'

export type TicketCategoria =
  | 'servicos_3d'
  | 'reparos'
  | 'engenharia'
  | 'workshop'
  | 'sublimacao'
  | 'saude'
  | 'servicos_gerais'
  | 'outros'

export type TicketPrioridade = 'baixa' | 'media' | 'alta' | 'urgente'

export type NivelDificuldade = 'baixa' | 'media' | 'alta'

export type TicketStatus =
  | 'recebida'
  | 'em_analise'
  | 'orcamento_em_criacao'
  | 'aguardando_aprovacao'
  | 'enviado_cliente'
  | 'aprovado'
  | 'em_producao'
  | 'pos_processo'
  | 'pronta'
  | 'entregue'
  | 'cancelada'

export type OrcamentoStatus = 'aguardando_aprovacao' | 'aprovado' | 'reprovado'

export interface TicketOrcamento {
  preco_por_peca: number
  quantidade: number
  total: number
  desconto?: number | null
  observacoes?: string | null
  status: OrcamentoStatus
  sem_cobranca: boolean
}

export interface TicketImpressao3D {
  material: 'PLA' | 'TPU' | 'PETG' | 'ABS' | 'TRITAN' | 'RESINA' | 'OUTROS'
  cor?: string | null
  quantidade_pecas?: number | null
  tamanho_escala?: string | null
  observacoes_tecnicas?: string | null
}

export interface Ticket {
  id: string
  codigo?: string | null
  titulo: string
  descricao?: string | null
  tipo: TicketTipo
  origem: TicketOrigem
  solicitante_nome: string
  solicitante_telefone?: string | null
  categoria: TicketCategoria
  prioridade: TicketPrioridade
  status: TicketStatus
  responsavel_id: string | null
  responsavel_nome?: string | null
  responsavel_avatar_url?: string | null
  colaborador_id?: string | null
  colaborador_nome?: string | null
  data_criacao: string
  data_entrega?: string | null
  atraso?: boolean
  valor_demanda?: number | null
  /** Data/hora em que o orçamento foi marcado como pago (null = não pago) */
  orcamento_pago_em?: string | null
  /** Pagamento da receita monetária: 'avista' ou 'a_definir' (com data) */
  pagamento_tipo?: 'avista' | 'a_definir' | null
  /** Data prevista/definida de pagamento (YYYY-MM-DD). Se futura, não conta no relatório ainda. */
  pagamento_data?: string | null
  /** Data/hora em que o pagamento foi marcado como pago (null = a ser faturada) */
  pagamento_pago_em?: string | null
  /** Receita recorrente mensal (contabiliza automaticamente mês a mês) */
  receita_recorrente?: boolean
  /** Dia do mês (1..31) em que a receita é contabilizada */
  receita_recorrente_dia_pagamento?: number | null
  /** Início da recorrência (YYYY-MM-DD) */
  receita_recorrente_inicio?: string | null
  /** Fim da recorrência (YYYY-MM-DD) - opcional */
  receita_recorrente_fim?: string | null
  /** Receita monetária ou contrapartida (ex.: material) */
  tipo_receita?: 'monetaria' | 'contrapartida' | null
  /** Material da contrapartida quando tipo_receita = contrapartida */
  contrapartida_material?: string | null
  /** Quantidade do material na contrapartida */
  contrapartida_quantidade?: number | null
  /** Custo da demanda (para relatório de despesas e receita líquida) */
  custo?: number | null
  nivel_dificuldade?: NivelDificuldade | null
  impressao3d?: TicketImpressao3D | null
  orcamento?: TicketOrcamento | null
  /** Preenchido quando a demanda foi excluída (não aparece mais nas listas, só leitura na página) */
  excluida_em?: string | null
}

