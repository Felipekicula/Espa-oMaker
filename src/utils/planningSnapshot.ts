import type { PlanningBlock, PlanningData, Period, WorkItem } from '../types/planning'
import { availableMinutes, dateAdd, isMissed, itemAssessment, reservedMinutes, today, weekday } from './planning'

interface SnapshotTicket { id: string; data_entrega?: string | null }
interface SnapshotTask { id: number; status: string }

export interface PersonCapacity {
  userId: string
  /** Minutos disponíveis conhecidos no horizonte, já descontando aulas e eventos. */
  available: number
  /** Reservas que cabem na disponibilidade conhecida. */
  reserved: number
  /** Reservas acima da disponibilidade conhecida. */
  excess: number
  free: number
  /** Períodos sem horário configurado: não entram em "disponível". */
  unknownPeriods: number
  reservedUnknown: number
}

export interface ShortItem { item: WorkItem; deadline: string; assessment: string }

export interface PlanningSnapshot {
  missed: { block: PlanningBlock; item: WorkItem }[]
  short: ShortItem[]
  capacity: PersonCapacity[]
  horizon: { start: string; end: string }
}

const periods: Period[] = ['manha', 'tarde']

/**
 * Leitura do planejamento para o Dashboard, com as mesmas regras da tela de Planejamento:
 * usa estimativas, reservas, horários e eventos; nunca os cronômetros.
 */
export function planningSnapshot(
  data: PlanningData, tickets: SnapshotTicket[], tasks: SnapshotTask[], userIds: string[], now = new Date(), workdays = 10,
): PlanningSnapshot {
  const activeEvents = new Set(data.events.filter(e => e.status !== 'cancelled').map(e => e.id))
  const activeTickets = new Map(tickets.map(t => [t.id, t]))
  const items = data.items
    .filter(i => i.ticket_id ? activeTickets.has(i.ticket_id) : activeEvents.has(i.event_id || ''))
    .map(i => i.ticket_task_id && tasks.find(t => t.id === i.ticket_task_id)?.status === 'concluido' ? { ...i, status: 'completed' as const } : i)
  const byId = new Map(items.map(i => [i.id, i]))
  const activeBlocks = data.blocks.filter(b => byId.get(b.work_item_id)?.status === 'pending' || b.status === 'done')

  const missed = activeBlocks
    .filter(b => byId.get(b.work_item_id)?.status === 'pending' && isMissed(b, data.availability, now))
    .map(block => ({ block, item: byId.get(block.work_item_id)! }))

  const deadlineOf = (i: WorkItem) => {
    const event = data.events.find(e => e.id === i.event_id)
    const source = i.ticket_id ? activeTickets.get(i.ticket_id)?.data_entrega : event?.preparation_deadline || event?.day
    return [i.due_date, source].filter((d): d is string => !!d).sort()[0] || null
  }
  const short: ShortItem[] = []
  for (const item of items) {
    const deadline = deadlineOf(item)
    if (item.status !== 'pending' || !deadline) continue
    const assessment = itemAssessment(item, deadline, activeBlocks, data.availability, data.events, now)
    if (assessment.startsWith('Faltam reservar') || assessment.startsWith('Não cabe')) short.push({ item, deadline, assessment })
  }
  short.sort((a, b) => a.deadline.localeCompare(b.deadline))

  const days: string[] = []
  for (let day = today(now); days.length < workdays; day = dateAdd(day, 1)) {
    if (weekday(day) >= 1 && weekday(day) <= 5) days.push(day)
  }
  const capacity = userIds.map(userId => {
    const person: PersonCapacity = { userId, available: 0, reserved: 0, excess: 0, free: 0, unknownPeriods: 0, reservedUnknown: 0 }
    for (const day of days) for (const period of periods) {
      const known = availableMinutes(userId, day, period, data.availability, data.events, now)
      const reserved = reservedMinutes(activeBlocks, userId, day, period)
      if (known === null) { person.unknownPeriods++; person.reservedUnknown += reserved; continue }
      person.available += known
      person.reserved += Math.min(reserved, known)
      person.excess += Math.max(0, reserved - known)
    }
    person.free = person.available - person.reserved
    return person
  })
  return { missed, short, capacity, horizon: { start: days[0], end: days[days.length - 1] } }
}
