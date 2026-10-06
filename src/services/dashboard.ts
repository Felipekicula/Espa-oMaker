import { supabase } from '../lib/supabaseClient'

export interface DeliveryDates {
  /** false quando a coluna tickets.entregue_em ainda não existe no banco. */
  available: boolean
  /** id da demanda -> instante em que passou para "entregue". */
  byTicket: Map<string, string>
}

/**
 * Datas reais de entrega (tickets.entregue_em). Consulta separada de listTickets para o
 * Dashboard continuar abrindo em um banco que ainda não recebeu migration-ticket-entregue-em.sql.
 */
export async function loadDeliveryDates(): Promise<DeliveryDates> {
  const byTicket = new Map<string, string>()
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('tickets')
      .select('id, entregue_em')
      .eq('status', 'entregue')
      .is('excluida_em', null)
      .order('id')
      .range(offset, offset + 499)
    if (error) {
      if (/entregue_em|column .* does not exist|schema cache/i.test(error.message)) return { available: false, byTicket }
      throw error
    }
    for (const row of (data ?? []) as { id: string; entregue_em: string | null }[]) {
      if (row.entregue_em) byTicket.set(row.id, row.entregue_em)
    }
    if (!data || data.length < 500) return { available: true, byTicket }
  }
}
