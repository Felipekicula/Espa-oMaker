// Cálculos puros do Dashboard (sem rede e sem imports em tempo de execução, para os testes).
export const TIMEZONE = 'America/Sao_Paulo'

export type Granularity = 'week' | 'month'
export type Punctuality = 'no_prazo' | 'fora_do_prazo' | 'sem_prazo'

export interface DeliveryTicket {
  id: string
  status: string
  data_entrega?: string | null
}

export interface DeliveryBucket {
  key: string
  label: string
  noPrazo: string[]
  foraDoPrazo: string[]
  semPrazo: string[]
  total: number
}

export interface DeliverySummary {
  buckets: DeliveryBucket[]
  /** Entregues dentro do período, com data de entrega registrada. */
  delivered: string[]
  noPrazo: string[]
  foraDoPrazo: string[]
  /** Entregues no período, mas sem prazo cadastrado: fora do cálculo de pontualidade. */
  semPrazo: string[]
  /** Status entregue sem data de entrega registrada: não dá para situar em nenhum período. */
  semDataEntrega: string[]
  /** Percentual no prazo sobre as entregas com prazo e data; null quando não há nenhuma. */
  percentNoPrazo: number | null
}

function shift(day: string, count: number): string {
  const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10)
}

/** Dia local (America/Sao_Paulo) de um instante gravado pelo banco. */
export function localDay(timestamp: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp))
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-')
}

export function periodStart(today: string, days: number): string { return shift(today, -(days - 1)) }

export function granularityFor(days: number): Granularity { return days <= 90 ? 'week' : 'month' }

export function bucketKey(day: string, granularity: Granularity): string {
  if (granularity === 'month') return day.slice(0, 7)
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay()
  return shift(day, -((weekday + 6) % 7))
}

export function bucketLabel(key: string, granularity: Granularity): string {
  if (granularity === 'week') return `${key.slice(8, 10)}/${key.slice(5, 7)}`
  const month = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(key.slice(5, 7)) - 1]
  return `${month}/${key.slice(2, 4)}`
}

export function bucketKeys(start: string, end: string, granularity: Granularity): string[] {
  const keys: string[] = []
  for (let day = start; day <= end; day = shift(day, 1)) {
    const key = bucketKey(day, granularity)
    if (keys[keys.length - 1] !== key) keys.push(key)
  }
  return keys
}

/** Compara o dia da entrega com o prazo ATUALMENTE cadastrado (não há histórico de alterações de prazo). */
export function punctuality(prazo: string | null | undefined, deliveredDay: string): Punctuality {
  if (!prazo) return 'sem_prazo'
  return deliveredDay <= prazo.slice(0, 10) ? 'no_prazo' : 'fora_do_prazo'
}

export function isOverdue(ticket: DeliveryTicket, today: string): boolean {
  return !!ticket.data_entrega && ticket.status !== 'entregue' && ticket.status !== 'cancelada' && ticket.data_entrega.slice(0, 10) < today
}

/**
 * Só o status "entregue" conta como entrega ("pronta" não), e só com entregue_em registrado.
 * deliveredAt: id da demanda -> instante da entrega.
 */
export function summarizeDeliveries(
  tickets: DeliveryTicket[], deliveredAt: Map<string, string>, start: string, end: string, granularity: Granularity,
): DeliverySummary {
  const buckets = new Map<string, DeliveryBucket>(bucketKeys(start, end, granularity).map(key => [key, { key, label: bucketLabel(key, granularity), noPrazo: [], foraDoPrazo: [], semPrazo: [], total: 0 }]))
  const summary: DeliverySummary = { buckets: [], delivered: [], noPrazo: [], foraDoPrazo: [], semPrazo: [], semDataEntrega: [], percentNoPrazo: null }
  for (const ticket of tickets) {
    if (ticket.status !== 'entregue') continue
    const at = deliveredAt.get(ticket.id)
    if (!at) { summary.semDataEntrega.push(ticket.id); continue }
    const day = localDay(at)
    if (day < start || day > end) continue
    const bucket = buckets.get(bucketKey(day, granularity))
    if (!bucket) continue
    const result = punctuality(ticket.data_entrega, day)
    const field = result === 'no_prazo' ? 'noPrazo' : result === 'fora_do_prazo' ? 'foraDoPrazo' : 'semPrazo'
    bucket[field].push(ticket.id); bucket.total++
    summary[field].push(ticket.id); summary.delivered.push(ticket.id)
  }
  summary.buckets = [...buckets.values()]
  const counted = summary.noPrazo.length + summary.foraDoPrazo.length
  summary.percentNoPrazo = counted ? Math.round(summary.noPrazo.length / counted * 100) : null
  return summary
}
