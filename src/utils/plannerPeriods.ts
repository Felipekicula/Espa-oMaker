import type { Availability, BusySpan, Period, PlanningBlock } from '../types/planning'
import type { PeriodFacts } from './planner'
import { availableMinutes, dateAdd, reservedMinutes, today, weekday } from './planning'

/**
 * Períodos de trabalho de uma pessoa, do dia inicial em diante, com a capacidade real de cada um.
 * `busy` são eventos, feriados e ausências. `ignoreItemId` tira da conta as reservas que a própria
 * proposta vai substituir (ao revisar uma etapa que já tem blocos).
 */
export function periodsFor(
  userId: string, start: string, workdays: number, availability: Availability[], busy: BusySpan[], blocks: PlanningBlock[], now = new Date(), ignoreItemId?: string,
): PeriodFacts[] {
  const counted = ignoreItemId ? blocks.filter(b => b.work_item_id !== ignoreItemId) : blocks
  const first = start < today(now) ? today(now) : start
  const result: PeriodFacts[] = []
  for (let day = first, n = 0; n < workdays; day = dateAdd(day, 1)) {
    if (weekday(day) < 1 || weekday(day) > 5) continue
    n++
    for (const period of ['manha', 'tarde'] as Period[]) {
      result.push({
        day, period,
        capacity: availableMinutes(userId, day, period, availability, busy),
        capacityNow: availableMinutes(userId, day, period, availability, busy, now),
        reserved: reservedMinutes(counted, userId, day, period),
      })
    }
  }
  return result
}
