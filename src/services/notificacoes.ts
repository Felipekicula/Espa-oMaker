import { supabase } from '../lib/supabaseClient'

export interface ResumoSemanalResultado {
  ok: boolean
  enviadoPara: string[]
  totalAtrasadas: number
  totalSemana: number
  pessoas: number
}

/**
 * Dispara o envio do resumo semanal de demandas para a chefe (endpoint
 * serverless /api/resumo-semanal). Envia o token do usuário logado para
 * autorização. Só funciona no deploy da Vercel (localmente não há a função).
 */
export async function enviarResumoSemanal(): Promise<ResumoSemanalResultado> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token

  const res = await fetch('/api/resumo-semanal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  const contentType = res.headers.get('content-type') || ''
  const texto = await res.text()

  // Sem a função serverless (ex.: rodando localmente), a resposta não é JSON.
  if (!contentType.includes('application/json')) {
    throw new Error(
      'O envio só funciona no site publicado (Vercel). Localmente a função de email não está disponível.',
    )
  }

  let corpo: unknown = null
  try {
    corpo = texto ? JSON.parse(texto) : null
  } catch {
    throw new Error('Resposta inválida do servidor ao enviar o resumo.')
  }

  if (!res.ok) {
    const msg =
      corpo && typeof corpo === 'object' && 'error' in corpo
        ? String((corpo as { error: unknown }).error)
        : 'Falha ao enviar o resumo.'
    throw new Error(msg)
  }

  return corpo as ResumoSemanalResultado
}
