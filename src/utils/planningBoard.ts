// Regras puras da agenda de arrastar e soltar (sem imports em tempo de execução, para os testes).
// São apenas uma prévia para orientar quem arrasta: a decisão final é sempre do banco.

export interface BoardBlock { work_item_id: string; minutes: number; status: string }

/** Minutos da etapa que ainda não têm reserva. null = etapa sem estimativa. */
export function unscheduledMinutes(remaining: number | null, itemId: string, blocks: BoardBlock[]): number | null {
  if (remaining === null) return null
  const reserved = blocks
    .filter(b => b.work_item_id === itemId && (b.status === 'planned' || b.status === 'needs_reschedule'))
    .reduce((sum, b) => sum + b.minutes, 0)
  return Math.max(0, remaining - reserved)
}

export interface SlotFacts {
  /** O período é da pessoa responsável pela etapa. */
  samePerson: boolean
  /** O bloco arrastado já está neste período. */
  sameSlot: boolean
  /** Dia anterior a hoje, ou período de hoje que já terminou. */
  ended: boolean
  /** Período marcado como indisponível nos horários da pessoa. */
  closed: boolean
  /** Minutos disponíveis já descontando eventos e o tempo decorrido hoje; null = horário não configurado. */
  capacity: number | null
  /** Minutos já reservados no período, sem contar o bloco que está sendo movido. */
  reserved: number
  /** Aulas e eventos que ocupam o período. */
  events: string[]
}

export interface DropVerdict {
  ok: boolean
  /** Por que o período não aceita o bloco. */
  reason?: string
  /** Minutos livres conhecidos; null quando o horário não está configurado. */
  free: number | null
  /** Aceita, mas com ressalva. */
  warning?: string
}

function h(minutes: number): string { return `${(minutes / 60).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h` }

/**
 * kind 'block': mover um bloco de duração fixa. kind 'item': nova reserva, cuja duração é perguntada depois.
 * Nunca muda o responsável: períodos de outra pessoa são sempre recusados.
 */
export function dropVerdict(kind: 'item' | 'block', minutes: number, facts: SlotFacts): DropVerdict {
  const free = facts.capacity === null ? null : Math.max(0, facts.capacity - facts.reserved)
  const no = (reason: string): DropVerdict => ({ ok: false, reason, free })
  if (!facts.samePerson) return no('Outro responsável')
  if (facts.sameSlot) return no('Já está aqui')
  if (facts.ended) return no('Período encerrado')
  if (facts.closed) return no('Indisponível')
  if (free === null) return { ok: true, free, warning: 'Horário não configurado' }
  const busy = facts.events.length ? `Ocupado: ${facts.events.join(', ')}` : ''
  if (free === 0) return no(facts.capacity === 0 && busy ? busy : 'Sem horas livres')
  if (kind === 'block' && free < minutes) return no(`Só ${h(free)} livres${busy ? ` · ${busy.toLowerCase()}` : ''}`)
  if (kind === 'item' && free < 15) return no('Sem horas livres')
  return { ok: true, free }
}
