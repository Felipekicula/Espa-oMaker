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
}
export interface PlanningBlock {
  id: string; work_item_id: string; user_id: string; day: string; period: Period
  minutes: number; status: 'planned' | 'done' | 'needs_reschedule' | 'superseded' | 'cancelled'
  predecessor_id: string | null
}
export interface Availability {
  user_id: string; weekday: number; period: Period
  starts_at: string; ends_at: string
}
export interface PlanningData {
  events: MakerEvent[]; items: WorkItem[]; blocks: PlanningBlock[]; availability: Availability[]
}
