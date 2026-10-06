import { supabase } from '../lib/supabaseClient'
import type { Availability, MakerEvent, Period, PlanningBlock, PlanningData, WorkItem } from '../types/planning'
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
  return { events, items, blocks, availability: (data ?? []) as Availability[] }
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
