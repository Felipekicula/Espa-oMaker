import { useCallback, useEffect, useState } from 'react'
import { allActiveTickets, allTicketTasks, busyEvents, loadPlanning, planningError } from '../services/planning'
import { listAppUsers, type AppUserOption } from '../services/appUsers'
import type { Ticket } from '../types/ticket'
import type { TicketTask } from '../services/tickets'
import type { PlanningData } from '../types/planning'

export function usePlanningData() {
  const [data, setData] = useState<PlanningData>({ events: [], items: [], blocks: [], availability: [], timeOff: [], settings: [], busy: [], assisted: false })
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [tasks, setTasks] = useState<TicketTask[]>([])
  const [users, setUsers] = useState<AppUserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [next, people, active, allTasks] = await Promise.all([loadPlanning(), listAppUsers(), allActiveTickets(), allTicketTasks()])
      setData({ ...next, busy: busyEvents(next.events, next.timeOff, people.map(p => p.id)) }); setUsers(people); setTickets(active); setTasks(allTasks); setError('')
    } catch (e) { setError(planningError(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 60000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { clearInterval(interval); window.removeEventListener('focus', focus) }
  }, [refresh])
  return { data, users, tickets, tasks, loading, error, refresh }
}
