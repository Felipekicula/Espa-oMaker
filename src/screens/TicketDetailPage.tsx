import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { LayoutShell } from '../components/LayoutShell'
import { TicketStatusPill } from '../components/TicketStatusPill'
import type {
  Ticket,
  TicketStatus,
  TicketCategoria,
  TicketPrioridade,
} from '../types/ticket'
import {
  addComment,
  listComments,
  listTicketFiles,
  updateTicketStatus,
  updateTicketDados,
  uploadTicketFile,
  deleteTicketFile,
  getTicket,
  setTicketExcluida,
  setTicketPagamentoPago,
  listTicketTasks,
  createTicketTask,
  updateTicketTaskStatus,
  updateTicketTaskResponsavel,
  updateTicketTask,
  deleteTicketTask,
  updateTicketResponsavel,
} from '../services/tickets'
import {
  getActiveSessionForUser,
  startWorkSession,
  endWorkSession,
} from '../services/workSessions'
import { createFeedPost } from '../services/feed'
import { listAppUsers } from '../services/appUsers'
import type { AppUserOption } from '../services/appUsers'
import type {
  TicketComment,
  TicketFile,
  TicketTask,
  TicketTaskStatus,
} from '../services/tickets'
import { useAuth } from '../auth/AuthContext'
import { CATEGORIAS } from '../constants/ticketOptions'
import { CategorySelect } from '../components/CategorySelect'
import { MaterialSelect } from '../components/MaterialSelect'
import { UserAvatar } from '../components/UserAvatar'

const STATUS_LABELS: Record<TicketStatus, string> = {
  recebida: 'Recebida',
  em_analise: 'Em análise',
  orcamento_em_criacao: 'Orçamento em criação',
  aguardando_aprovacao: 'Esperando aprovação (Pedro)',
  enviado_cliente: 'Enviado ao cliente',
  aprovado: 'Orçamento aprovado',
  em_producao: 'Em produção',
  pos_processo: 'Pós-processo',
  pronta: 'Pronta',
  entregue: 'Entregue (finalizado)',
  cancelada: 'Cancelada',
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [comments, setComments] = useState<TicketComment[]>([])
  const [commentText, setCommentText] = useState('')

  const [files, setFiles] = useState<TicketFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null)
  const [activeWorkSession, setActiveWorkSession] = useState<{
    ticket_id: string
  } | null>(null)
  const [workSessionLoading, setWorkSessionLoading] = useState(false)
  const [responsavelTriagemId, setResponsavelTriagemId] = useState<string>('')
  const [savingResponsavel, setSavingResponsavel] = useState(false)
  const [savingPagamento, setSavingPagamento] = useState(false)

  const [tasks, setTasks] = useState<TicketTask[]>([])
  const [appUsers, setAppUsers] = useState<AppUserOption[]>([])
  const [showNewTaskForm, setShowNewTaskForm] = useState(false)
  const [taskTitulo, setTaskTitulo] = useState('')
  const [taskDescricao, setTaskDescricao] = useState('')
  const [taskResponsavelId, setTaskResponsavelId] = useState<string>('')
  const [savingTask, setSavingTask] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [editTaskTitulo, setEditTaskTitulo] = useState('')
  const [editTaskDescricao, setEditTaskDescricao] = useState('')

  const { appUser } = useAuth()
  const isFelipe = appUser?.role === 'felipe'
  const isExecutor = appUser?.role === 'executor'
  const isResponsavelOuColaborador = (t: Ticket) =>
    t.responsavel_id === appUser?.id || t.colaborador_id === appUser?.id

  const podeEditarDados = (t: Ticket) =>
    !t.excluida_em && (isFelipe || (isExecutor && isResponsavelOuColaborador(t)))
  const [editingDados, setEditingDados] = useState(false)
  const [savingDados, setSavingDados] = useState(false)
  const [formDados, setFormDados] = useState({
    titulo: '',
    descricao: '',
    solicitante_nome: '',
    solicitante_telefone: '',
    categoria: 'servicos_3d' as TicketCategoria,
    prioridade: 'media' as TicketPrioridade,
    data_entrega: '',
    material_impressao: '',
    cor: '',
    quantidade_pecas: '' as number | '',
    tamanho_escala: '',
    observacoes_tecnicas: '',
    valor_demanda: '' as number | '',
    pagamento_tipo: 'avista' as 'avista' | 'a_definir',
    pagamento_data: '',
    receita_recorrente: false,
    receita_recorrente_dia_pagamento: '' as number | '',
    receita_recorrente_inicio: '',
    receita_recorrente_fim: '',
    tipo_receita: 'monetaria' as 'monetaria' | 'contrapartida',
    contrapartida_material: '',
    contrapartida_quantidade: '' as number | '',
    custo: '' as number | '',
  })

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await getTicket(id)
        if (!data) {
          setError('Demanda não encontrada.')
          setTicket(null)
          return
        }
        setTicket(data)
        const [c, f, t, users] = await Promise.all([
          listComments(id),
          listTicketFiles(id),
          listTicketTasks(id),
          listAppUsers(),
        ])
        setComments(c)
        setFiles(f)
        setTasks(t)
        setAppUsers(users)
        if (appUser?.id) {
          const session = await getActiveSessionForUser(appUser.id)
          setActiveWorkSession(session ? { ticket_id: session.ticket_id } : null)
        } else {
          setActiveWorkSession(null)
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Erro ao carregar demanda.'
        setError(message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, appUser?.id])

  useEffect(() => {
    setResponsavelTriagemId(ticket?.responsavel_id ?? '')
  }, [ticket?.id, ticket?.responsavel_id])

  const statusPermitePlayPause =
    ticket &&
    ticket.status !== 'entregue' &&
    ticket.status !== 'cancelada' &&
    !ticket.excluida_em

  const handlePlayWork = async () => {
    if (!id || !appUser) return
    setWorkSessionLoading(true)
    setError(null)
    try {
      await startWorkSession(id, appUser.id)
      await createFeedPost(
        {
          tipo: 'atualizacao',
          conteudo: `${appUser.name} está trabalhando nesta demanda.`,
          ticket_id: id,
        },
        appUser.id,
      )
      setActiveWorkSession({ ticket_id: id })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao iniciar sessão de trabalho.'
      setError(message)
    } finally {
      setWorkSessionLoading(false)
    }
  }

  const handlePauseWork = async () => {
    if (!appUser) return
    setWorkSessionLoading(true)
    setError(null)
    try {
      await endWorkSession(appUser.id)
      setActiveWorkSession(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao pausar sessão de trabalho.'
      setError(message)
    } finally {
      setWorkSessionLoading(false)
    }
  }

  const handleStatusChange = async (next: TicketStatus) => {
    if (!id) return
    setError(null)
    try {
      const updated = await updateTicketStatus(id, {
        status: next,
      })
      setTicket(updated)
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as Error).message)
          : 'Erro ao atualizar status.'
      setError(message)
    }
  }

  const handleDefinirResponsavel = async () => {
    if (!id) return
    setSavingResponsavel(true)
    setError(null)
    try {
      const updated = await updateTicketResponsavel(id, {
        responsavel_id: responsavelTriagemId || null,
      })
      setTicket(updated)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao definir responsável.'
      setError(message)
    } finally {
      setSavingResponsavel(false)
    }
  }

  const handleTogglePagamentoPago = async (pago: boolean) => {
    if (!id) return
    setSavingPagamento(true)
    setError(null)
    try {
      const updated = await setTicketPagamentoPago(id, pago)
      setTicket(updated)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao atualizar pagamento.'
      setError(message)
    } finally {
      setSavingPagamento(false)
    }
  }

  const handleCommentSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!id || !commentText.trim()) return
    if (!appUser) {
      setError('Faça login para enviar comentários.')
      return
    }
    try {
      await addComment(id, commentText.trim(), appUser.id)
      setCommentText('')
      const data = await listComments(id)
      setComments(data)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao enviar comentário.'
      setError(message)
    }
  }

  const TASK_STATUS_LABELS: Record<TicketTaskStatus, string> = {
    pendente: 'Pendente',
    em_producao: 'Em produção',
    concluido: 'Concluído',
  }

  const handleCreateTask = async (event: FormEvent) => {
    event.preventDefault()
    const responsavelId = taskResponsavelId || appUser?.id
    if (!id || !appUser || !taskTitulo.trim() || !responsavelId) return
    setSavingTask(true)
    try {
      const newTask = await createTicketTask(id, {
        titulo: taskTitulo.trim(),
        descricao: taskDescricao.trim() || null,
        responsavel_id: responsavelId,
      })
      setTasks((prev) => [...prev, newTask])
      setTaskTitulo('')
      setTaskDescricao('')
      setTaskResponsavelId(appUser.id)
      setShowNewTaskForm(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao criar task.'
      setError(message)
    } finally {
      setSavingTask(false)
    }
  }

  const handleTaskStatusChange = async (taskId: number, status: TicketTaskStatus) => {
    try {
      await updateTicketTaskStatus(taskId, status)
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status } : t)),
      )
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao atualizar status.'
      setError(message)
    }
  }

  const handleTaskResponsavelChange = async (taskId: number, responsavel_id: string) => {
    const user = appUsers.find((u) => u.id === responsavel_id)
    const nome = user?.name ?? '—'
    try {
      await updateTicketTaskResponsavel(taskId, responsavel_id)
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, responsavel_id, responsavel_nome: nome } : t,
        ),
      )
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao alterar responsável.'
      setError(message)
    }
  }

  const handleEditTaskStart = (task: TicketTask) => {
    setEditingTaskId(task.id)
    setEditTaskTitulo(task.titulo)
    setEditTaskDescricao(task.descricao ?? '')
  }

  const handleEditTaskSave = async (event: FormEvent) => {
    event.preventDefault()
    if (editingTaskId == null) return
    try {
      await updateTicketTask(editingTaskId, {
        titulo: editTaskTitulo.trim(),
        descricao: editTaskDescricao.trim() || null,
      })
      setTasks((prev) =>
        prev.map((t) =>
          t.id === editingTaskId
            ? { ...t, titulo: editTaskTitulo.trim(), descricao: editTaskDescricao.trim() || null }
            : t,
        ),
      )
      setEditingTaskId(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao salvar task.'
      setError(message)
    }
  }

  const handleEditTaskCancel = () => {
    setEditingTaskId(null)
    setEditTaskTitulo('')
    setEditTaskDescricao('')
  }

  const handleDeleteTask = async (taskId: number) => {
    if (!window.confirm('Excluir esta task? Esta ação não pode ser desfeita.')) return
    try {
      await deleteTicketTask(taskId)
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao excluir task.'
      setError(message)
    }
  }

  const handleUploadChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
    kind: 'foto' | 'arquivo',
  ) => {
    const file = event.target.files?.[0]
    if (!file || !id) return
    setUploading(true)
    try {
      await uploadTicketFile(id, file, kind)
      const data = await listTicketFiles(id)
      setFiles(data)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao enviar arquivo.'
      setError(message)
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleExcluirAnexo = async (fileId: number) => {
    if (!id || !window.confirm('Excluir este anexo? A ação não pode ser desfeita.')) return
    setDeletingFileId(fileId)
    try {
      await deleteTicketFile(fileId)
      const data = await listTicketFiles(id)
      setFiles(data)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao excluir anexo.'
      setError(message)
    } finally {
      setDeletingFileId(null)
    }
  }

  const openEditDados = () => {
    if (!ticket) return
    setFormDados({
      titulo: ticket.titulo,
      descricao: ticket.descricao ?? '',
      solicitante_nome: ticket.solicitante_nome,
      solicitante_telefone: ticket.solicitante_telefone ?? '',
      categoria: ticket.categoria,
      prioridade: ticket.prioridade,
      data_entrega: ticket.data_entrega ?? '',
      material_impressao: ticket.impressao3d?.material ?? '',
      cor: ticket.impressao3d?.cor ?? '',
      quantidade_pecas:
        ticket.impressao3d?.quantidade_pecas ?? ('' as number | ''),
      tamanho_escala: ticket.impressao3d?.tamanho_escala ?? '',
      observacoes_tecnicas:
        ticket.impressao3d?.observacoes_tecnicas ?? '',
      valor_demanda: ticket.valor_demanda ?? ('' as number | ''),
      pagamento_tipo: (ticket.pagamento_tipo ?? 'avista') as 'avista' | 'a_definir',
      pagamento_data: ticket.pagamento_data ?? '',
      receita_recorrente: !!ticket.receita_recorrente,
      receita_recorrente_dia_pagamento:
        ticket.receita_recorrente_dia_pagamento != null
          ? ticket.receita_recorrente_dia_pagamento
          : ('' as number | ''),
      receita_recorrente_inicio: ticket.receita_recorrente_inicio ?? '',
      receita_recorrente_fim: ticket.receita_recorrente_fim ?? '',
      tipo_receita: ticket.tipo_receita ?? 'monetaria',
      contrapartida_material: ticket.contrapartida_material ?? '',
      contrapartida_quantidade:
        ticket.contrapartida_quantidade != null
          ? ticket.contrapartida_quantidade
          : ('' as number | ''),
      custo: ticket.custo ?? ('' as number | ''),
    })
    setEditingDados(true)
  }

  const handleSaveDados = async (event: FormEvent) => {
    event.preventDefault()
    if (!id || !ticket) return
    setSavingDados(true)
    try {
      const normalizedDataEntrega = formDados.data_entrega || null
      const payloadDados = {
        titulo: formDados.titulo,
        descricao: formDados.descricao || null,
        solicitante_nome: formDados.solicitante_nome,
        solicitante_telefone: formDados.solicitante_telefone || null,
        categoria: formDados.categoria,
        prioridade: formDados.prioridade,
        material_impressao:
          formDados.categoria === 'servicos_3d' && formDados.material_impressao
            ? formDados.material_impressao
            : null,
        cor:
          formDados.categoria === 'servicos_3d' && formDados.cor
            ? formDados.cor
            : null,
        quantidade_pecas:
          formDados.categoria === 'servicos_3d' && formDados.quantidade_pecas
            ? Number(formDados.quantidade_pecas)
            : null,
        tamanho_escala:
          formDados.categoria === 'servicos_3d' && formDados.tamanho_escala
            ? formDados.tamanho_escala
            : null,
        observacoes_tecnicas:
          formDados.categoria === 'servicos_3d' &&
          formDados.observacoes_tecnicas
            ? formDados.observacoes_tecnicas
            : null,
        valor_demanda:
          formDados.valor_demanda !== ''
            ? Number(formDados.valor_demanda)
            : null,
        pagamento_tipo: formDados.pagamento_tipo,
        pagamento_data:
          formDados.pagamento_tipo === 'a_definir'
            ? (formDados.pagamento_data || null)
            : null,
        receita_recorrente: formDados.tipo_receita === 'monetaria' ? formDados.receita_recorrente : false,
        receita_recorrente_dia_pagamento:
          formDados.tipo_receita === 'monetaria' && formDados.receita_recorrente && formDados.receita_recorrente_dia_pagamento !== ''
            ? Number(formDados.receita_recorrente_dia_pagamento)
            : null,
        receita_recorrente_inicio:
          formDados.tipo_receita === 'monetaria' && formDados.receita_recorrente
            ? (formDados.receita_recorrente_inicio || null)
            : null,
        receita_recorrente_fim:
          formDados.tipo_receita === 'monetaria' && formDados.receita_recorrente
            ? (formDados.receita_recorrente_fim || null)
            : null,
        tipo_receita: formDados.tipo_receita,
        contrapartida_material:
          formDados.tipo_receita === 'contrapartida' &&
          formDados.contrapartida_material
            ? formDados.contrapartida_material
            : null,
        contrapartida_quantidade:
          formDados.tipo_receita === 'contrapartida' &&
          formDados.contrapartida_quantidade !== ''
            ? Number(formDados.contrapartida_quantidade)
            : null,
        custo:
          formDados.custo !== '' ? Number(formDados.custo) : null,
      }

      const updated = await updateTicketDados(id, {
        ...payloadDados,
        ...(normalizedDataEntrega !== (ticket.data_entrega ?? null)
          ? { data_entrega: normalizedDataEntrega }
          : {}),
      })
      setTicket(updated)
      setEditingDados(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao salvar dados.'
      setError(message)
    } finally {
      setSavingDados(false)
    }
  }

  if (loading) {
    return (
      <LayoutShell>
        <div className="ctp-card px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Carregando demanda...
        </div>
      </LayoutShell>
    )
  }

  if (error || !ticket) {
    return (
      <LayoutShell>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800">
          {error ?? 'Demanda não encontrada.'}
        </div>
      </LayoutShell>
    )
  }

  const podeAlterarStatus =
    !ticket.excluida_em &&
    (isFelipe || (isExecutor && isResponsavelOuColaborador(ticket)))

  return (
    <LayoutShell>
      <section className="space-y-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800 md:text-2xl">
              {ticket.titulo}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {ticket.solicitante_nome}{' '}
              {ticket.tipo === 'externa' ? '· Externa' : '· Interna'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ticket.origem === 'formulario' && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                WhatsApp
              </span>
            )}
            <TicketStatusPill status={ticket.status} />
            {statusPermitePlayPause && appUser && (
              activeWorkSession?.ticket_id === id ? (
                <button
                  type="button"
                  onClick={handlePauseWork}
                  disabled={workSessionLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  title="Pausar sessão de trabalho"
                >
                  <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
                  {workSessionLoading ? 'Pausando...' : 'Pausar'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePlayWork}
                  disabled={workSessionLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                  title="Iniciar sessão de trabalho (aparece no feed)"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                  {workSessionLoading ? 'Iniciando...' : 'Play'}
                </button>
              )
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
              Resp.:{' '}
              {ticket.responsavel_nome ? (
                <UserAvatar
                  avatarUrl={ticket.responsavel_avatar_url}
                  name={ticket.responsavel_nome}
                  size="sm"
                  showName
                />
              ) : (
                '—'
              )}
            </span>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[2fr_1.4fr]">
          <div className="space-y-4">
            <div className="ctp-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Informações principais
                </p>
                {podeEditarDados(ticket) && !editingDados && (
                  <button
                    type="button"
                    onClick={openEditDados}
                    className="btn btn-outline btn-sm"
                  >
                    {ticket.origem === 'formulario'
                      ? 'Completar dados'
                      : 'Editar dados'}
                  </button>
                )}
              </div>

              {editingDados ? (
                <form
                  onSubmit={handleSaveDados}
                  className="mt-4 space-y-4"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="ctp-label">
                        Título
                      </label>
                      <input
                        required
                        value={formDados.titulo}
                        onChange={(e) =>
                          setFormDados((p) => ({ ...p, titulo: e.target.value }))
                        }
                        className="ctp-input"
                      />
                    </div>
                    <div>
                      <label className="ctp-label">
                        Solicitante
                      </label>
                      <input
                        required
                        value={formDados.solicitante_nome}
                        onChange={(e) =>
                          setFormDados((p) => ({
                            ...p,
                            solicitante_nome: e.target.value,
                          }))
                        }
                        className="ctp-input"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="ctp-label">
                        Telefone
                      </label>
                      <input
                        value={formDados.solicitante_telefone}
                        onChange={(e) =>
                          setFormDados((p) => ({
                            ...p,
                            solicitante_telefone: e.target.value,
                          }))
                        }
                        className="ctp-input"
                      />
                    </div>
                    <div>
                      <label className="ctp-label">
                        Prioridade
                      </label>
                      <select
                        value={formDados.prioridade}
                        onChange={(e) =>
                          setFormDados((p) => ({
                            ...p,
                            prioridade: e.target.value as TicketPrioridade,
                          }))
                        }
                        className="ctp-input"
                      >
                        <option value="baixa">Baixa</option>
                        <option value="media">Média</option>
                        <option value="alta">Alta</option>
                        <option value="urgente">Urgente</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="ctp-label">
                        Categoria
                      </label>
                      <CategorySelect
                        value={formDados.categoria}
                        onChange={(categoria) =>
                          setFormDados((p) => ({ ...p, categoria }))
                        }
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="ctp-label">
                        Prazo de entrega
                      </label>
                      <input
                        type="date"
                        value={formDados.data_entrega}
                        onChange={(e) =>
                          setFormDados((p) => ({
                            ...p,
                            data_entrega: e.target.value,
                          }))
                        }
                        className="ctp-input"
                      />
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="ctp-label">
                      Tipo de receita
                    </label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="tipo_receita"
                          checked={formDados.tipo_receita === 'monetaria'}
                          onChange={() =>
                            setFormDados((p) => ({ ...p, tipo_receita: 'monetaria' }))
                          }
                          className="rounded border-slate-300"
                        />
                        <span className="text-sm">Monetária</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="tipo_receita"
                          checked={formDados.tipo_receita === 'contrapartida'}
                          onChange={() =>
                            setFormDados((p) => ({ ...p, tipo_receita: 'contrapartida' }))
                          }
                          className="rounded border-slate-300"
                        />
                        <span className="text-sm">Contrapartida</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="ctp-label">
                      {formDados.tipo_receita === 'contrapartida'
                        ? 'Valor equivalente (R$)'
                        : 'Valor da demanda (R$)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={formDados.valor_demanda === '' ? '' : formDados.valor_demanda}
                      onChange={(e) =>
                        setFormDados((p) => ({
                          ...p,
                          valor_demanda:
                            e.target.value === ''
                              ? ('' as number | '')
                              : Number(e.target.value),
                        }))
                      }
                      className="ctp-input"
                      placeholder="0,00"
                    />
                  </div>
                  {formDados.tipo_receita === 'monetaria' && (
                    <div className="md:col-span-2">
                      <label className="ctp-label">
                        Pagamento
                      </label>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="pagamento_tipo"
                            checked={formDados.pagamento_tipo === 'avista'}
                            onChange={() =>
                              setFormDados((p) => ({
                                ...p,
                                pagamento_tipo: 'avista',
                                pagamento_data: '',
                              }))
                            }
                            className="rounded border-slate-300"
                          />
                          <span className="text-sm">À vista</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="pagamento_tipo"
                            checked={formDados.pagamento_tipo === 'a_definir'}
                            onChange={() =>
                              setFormDados((p) => ({
                                ...p,
                                pagamento_tipo: 'a_definir',
                              }))
                            }
                            className="rounded border-slate-300"
                          />
                          <span className="text-sm">A definir</span>
                        </label>
                        <div>
                          <label className="sr-only">Data de pagamento</label>
                          <input
                            type="date"
                            value={formDados.pagamento_data}
                            onChange={(e) =>
                              setFormDados((p) => ({
                                ...p,
                                pagamento_data: e.target.value,
                              }))
                            }
                            disabled={formDados.pagamento_tipo !== 'a_definir'}
                            className="ctp-input disabled:opacity-60"
                          />
                        </div>
                      </div>
                      {formDados.pagamento_tipo === 'a_definir' &&
                        !formDados.pagamento_data && (
                          <p className="mt-1 text-xs text-rose-700">
                            Informe a data de pagamento para “A definir”.
                          </p>
                        )}
                    </div>
                  )}
                  {formDados.tipo_receita === 'monetaria' && (
                    <div className="md:col-span-2">
                      <label className="ctp-label">
                        Lançamento recorrente
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={formDados.receita_recorrente}
                          onChange={(e) =>
                            setFormDados((p) => ({
                              ...p,
                              receita_recorrente: e.target.checked,
                              ...(e.target.checked
                                ? {
                                    receita_recorrente_inicio:
                                      p.receita_recorrente_inicio ||
                                      new Date().toISOString().slice(0, 10),
                                  }
                                : {
                                    receita_recorrente_dia_pagamento: '' as number | '',
                                    receita_recorrente_inicio: '',
                                    receita_recorrente_fim: '',
                                  }),
                            }))
                          }
                          className="rounded border-slate-300"
                        />
                        Contabilizar automaticamente todo mês
                      </label>

                      {formDados.receita_recorrente && (
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <div>
                            <label className="ctp-label">
                              Dia do mês
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={31}
                              value={
                                formDados.receita_recorrente_dia_pagamento === ''
                                  ? ''
                                  : formDados.receita_recorrente_dia_pagamento
                              }
                              onChange={(e) =>
                                setFormDados((p) => ({
                                  ...p,
                                  receita_recorrente_dia_pagamento:
                                    e.target.value === ''
                                      ? ('' as number | '')
                                      : Number(e.target.value),
                                }))
                              }
                              className="ctp-input"
                              placeholder="Ex: 10"
                            />
                          </div>
                          <div>
                            <label className="ctp-label">
                              Início
                            </label>
                            <input
                              type="date"
                              value={formDados.receita_recorrente_inicio}
                              onChange={(e) =>
                                setFormDados((p) => ({
                                  ...p,
                                  receita_recorrente_inicio: e.target.value,
                                }))
                              }
                              className="ctp-input"
                            />
                          </div>
                          <div>
                            <label className="ctp-label">
                              Fim (opcional)
                            </label>
                            <input
                              type="date"
                              value={formDados.receita_recorrente_fim}
                              onChange={(e) =>
                                setFormDados((p) => ({
                                  ...p,
                                  receita_recorrente_fim: e.target.value,
                                }))
                              }
                              className="ctp-input"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {formDados.tipo_receita === 'contrapartida' && (
                    <>
                      <div>
                        <label className="ctp-label">
                          Material (contrapartida)
                        </label>
                        <input
                          type="text"
                          value={formDados.contrapartida_material}
                          onChange={(e) =>
                            setFormDados((p) => ({
                              ...p,
                              contrapartida_material: e.target.value,
                            }))
                          }
                          className="ctp-input"
                          placeholder="Ex: PLA, resina"
                        />
                      </div>
                      <div>
                        <label className="ctp-label">
                          Quantidade (contrapartida)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={
                            formDados.contrapartida_quantidade === ''
                              ? ''
                              : formDados.contrapartida_quantidade
                          }
                          onChange={(e) =>
                            setFormDados((p) => ({
                              ...p,
                              contrapartida_quantidade:
                                e.target.value === ''
                                  ? ('' as number | '')
                                  : Number(e.target.value),
                            }))
                          }
                          className="ctp-input"
                          placeholder="0"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="ctp-label">
                      Custo (R$)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={formDados.custo === '' ? '' : formDados.custo}
                      onChange={(e) =>
                        setFormDados((p) => ({
                          ...p,
                          custo:
                            e.target.value === ''
                              ? ('' as number | '')
                              : Number(e.target.value),
                        }))
                      }
                      className="ctp-input"
                      placeholder="0,00"
                    />
                  </div>
                  <div>
                    <label className="ctp-label">
                      Descrição
                    </label>
                    <textarea
                      value={formDados.descricao}
                      onChange={(e) =>
                        setFormDados((p) => ({ ...p, descricao: e.target.value }))
                      }
                      rows={3}
                      className="ctp-input"
                    />
                  </div>
                  {formDados.categoria === 'servicos_3d' && (
                    <div className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3 md:grid-cols-2">
                      <div>
                        <label className="ctp-label">
                          Material
                        </label>
                        <MaterialSelect
                          value={formDados.material_impressao ?? ''}
                          onChange={(material_impressao) =>
                            setFormDados((p) => ({ ...p, material_impressao }))
                          }
                          className="w-full"
                          placeholder="—"
                          allowEmpty
                        />
                      </div>
                    <div>
                      <label className="ctp-label">
                        Cor
                      </label>
                      <input
                        value={formDados.cor}
                        onChange={(e) =>
                          setFormDados((p) => ({ ...p, cor: e.target.value }))
                        }
                        className="ctp-input"
                        placeholder="Ex: preto"
                      />
                    </div>
                    <div>
                      <label className="ctp-label">
                        Quantidade de peças
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={formDados.quantidade_pecas}
                        onChange={(e) =>
                          setFormDados((p) => ({
                            ...p,
                            quantidade_pecas:
                              e.target.value === ''
                                ? ('' as number | '')
                                : parseInt(e.target.value, 10),
                          }))
                        }
                        className="ctp-input"
                      />
                    </div>
                    <div>
                      <label className="ctp-label">
                        Tamanho / escala
                      </label>
                      <input
                        value={formDados.tamanho_escala}
                        onChange={(e) =>
                          setFormDados((p) => ({
                            ...p,
                            tamanho_escala: e.target.value,
                          }))
                        }
                        className="ctp-input"
                        placeholder="Ex: 1:1, 200%"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="ctp-label">
                        Observações técnicas
                      </label>
                      <textarea
                        value={formDados.observacoes_tecnicas}
                        onChange={(e) =>
                          setFormDados((p) => ({
                            ...p,
                            observacoes_tecnicas: e.target.value,
                          }))
                        }
                        rows={2}
                        className="ctp-input"
                      />
                    </div>
                  </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={savingDados}
                      className="btn btn-primary"
                    >
                      {savingDados ? 'Salvando…' : 'Salvar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingDados(false)}
                      className="btn btn-outline"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <Field label="Tipo">
                      {ticket.tipo === 'externa' ? 'Externa' : 'Interna'}
                    </Field>
                    <Field label="Prioridade">
                      {ticket.prioridade.toUpperCase()}
                    </Field>
                    <Field label="Categoria">
                      {CATEGORIAS.find((c) => c.value === ticket.categoria)
                        ?.label ?? ticket.categoria}
                    </Field>
                    <Field label="Prazo de entrega">
                      {ticket.data_entrega ?? '—'}
                    </Field>
                    <Field
                      label={
                        ticket.tipo_receita === 'contrapartida'
                          ? 'Receita (contrapartida)'
                          : 'Valor da demanda (R$)'
                      }
                    >
                      {ticket.valor_demanda != null ? (
                        <>
                          {ticket.tipo_receita === 'contrapartida' ? (
                            <span>
                              R${' '}
                              {Number(ticket.valor_demanda).toLocaleString('pt-BR', {
                                minimumFractionDigits: 2,
                              })}{' '}
                              (equiv.)
                              {ticket.contrapartida_material && (
                                <> · {ticket.contrapartida_material}</>
                              )}
                              {ticket.contrapartida_quantidade != null && (
                                <> · Qtd: {Number(ticket.contrapartida_quantidade)}</>
                              )}
                            </span>
                          ) : (
                            `R$ ${Number(ticket.valor_demanda).toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                            })}`
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </Field>
                    {ticket.tipo_receita !== 'contrapartida' && (
                      <Field label="Faturamento">
                        {ticket.pagamento_pago_em ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              Pago
                            </span>
                            <span className="text-sm text-slate-700">
                              {ticket.pagamento_pago_em.slice(0, 10)}
                            </span>
                            {isFelipe && (
                              <button
                                type="button"
                                disabled={savingPagamento}
                                onClick={() => {
                                  if (!window.confirm('Desmarcar como pago?')) return
                                  handleTogglePagamentoPago(false)
                                }}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              >
                                Desmarcar pago
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              A ser faturada
                            </span>
                            {ticket.pagamento_data && (
                              <span className="text-sm text-slate-600">
                                Previsto: {ticket.pagamento_data}
                              </span>
                            )}
                            {isFelipe && (
                              <button
                                type="button"
                                disabled={savingPagamento}
                                onClick={() => {
                                  if (!window.confirm('Marcar como pago?')) return
                                  handleTogglePagamentoPago(true)
                                }}
                                className="btn btn-primary btn-sm"
                              >
                                Marcar como pago
                              </button>
                            )}
                          </span>
                        )}
                      </Field>
                    )}
                    <Field label="Custo">
                      {ticket.custo != null
                        ? `R$ ${Number(ticket.custo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : '—'}
                    </Field>
                    <Field label="Criada em">{ticket.data_criacao}</Field>
                    <Field label="Telefone do solicitante">
                      {ticket.solicitante_telefone ?? '—'}
                    </Field>
                  </div>
                  {ticket.descricao && (
                    <div className="mt-3">
                      <Field label="Descrição">
                        <p className="whitespace-pre-line text-sm text-slate-700">
                          {ticket.descricao}
                        </p>
                      </Field>
                    </div>
                  )}
                </>
              )}
            </div>

            {ticket.categoria === 'servicos_3d' && ticket.impressao3d && (
              <div className="ctp-card space-y-2 p-4" style={{ borderLeft: '3px solid var(--ctp-navy)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-800">
                  Serviços 3D
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Material">{ticket.impressao3d.material}</Field>
                  <Field label="Cor">{ticket.impressao3d.cor ?? '—'}</Field>
                  <Field label="Quantidade de peças">
                    {ticket.impressao3d.quantidade_pecas ?? '—'}
                  </Field>
                  <Field label="Tamanho / escala">
                    {ticket.impressao3d.tamanho_escala ?? '—'}
                  </Field>
                </div>
                {ticket.impressao3d.observacoes_tecnicas && (
                  <Field label="Observações técnicas">
                    {ticket.impressao3d.observacoes_tecnicas}
                  </Field>
                )}
              </div>
            )}

            <div className="space-y-2 ctp-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Comentários
              </p>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{c.author_name}</span>
                      <span>{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{c.body}</p>
                  </div>
                ))}
                {comments.length === 0 && (
                  <p className="text-sm text-slate-500">Nenhum comentário ainda.</p>
                )}
              </div>
              <form onSubmit={handleCommentSubmit} className="mt-3 flex gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Adicionar comentário..."
                  className="ctp-input flex-1"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Enviar
                </button>
              </form>
            </div>

            <div className="space-y-2 ctp-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Tasks da Demanda
                </p>
                {!ticket.excluida_em && appUser && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewTaskForm((v) => !v)
                      if (!showNewTaskForm) setTaskResponsavelId(appUser.id)
                    }}
                    className="btn btn-lime btn-sm"
                  >
                    + Nova Task
                  </button>
                )}
              </div>
              {showNewTaskForm && appUser && (
                <form
                  onSubmit={handleCreateTask}
                  className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
                >
                  <input
                    value={taskTitulo}
                    onChange={(e) => setTaskTitulo(e.target.value)}
                    placeholder="Título da task"
                    required
                    className="ctp-input"
                  />
                  <textarea
                    value={taskDescricao}
                    onChange={(e) => setTaskDescricao(e.target.value)}
                    placeholder="Descrição (opcional)"
                    rows={2}
                    className="ctp-input"
                  />
                  <label className="ctp-label">
                    Responsável
                  </label>
                  <select
                    value={taskResponsavelId}
                    onChange={(e) => setTaskResponsavelId(e.target.value)}
                    className="ctp-input"
                  >
                    {appUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={savingTask}
                      className="btn btn-lime btn-sm"
                    >
                      {savingTask ? 'Salvando…' : 'Criar task'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewTaskForm(false)
                        setTaskTitulo('')
                        setTaskDescricao('')
                        setTaskResponsavelId(appUser?.id ?? '')
                      }}
                      className="btn btn-outline btn-sm"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2"
                  >
                    {editingTaskId === task.id ? (
                      <form onSubmit={handleEditTaskSave} className="space-y-2">
                        <input
                          value={editTaskTitulo}
                          onChange={(e) => setEditTaskTitulo(e.target.value)}
                          placeholder="Título"
                          required
                          className="ctp-input"
                        />
                        <textarea
                          value={editTaskDescricao}
                          onChange={(e) => setEditTaskDescricao(e.target.value)}
                          placeholder="Descrição (opcional)"
                          rows={2}
                          className="ctp-input"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            className="btn btn-primary btn-sm"
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={handleEditTaskCancel}
                            className="btn btn-outline btn-sm"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="font-medium text-slate-800">{task.titulo}</p>
                          {task.descricao && (
                            <p className="mt-0.5 text-sm text-slate-600 line-clamp-2">
                              {task.descricao}
                            </p>
                          )}
                          <p className="mt-1.5 text-xs text-slate-400">
                            {task.created_by_nome && (
                              <>Criada por {task.created_by_nome} · </>
                            )}
                            {new Date(task.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">Responsável</span>
                            {!ticket.excluida_em ? (
                              <select
                                value={task.responsavel_id}
                                onChange={(e) =>
                                  handleTaskResponsavelChange(
                                    task.id,
                                    e.target.value,
                                  )
                                }
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                title="Alterar responsável"
                              >
                                {appUsers.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-slate-600">{task.responsavel_nome}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">Status</span>
                            {!ticket.excluida_em ? (
                              <select
                                value={task.status}
                                onChange={(e) =>
                                  handleTaskStatusChange(
                                    task.id,
                                    e.target.value as TicketTaskStatus,
                                  )
                                }
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              >
                                <option value="pendente">Pendente</option>
                                <option value="em_producao">Em produção</option>
                                <option value="concluido">Concluído</option>
                              </select>
                            ) : (
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  task.status === 'concluido'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : task.status === 'em_producao'
                                      ? 'bg-violet-100 text-violet-800'
                                      : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {TASK_STATUS_LABELS[task.status]}
                              </span>
                            )}
                          </div>
                          {!ticket.excluida_em && (
                            <div className="ml-auto flex items-center gap-2 border-l border-slate-200 pl-3">
                              <button
                                type="button"
                                onClick={() => handleEditTaskStart(task)}
                                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTask(task.id)}
                                className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                              >
                                Excluir
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {tasks.length === 0 && !showNewTaskForm && (
                  <p className="text-sm text-slate-500">Nenhuma task ainda.</p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {isFelipe && (
              <div className="space-y-2 ctp-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Definir responsável (triagem)
                </p>
                <p className="text-sm text-slate-600">
                  Demandas que não passaram pela caixa de entrada podem ter o responsável definido aqui.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[180px] flex-1">
                    <label className="sr-only">Responsável</label>
                    <select
                      value={responsavelTriagemId}
                      onChange={(e) => setResponsavelTriagemId(e.target.value)}
                      className="ctp-input"
                    >
                      <option value="">— Nenhum —</option>
                      {appUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleDefinirResponsavel}
                    disabled={savingResponsavel}
                    className="btn btn-outline"
                  >
                    {savingResponsavel ? 'Salvando…' : 'Atribuir'}
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-2 ctp-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Workflow
              </p>
              {ticket.excluida_em ? (
                <p className="text-sm text-slate-500">Esta demanda foi excluída e não pode mais ser alterada.</p>
              ) : (
                <>
                  {podeAlterarStatus && (
                    <div className="space-y-2">
                      <label className="ctp-label">
                        Alterar status
                      </label>
                      <select
                        value={ticket.status}
                        onChange={(e) => {
                          const next = e.target.value as TicketStatus
                          if (next === ticket.status) return
                          const label = STATUS_LABELS[next]
                          if (
                            window.confirm(
                              `Tem certeza que deseja alterar o status para "${label}"?`,
                            )
                          ) {
                            handleStatusChange(next)
                          }
                        }}
                        className="ctp-input"
                      >
                        <option value="recebida">Recebida</option>
                        <option value="em_analise">Em análise</option>
                        <option value="orcamento_em_criacao">
                          Orçamento em criação
                        </option>
                        <option value="aguardando_aprovacao">
                          Esperando aprovação (Pedro)
                        </option>
                        <option value="enviado_cliente">
                          Enviado ao cliente
                        </option>
                        <option value="aprovado">Orçamento aprovado</option>
                        <option value="em_producao">Em produção</option>
                        <option value="pos_processo">Pós-processo</option>
                        <option value="pronta">Pronta</option>
                        <option value="entregue">Entregue (finalizado)</option>
                        <option value="cancelada">Cancelada</option>
                      </select>
                    </div>
                  )}
                  {!podeAlterarStatus && (
                    <p className="text-sm text-slate-500">
                      Apenas triagem (Felipe) ou o responsável pela demanda podem alterar o fluxo.
                    </p>
                  )}
                </>
              )}
            </div>

            {!ticket.excluida_em && podeAlterarStatus && (
              <div className="ctp-card p-4">
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Tem certeza que deseja excluir esta demanda? Ela não aparecerá mais nas listas e não poderá ser alterada.')) return
                    try {
                      await setTicketExcluida(ticket.id)
                      setTicket((t) => (t ? { ...t, excluida_em: new Date().toISOString() } : null))
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Erro ao excluir.'
                      window.alert(msg)
                    }
                  }}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Excluir demanda
                </button>
              </div>
            )}

            <div className="space-y-2 ctp-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Anexos
              </p>
              {!ticket.excluida_em && (
                <div className="flex flex-wrap gap-2">
                  <label className="btn btn-outline cursor-pointer">
                    + Foto
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUploadChange(e, 'foto')}
                    />
                  </label>
                  <label className="btn btn-outline cursor-pointer">
                    + Arquivo
                    <input
                      type="file"
                      accept=".stl,.obj,.3mf,.pdf,.zip,.rar,.7z,image/*"
                      className="hidden"
                      onChange={(e) => handleUploadChange(e, 'arquivo')}
                    />
                  </label>
                  {uploading && (
                    <span className="text-sm text-slate-500">Enviando...</span>
                  )}
                </div>
              )}
              <div className="mt-3 space-y-2">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                  >
                    <span className="truncate">{f.file_name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <a
                        href={f.public_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-[#063A70] hover:text-[#042c56]"
                      >
                        Abrir
                      </a>
                      {!ticket?.excluida_em && (
                        <button
                          type="button"
                          onClick={() => handleExcluirAnexo(f.id)}
                          disabled={deletingFileId === f.id}
                          className="text-rose-600 hover:text-rose-700 disabled:opacity-50"
                          title="Excluir anexo"
                        >
                          {deletingFileId === f.id ? 'Excluindo...' : 'Excluir'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {files.length === 0 && (
                  <p className="text-sm text-slate-500">Nenhum anexo ainda.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </LayoutShell>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  )
}

