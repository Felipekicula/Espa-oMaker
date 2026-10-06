// Planejamento assistido: cálculo puro da proposta (sem rede e sem imports em tempo de execução,
// para os testes e para gerar os exemplos da documentação com o mesmo algoritmo da tela).
// A proposta é uma previsão de trabalho humano; quem decide se cabe de fato é o banco, ao aceitar.

export type Purpose = 'trabalho' | 'protecao' | 'investigacao'
export type EstimateMode = 'estimativa' | 'faixa' | 'indefinida'

/** Um período de trabalho de uma pessoa. capacity nulo = horário não configurado (desconhecido). */
export interface PeriodFacts {
  day: string
  period: 'manha' | 'tarde'
  /** Capacidade do período inteiro: horário menos feriados, ausências e eventos. Base da folga. */
  capacity: number | null
  /** O que ainda resta do período agora (só difere de capacity no dia de hoje). */
  capacityNow: number | null
  /** Tudo o que já está reservado no período, de qualquer cartão. */
  reserved: number
}
export interface PlannedBlock { day: string; period: 'manha' | 'tarde'; minutes: number; purpose: Purpose; slackUsed: number }
export interface Allocation {
  blocks: PlannedBlock[]
  placed: number
  /** Minutos que não couberam nos períodos conhecidos. Nunca se inventa disponibilidade. */
  unplaced: number
  end: { day: string; period: 'manha' | 'tarde' } | null
  slackUsed: number
  slackPeriods: number
}
export interface Scenario {
  key: 'so_estimativa' | 'com_margem' | 'proposta' | 'menor' | 'maior'
  label: string
  minutes: number
  allocation: Allocation
  /** Dias úteis de sobra (positivo) ou de atraso (negativo) frente ao prazo; nulo sem prazo ou sem conclusão. */
  workdaysVsDeadline: number | null
}
export interface ProposalInput {
  mode: EstimateMode
  workMinutes?: number
  marginPercent?: number
  lowMinutes?: number
  highMinutes?: number
  investigationMinutes?: number
  periods: PeriodFacts[]
  slackPercent: number
  useSlack?: boolean
  /** Períodos que a pessoa desmarcou, no formato "dia|periodo". */
  skip?: string[]
  deadline: string | null
}
export interface Proposal {
  mode: EstimateMode
  workMinutes: number | null
  protectionMinutes: number
  plan: Allocation
  scenarios: Scenario[]
  /** Minutos do plano até o prazo (inclusive) e depois dele. Sem prazo, tudo conta como "até". */
  beforeDeadline: number
  afterDeadline: number
  /** Períodos sem horário configurado encontrados até a conclusão; ficaram fora da conta. */
  unknownPeriods: number
}

const STEP = 15, MIN_BLOCK = 30
const floorStep = (minutes: number) => Math.floor(minutes / STEP) * STEP
const ceilStep = (minutes: number) => Math.ceil(minutes / STEP) * STEP
function shift(day: string, count: number): string { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10) }
function isWorkday(day: string): boolean { const w = new Date(day + 'T12:00:00Z').getUTCDay(); return w >= 1 && w <= 5 }

/** Quanto do período pode ser ocupado sem tocar na folga protegida. Mesmo arredondamento do banco. */
export function slackLimit(capacity: number, percent: number): number { return floorStep(capacity * (100 - percent) / 100) }

/**
 * Minutos que uma proposta pode usar no período. A folga vale para a ocupação TOTAL do período:
 * desconta-se tudo o que já está reservado, e não só uma fração do que sobrou.
 */
export function usableMinutes(facts: PeriodFacts, percent: number, useSlack = false): number {
  if (facts.capacity === null || facts.capacityNow === null) return 0
  const ceiling = useSlack ? facts.capacity : slackLimit(facts.capacity, percent)
  return Math.max(0, floorStep(Math.min(ceiling - facts.reserved, facts.capacityNow - facts.reserved)))
}

/** Folga protegida que uma reserva de `minutes` consumiria neste período. */
export function slackUse(facts: PeriodFacts, percent: number, minutes: number): number {
  if (facts.capacity === null) return 0
  const limit = slackLimit(facts.capacity, percent)
  return Math.max(0, facts.reserved + minutes - limit) - Math.max(0, facts.reserved - limit)
}

/** Preenche do período mais cedo para o mais tarde. `parts` separa trabalho de proteção. */
export function allocate(periods: PeriodFacts[], parts: { minutes: number; purpose: Purpose }[], options: { slackPercent: number; useSlack?: boolean; skip?: string[] }): Allocation {
  const queue = parts.filter(p => p.minutes > 0).map(p => ({ ...p }))
  const skip = new Set(options.skip ?? [])
  const result: Allocation = { blocks: [], placed: 0, unplaced: 0, end: null, slackUsed: 0, slackPeriods: 0 }
  let left = queue.reduce((sum, p) => sum + p.minutes, 0)
  for (const facts of periods) {
    if (left <= 0) break
    if (skip.has(facts.day + '|' + facts.period)) continue
    const room = usableMinutes(facts, options.slackPercent, options.useSlack)
    // Evita blocos de poucos minutos, a não ser que seja exatamente o que falta.
    if (room < Math.min(MIN_BLOCK, left)) continue
    let take = Math.min(room, left), reserved = facts.reserved, usedHere = 0
    while (take > 0 && queue.length) {
      const part = queue[0], minutes = Math.min(part.minutes, take)
      const slack = slackUse({ ...facts, reserved }, options.slackPercent, minutes)
      result.blocks.push({ day: facts.day, period: facts.period, minutes, purpose: part.purpose, slackUsed: slack })
      part.minutes -= minutes; take -= minutes; left -= minutes; reserved += minutes; usedHere += slack; result.placed += minutes
      if (part.minutes === 0) queue.shift()
    }
    result.end = { day: facts.day, period: facts.period }
    if (usedHere > 0) { result.slackUsed += usedHere; result.slackPeriods++ }
  }
  result.unplaced = left
  if (left > 0) result.end = null // sem conclusão: parte do trabalho não tem lugar conhecido
  return result
}

/** Dias úteis entre a conclusão e o prazo: positivo = sobra, negativo = depois do prazo. */
export function workdaysVsDeadline(endDay: string | null, deadline: string | null): number | null {
  if (!endDay || !deadline) return null
  const late = endDay > deadline, from = late ? deadline : endDay, to = late ? endDay : deadline
  let count = 0
  for (let day = shift(from, 1); day <= to; day = shift(day, 1)) if (isWorkday(day)) count++
  return late ? -count : count
}

export function propose(input: ProposalInput): Proposal {
  const base = { slackPercent: input.slackPercent, useSlack: input.useSlack, skip: input.skip }
  const noSlack = { slackPercent: 0, skip: input.skip }
  const scenario = (key: Scenario['key'], label: string, minutes: number, allocation: Allocation): Scenario =>
    ({ key, label, minutes, allocation, workdaysVsDeadline: workdaysVsDeadline(allocation.end?.day ?? null, input.deadline) })
  let workMinutes: number | null = null, protectionMinutes = 0, plan: Allocation, scenarios: Scenario[] = []

  if (input.mode === 'estimativa') {
    workMinutes = ceilStep(input.workMinutes ?? 0)
    protectionMinutes = ceilStep(workMinutes * (input.marginPercent ?? 0) / 100)
    const parts = [{ minutes: workMinutes, purpose: 'trabalho' as const }, { minutes: protectionMinutes, purpose: 'protecao' as const }]
    plan = allocate(input.periods, parts, base)
    scenarios = [
      scenario('so_estimativa', 'Só a estimativa', workMinutes, allocate(input.periods, [parts[0]], noSlack)),
      scenario('com_margem', 'Com a margem', workMinutes + protectionMinutes, allocate(input.periods, parts, noSlack)),
      scenario('proposta', 'Com a margem e a folga', workMinutes + protectionMinutes, plan),
    ]
  } else if (input.mode === 'faixa') {
    workMinutes = ceilStep(input.lowMinutes ?? 0)
    protectionMinutes = Math.max(0, ceilStep(input.highMinutes ?? 0) - workMinutes)
    const parts = [{ minutes: workMinutes, purpose: 'trabalho' as const }, { minutes: protectionMinutes, purpose: 'protecao' as const }]
    plan = allocate(input.periods, parts, base)
    scenarios = [
      scenario('menor', 'Se for o cenário menor', workMinutes, allocate(input.periods, [parts[0]], base)),
      scenario('maior', 'Se for o cenário maior', workMinutes + protectionMinutes, plan),
    ]
  } else {
    // "Não sei ainda": só um bloco de investigação, de preferência inteiro em um período.
    const minutes = ceilStep(input.investigationMinutes ?? 0)
    const skip = new Set(input.skip ?? [])
    const whole = input.periods.find(p => !skip.has(p.day + '|' + p.period) && usableMinutes(p, input.slackPercent, input.useSlack) >= minutes)
    plan = allocate(whole ? [whole] : input.periods, [{ minutes, purpose: 'investigacao' }], base)
  }

  let beforeDeadline = 0, afterDeadline = 0
  for (const block of plan.blocks) { if (input.deadline && block.day > input.deadline) afterDeadline += block.minutes; else beforeDeadline += block.minutes }
  const lastDay = plan.end?.day ?? input.periods[input.periods.length - 1]?.day ?? ''
  const unknownPeriods = input.periods.filter(p => p.capacity === null && p.day <= lastDay).length
  return { mode: input.mode, workMinutes, protectionMinutes, plan, scenarios, beforeDeadline, afterDeadline, unknownPeriods }
}

/** Junta, para exibir, os pedaços de trabalho e proteção que caíram no mesmo período. */
export function blocksByPeriod(blocks: PlannedBlock[]): { day: string; period: 'manha' | 'tarde'; minutes: number; parts: PlannedBlock[] }[] {
  const groups: { day: string; period: 'manha' | 'tarde'; minutes: number; parts: PlannedBlock[] }[] = []
  for (const block of blocks) {
    const last = groups[groups.length - 1]
    if (last && last.day === block.day && last.period === block.period) { last.minutes += block.minutes; last.parts.push(block) }
    else groups.push({ day: block.day, period: block.period, minutes: block.minutes, parts: [block] })
  }
  return groups
}
