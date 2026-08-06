import type { TicketStatus } from '../types/ticket'

const LABELS: Record<TicketStatus, string> = {
  recebida: 'Recebida',
  em_analise: 'Em análise',
  orcamento_em_criacao: 'Orçamento em criação',
  aguardando_aprovacao: 'Esperando aprovação (Pedro)',
  enviado_cliente: 'Enviado ao cliente',
  aprovado: 'Aprovado',
  em_producao: 'Em produção',
  pos_processo: 'Pós-processo',
  pronta: 'Pronta',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
}

/** Cores do design system CTP: fundo claro, texto legível, dot colorido */
const STYLES: Record<TicketStatus, { bg: string; color: string; dot: string }> = {
  recebida: { bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' },
  em_analise: { bg: '#EFF6FF', color: '#1E40AF', dot: '#3B82F6' },
  orcamento_em_criacao: { bg: '#ECFEFF', color: '#155E75', dot: '#06B6D4' },
  aguardando_aprovacao: { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B' },
  enviado_cliente: { bg: '#EEF2FF', color: '#3730A3', dot: '#6366F1' },
  aprovado: { bg: '#F0FDF4', color: '#14532D', dot: '#22C55E' },
  em_producao: { bg: '#F5F3FF', color: '#5B21B6', dot: '#8B5CF6' },
  pos_processo: { bg: '#FDF4FF', color: '#86198F', dot: '#D946EF' },
  pronta: { bg: '#F7FEE7', color: '#3F6212', dot: '#84CC16' },
  entregue: { bg: '#F0FDFA', color: '#134E4A', dot: '#14B8A6' },
  cancelada: { bg: '#FEF2F2', color: '#991B1B', dot: '#EF4444' },
}

export const STATUS_LABELS = LABELS

export function TicketStatusPill({ status }: { status: TicketStatus }) {
  const s = STYLES[status]
  return (
    <span className="badge" style={{ background: s.bg, color: s.color }}>
      <span
        style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          background: s.dot,
          display: 'inline-block',
          marginRight: '4px',
          flexShrink: 0,
        }}
      />
      {LABELS[status]}
    </span>
  )
}
