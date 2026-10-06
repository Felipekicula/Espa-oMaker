export type Period = 'manha' | 'tarde'
export interface MakerEvent {
  id: string; title: string; kind: 'aula' | 'workshop' | 'reuniao'
  day: string; starts_at: string; ends_at: string; location: string | null
  participant_ids: string[]; preparation_deadline: string | null
  series_id: string | null; status: 'confirmed' | 'cancelled' | 'completed'
}
export interface WorkItem {
  id: string; title: string; ticket_id: string | null; event_id: string | null
  ticket_task_id: number | null; assignee_id: string | null
  remaining_minutes: number | null; due_date: string | null
  status: 'pending' | 'completed'
  // Planejamento assistido (migration-maker-assisted-planning.sql). Ausentes em bancos sem essa migração.
  scope?: 'etapa' | 'demanda'; estimate_mode?: 'estimativa' | 'faixa' | 'indefinida' | null
  work_minutes?: number | null; protection_minutes?: number; review_on?: string | null; converted_at?: string | null
}
export interface PlanningBlock {
  id: string; work_item_id: string; user_id: string; day: string; period: Period
  minutes: number; status: 'planned' | 'done' | 'needs_reschedule' | 'superseded' | 'cancelled'
  predecessor_id: string | null
  purpose?: 'trabalho' | 'protecao' | 'investigacao'
}
export interface Availability {
  user_id: string; weekday: number; period: Period
  starts_at: string; ends_at: string
}
/** O que tira capacidade de um período: um evento, um feriado ou uma ausência. */
export type BusySpan = Pick<MakerEvent, 'day' | 'starts_at' | 'ends_at' | 'participant_ids' | 'status'>
/** Feriado (user_id nulo = toda a equipe) ou ausência. period nulo = dia inteiro. */
export interface TimeOff { id: string; user_id: string | null; day: string; period: Period | null; reason: string }
export interface PersonSetting { user_id: string; slack_percent: number }
export interface EstimateLog {
  id: string; work_item_id: string; created_at: string; created_by: string
  reason: 'inicial' | 'revisao' | 'transformacao' | 'folga'; mode: WorkItem['estimate_mode']
  work_minutes: number | null; protection_minutes: number | null; low_minutes: number | null; high_minutes: number | null
  review_on: string | null; note: string | null
}
export interface PlanningData {
  events: MakerEvent[]; items: WorkItem[]; blocks: PlanningBlock[]; availability: Availability[]
  timeOff: TimeOff[]; settings: PersonSetting[]
  /** Eventos mais feriados e ausências: tudo o que tira capacidade. Use nos cálculos; events é só o que se lista. */
  busy: BusySpan[]
  /** false quando o banco ainda não recebeu a migração do planejamento assistido. */
  assisted: boolean
}
export const DEFAULT_SLACK_PERCENT = 20
