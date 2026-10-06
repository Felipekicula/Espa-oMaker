import type { Availability, BusySpan, Period, PlanningBlock, WorkItem } from '../types/planning'
export const TIMEZONE = 'America/Sao_Paulo'
export function today(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-')
}
export function timeMinutes(time: string): number { const [h, m] = time.split(':').map(Number); return h * 60 + m }
export function dateAdd(day: string, count: number): string {
  const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10)
}
export function weekday(day: string): number { return new Date(day + 'T12:00:00Z').getUTCDay() }
export function mondayOf(day: string): string { return dateAdd(day, -((weekday(day) + 6) % 7)) }
export function formatDay(day: string): string { return new Date(day + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' }) }
/** 435 -> "7h15", 120 -> "2h", 45 -> "45min". */
export function hours(minutes: number): string { const total = Math.round(minutes), whole = Math.floor(total / 60), rest = total % 60; return whole === 0 && rest ? `${rest}min` : `${whole}h${rest ? String(rest).padStart(2, '0') : ''}` }
export function isMissed(block: PlanningBlock, availability: Availability[], now = new Date()): boolean {
  if (block.status === 'needs_reschedule') return true
  if (block.status !== 'planned') return false
  const day = today(now)
  if (block.day < day) return true
  if (block.day > day) return false
  const slot = availability.find(a => a.user_id === block.user_id && a.weekday === weekday(day) && a.period === block.period)
  if (!slot) return false // Without confirmed end time, highlight after the day ends.
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  return timeMinutes(clock) >= timeMinutes(slot.ends_at)
}
// Merge intervals so concurrent events do not subtract the same minutes twice.
export function availableMinutes(userId: string, day: string, period: Period, availability: Availability[], events: BusySpan[], now?: Date): number | null {
  const slot = availability.find(a => a.user_id === userId && a.weekday === weekday(day) && a.period === period)
  if (!slot) return null
  let start = timeMinutes(slot.starts_at); const end = timeMinutes(slot.ends_at)
  if (now) {
    if (day < today(now)) return 0
    if (day === today(now)) {
      const clock = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
      start = Math.max(start, timeMinutes(clock))
    }
  }
  if (start >= end) return 0
  const intervals = events.filter(e => e.day === day && e.status === 'confirmed' && e.participant_ids.includes(userId))
    .map(e => [Math.max(start, timeMinutes(e.starts_at)), Math.min(end, timeMinutes(e.ends_at))])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  let busy = 0, previousEnd = start
  for (const [a, b] of intervals) { busy += Math.max(0, b - Math.max(a, previousEnd)); previousEnd = Math.max(previousEnd, b) }
  return end - start - busy
}
export function reservedMinutes(blocks: PlanningBlock[], userId: string, day: string, period: Period, excludeId?: string): number {
  return blocks.filter(b => b.id !== excludeId && b.user_id === userId && b.day === day && b.period === period && b.status === 'planned').reduce((sum, b) => sum + b.minutes, 0)
}
export function slotsFor(userId: string, remaining: number, deadline: string | null, availability: Availability[], events: BusySpan[], blocks: PlanningBlock[], now = new Date(), excludeId?: string) {
  const untilDeadline = deadline ? Math.ceil((new Date(deadline+'T12:00:00Z').getTime() - new Date(today(now)+'T12:00:00Z').getTime()) / 86400000) : 0
  const horizon = Math.min(366, Math.max(21, untilDeadline + 8))
  return Array.from({ length: horizon }, (_, i) => dateAdd(today(now), i)).filter(d => weekday(d) >= 1 && weekday(d) <= 5)
    .flatMap(day => (['manha', 'tarde'] as Period[]).map(period => {
      const capacity = availableMinutes(userId, day, period, availability, events, now)
      const free = capacity === null ? null : Math.max(0, capacity - reservedMinutes(blocks, userId, day, period, excludeId))
      return { day, period, free, fits: free !== null && free >= remaining, afterDeadline: !!deadline && day > deadline }
    })).sort((a, b) => Number(a.afterDeadline) - Number(b.afterDeadline) || Number(b.fits) - Number(a.fits) || a.day.localeCompare(b.day) || a.period.localeCompare(b.period))
}
export function itemAssessment(item: WorkItem, deadline: string | null, blocks: PlanningBlock[], availability: Availability[], events: BusySpan[], now = new Date()) {
  if (item.status === 'completed') return 'Etapa concluída'
  if (blocks.some(b => b.work_item_id === item.id && isMissed(b, availability, now))) return 'Precisa remanejar'
  if (!deadline) return 'Definir prazo'
  if (deadline < today(now)) return 'Prazo ultrapassado'
  if (item.remaining_minutes === null || !item.assignee_id) return 'Ainda não sabemos'
  const planned = blocks.filter(b => b.work_item_id === item.id && b.status === 'planned' && b.day >= today(now) && b.day <= deadline)
  const reserved = planned.reduce((sum, b) => sum + b.minutes, 0)
  const checked = planned.every(b => {
    const cap = availableMinutes(b.user_id, b.day, b.period, availability, events, now)
    return cap !== null && reservedMinutes(blocks, b.user_id, b.day, b.period) <= cap
  })
  if (reserved >= item.remaining_minutes) return checked ? 'Tempo reservado · conferir execução' : 'Reserva com disponibilidade a confirmar'
  const deficit = item.remaining_minutes - reserved
  let freeBeforeDeadline = 0, unknown = false
  for (let day = today(now), n = 0; day <= deadline && n < 366; day = dateAdd(day,1), n++) {
    if (weekday(day) < 1 || weekday(day) > 5) continue
    for (const period of ['manha','tarde'] as Period[]) {
      const cap = availableMinutes(item.assignee_id,day,period,availability,events,now)
      if (cap === null) unknown = true
      else freeBeforeDeadline += Math.max(0,cap - reservedMinutes(blocks,item.assignee_id,day,period))
    }
    if (n === 365 && day < deadline) unknown = true
  }
  if (!unknown && freeBeforeDeadline < deficit) return `Não cabe: faltam ${hours(deficit)}, há ${hours(freeBeforeDeadline)} livres antes do prazo`
  return `Faltam reservar ${hours(deficit)}${unknown ? ' · disponibilidade a confirmar' : ''}`
}
