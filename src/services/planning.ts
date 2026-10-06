import { supabase } from '../lib/supabaseClient'
import type { Availability, BusySpan, EstimateLog, MakerEvent, Period, PersonSetting, PlanningBlock, PlanningData, TimeOff, WorkItem } from '../types/planning'
import { listTickets, type TicketTask } from './tickets'

export function planningError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  return /schema cache|does not exist|Could not find.*maker_/i.test(message)
    ? 'O módulo de planejamento precisa ser instalado no banco. Aplique supabase/migration-maker-planning.sql antes de usar esta tela.' : message
}
// Never silently truncate the team's pending work at the PostgREST page limit.
async function rows<T>(table: string): Promise<T[]> {
  const result: T[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table).select('*').order('id').range(offset, offset + 499)
    if (error) throw error
    result.push(...(data ?? []) as T[])
    if (!data || data.length < 500) return result
  }
}
export async function loadPlanning(): Promise<PlanningData> {
  const [events, items, blocks] = await Promise.all([rows<MakerEvent>('maker_events'), rows<WorkItem>('maker_work_items'), rows<PlanningBlock>('maker_blocks')])
  const { data, error } = await supabase.from('maker_availability').select('*')
  if (error) throw error
  // Tabelas do planejamento assistido: em um banco sem a migração, o resto continua funcionando.
  const [timeOff, settings] = await Promise.all([supabase.from('maker_time_off').select('*').order('day'), supabase.from('maker_person_settings').select('*')])
  const assisted = !timeOff.error && !settings.error
  const failure = timeOff.error ?? settings.error
  if (failure && !/schema cache|does not exist|Could not find/i.test(failure.message)) throw failure
  return { events, items, blocks, availability: (data ?? []) as Availability[], timeOff: (timeOff.data ?? []) as TimeOff[], settings: (settings.data ?? []) as PersonSetting[], busy: events, assisted }
}
/** Feriados e ausências viram ocupações de período inteiro, para os mesmos cálculos de capacidade dos eventos. */
export function busyEvents(events: MakerEvent[], timeOff: TimeOff[], userIds: string[]): BusySpan[] {
  return [...events, ...timeOff.map(off => ({
    day: off.day,
    starts_at: off.period === 'tarde' ? '12:00' : '00:00', ends_at: off.period === 'manha' ? '12:00' : '23:59',
    participant_ids: off.user_id ? [off.user_id] : userIds, status: 'confirmed' as const,
  }))]
}
export interface PlanPayload {
  item_id?: string; ticket_id?: string; title?: string; assignee_id: string; scope?: 'demanda' | 'etapa'
  mode: 'estimativa' | 'faixa' | 'indefinida'; work_minutes?: number | null; protection_minutes?: number
  low_minutes?: number; high_minutes?: number; review_on?: string | null; replace_from_block?: string; use_slack?: boolean; note?: string
  blocks: { day: string; period: Period; minutes: number; purpose: string }[]
}
/** Grava etapa, blocos e histórico de uma vez; o banco valida cada bloco e desfaz tudo se um for recusado. */
export async function acceptPlan(plan: PlanPayload): Promise<string> {
  const { data, error } = await supabase.rpc('maker_accept_plan', { plan })
  if (error) throw error
  return data as string
}
export async function convertToSteps(card_id: string, steps: { title: string; work_minutes: number; protection_minutes: number; assignee_id: string | null }[]) {
  const { error } = await supabase.rpc('maker_convert_to_steps', { card_id, steps })
  if (error) throw error
}
export async function listEstimateLog(work_item_id: string): Promise<EstimateLog[]> {
  const { data, error } = await supabase.from('maker_estimate_log').select('*').eq('work_item_id', work_item_id).order('created_at')
  if (error) throw error
  return (data ?? []) as EstimateLog[]
}
export async function saveSlackPercent(user_id: string, slack_percent: number) {
  const { error } = await supabase.from('maker_person_settings').upsert({ user_id, slack_percent })
  if (error) throw error
}
export async function addTimeOff(input: Omit<TimeOff, 'id'>) {
  const { error } = await supabase.from('maker_time_off').insert(input)
  if (error) throw error
}
export async function removeTimeOff(id: string) {
  const { error } = await supabase.from('maker_time_off').delete().eq('id', id)
  if (error) throw error
}
export async function allActiveTickets() {
  const result = []
  for (let offset = 0; ; offset += 500) {
    const page = await listTickets({}, { limit: 500, offset, orderBy: 'data_entrega', orderDirection: 'asc' })
    result.push(...page.tickets.filter(t => t.status !== 'entregue' && t.status !== 'cancelada'))
    if (!page.hasMore) return result
  }
}
export async function allTicketTasks(): Promise<TicketTask[]> { return rows<TicketTask>('ticket_tasks') }
export async function createEvent(input: Omit<MakerEvent, 'id' | 'series_id' | 'status'>, preparations: { title: string; assignee_id: string | null }[], occurrences: number) {
  const { data, error } = await supabase.rpc('maker_create_event', { payload: input, preparations, occurrences })
  if (error) throw error
  return data as string
}
export async function cancelEvent(id: string) {
  const { error } = await supabase.from('maker_events').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw error
}
export async function createWorkItem(input: Omit<WorkItem, 'id' | 'status'>): Promise<WorkItem> {
  const { data, error } = await supabase.from('maker_work_items').insert(input).select('*').single()
  if (error) throw error
  return data as WorkItem
}
export async function saveWorkItem(id: string, assignee_id: string, remaining_minutes: number) {
  const { error } = await supabase.from('maker_work_items').update({ assignee_id, remaining_minutes }).eq('id', id).eq('status', 'pending')
  if (error) throw error
}
export async function reserveBlock(work_item_id: string, user_id: string, day: string, period: Period, minutes: number) {
  const { error } = await supabase.from('maker_blocks').insert({ work_item_id, user_id, day, period, minutes })
  if (error) throw error
}
export async function completeItem(item_id: string, block_id: string | null) {
  const { error } = await supabase.rpc('maker_complete_item', { item_id, block_id })
  if (error) throw error
}
export async function continueBlock(block_id: string, remaining: number, slot: { day: string; period: Period; minutes: number } | null) {
  const { error } = await supabase.rpc('maker_continue_block', { block_id, remaining, new_day: slot?.day ?? null, new_period: slot?.period ?? null, new_minutes: slot?.minutes ?? null })
  if (error) throw error
}
export async function saveAvailability(user_id: string, slots: Omit<Availability, 'user_id'>[]) {
  // Include all ten rows; a closed period is represented with equal endpoints in UI, omitted in DB.
  const { error } = await supabase.rpc('maker_save_availability', { person_id: user_id, slots })
  if (error) throw error
}

export async function allDashboardTickets() {
  const result = []
  for (let offset = 0; ; offset += 500) {
    const page = await listTickets({ includeCancelada: true }, { limit: 500, offset, orderBy: 'data_entrega', orderDirection: 'asc' })
    result.push(...page.tickets)
    if (!page.hasMore) return { tickets: result }
  }
}
