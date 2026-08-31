import { useState, useRef } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { TicketCategoria } from '../types/ticket'
import { createTicket, uploadTicketFilePublic } from '../services/tickets'
import { CategorySelect } from '../components/CategorySelect'
import { MaterialSelect } from '../components/MaterialSelect'
import logoCtp from '../assets/logo-ctp.svg'

const MAX_IMAGENS = 5
const MAX_ARQUIVOS_3D = 5
const EXTENSÕES_3D = '.stl,.3mf,.zip,.rar,.7z'
const REGISTRADO_POR_OPCOES = ['Bianca', 'Dani'] as const

export function SolicitarPage() {
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [solicitanteNome, setSolicitanteNome] = useState('')
  const [solicitanteTelefone, setSolicitanteTelefone] = useState('')
  const [registradoPor, setRegistradoPor] = useState('')
  const [categoria, setCategoria] = useState<TicketCategoria>('servicos_3d')
  const [valor, setValor] = useState<number | ''>('')
  const [material, setMaterial] = useState<string>('PLA')
  const [cor, setCor] = useState('')
  const [quantidadePecas, setQuantidadePecas] = useState<number | ''>('')
  const [fotos, setFotos] = useState<File[]>([])
  const [arquivos3d, setArquivos3d] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const arquivos3dInputRef = useRef<HTMLInputElement>(null)

  const addFotos = (files: FileList | null) => {
    if (!files?.length) return
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    setFotos((prev) => {
      const next = [...prev, ...list].slice(0, MAX_IMAGENS)
      return next
    })
  }

  const removeFoto = (index: number) => {
    setFotos((prev) => prev.filter((_, i) => i !== index))
  }

  const addArquivos3d = (files: FileList | null) => {
    if (!files?.length) return
    const list = Array.from(files).filter((f) => {
      const name = f.name.toLowerCase()
      return (
        name.endsWith('.stl') ||
        name.endsWith('.3mf') ||
        name.endsWith('.zip') ||
        name.endsWith('.rar') ||
        name.endsWith('.7z')
      )
    })
    setArquivos3d((prev) => [...prev, ...list].slice(0, MAX_ARQUIVOS_3D))
  }

  const removeArquivo3d = (index: number) => {
    setArquivos3d((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      setLoading(true)
      const ticket = await createTicket({
        titulo,
        descricao: descricao || undefined,
        tipo: 'externa',
        origem: 'formulario',
        solicitante_nome: solicitanteNome,
        solicitante_telefone: solicitanteTelefone || undefined,
        registrado_por: registradoPor || undefined,
        categoria,
        prioridade: 'media',
        valor_demanda: valor !== '' ? Number(valor) : undefined,
        material_impressao:
          categoria === 'servicos_3d' ? material : undefined,
        cor: categoria === 'servicos_3d' && cor ? cor : undefined,
        quantidade_pecas:
          categoria === 'servicos_3d' && quantidadePecas
            ? Number(quantidadePecas)
            : undefined,
      })
      for (const file of fotos) {
        try {
          await uploadTicketFilePublic(ticket.id, file, 'foto')
        } catch {
          // continua com as demais; a demanda já foi criada
        }
      }
      for (const file of arquivos3d) {
        try {
          await uploadTicketFilePublic(ticket.id, file, 'arquivo')
        } catch {
          // continua com as demais
        }
      }
      setEnviado(true)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao enviar solicitação.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'ctp-input'
  const labelClass = 'ctp-label'

  if (enviado) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-4"
        style={{ background: 'var(--bg-app)' }}
      >
        <div className="ctp-card w-full max-w-md p-8 text-center">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'var(--ctp-lime)', color: 'var(--ctp-navy-deeper)' }}
          >
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1>Solicitação enviada</h1>
          <p className="mt-2 text-sm">
            Entraremos em contato em breve pelo telefone informado.
          </p>
          <Link to="/solicitar" className="btn btn-outline mt-6 inline-flex">
            Enviar outra
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ background: 'var(--bg-app)' }}>
      <div style={{ height: '4px', background: 'linear-gradient(90deg, #063A70, #A1F01F)' }} />
      <header className="bg-white px-4 py-4" style={{ borderBottom: '1px solid var(--border-default)' }}>
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'var(--ctp-navy)' }}
            >
              <img
                src={logoCtp}
                alt="CTP"
                style={{ height: '18px', filter: 'brightness(0) invert(1)' }}
              />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ctp-navy)' }}>Cilla Tech Park</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Espaço Maker · Solicitar serviço</p>
            </div>
          </div>
          <Link to="/login" className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Acesso interno
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 p-4 py-8">
        <section className="ctp-card p-6">
          <h1>Solicitar serviço (link WhatsApp)</h1>
          <p className="mt-1 text-sm">
            Preencha os dados. Nossa equipe analisará e retornará em breve.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="rounded-lg p-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
              <label className={labelClass}>Você está preenchendo em nome de alguém (WhatsApp, telefone etc.)?</label>
              <select
                value={registradoPor}
                onChange={(e) => setRegistradoPor(e.target.value)}
                className={inputClass}
              >
                <option value="">Não — o próprio cliente está preenchendo</option>
                {REGISTRADO_POR_OPCOES.map((nome) => (
                  <option key={nome} value={nome}>
                    Sim, sou {nome}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Se selecionar, preencha os dados abaixo com as informações do <strong>cliente</strong>, não os seus.
              </p>
            </div>
            <div>
              <label className={labelClass}>Título da solicitação *</label>
              <input
                required
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                className={inputClass}
                placeholder="Ex: Impressão 3D - peça de suporte"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Seu nome *</label>
                <input
                  required
                  value={solicitanteNome}
                  onChange={(e) => setSolicitanteNome(e.target.value)}
                  className={inputClass}
                  placeholder="Nome completo"
                />
              </div>
              <div>
                <label className={labelClass}>Telefone / WhatsApp</label>
                <input
                  type="tel"
                  value={solicitanteTelefone}
                  onChange={(e) => setSolicitanteTelefone(e.target.value)}
                  className={inputClass}
                  placeholder="(xx) xxxxx-xxxx"
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Categoria</label>
              <CategorySelect
                value={categoria}
                onChange={setCategoria}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Valor estimado (R$) — opcional</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={valor === '' ? '' : valor}
                onChange={(e) =>
                  setValor(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
                }
                className={inputClass}
                placeholder="Ex: 50,00"
              />
            </div>

            {categoria === 'servicos_3d' && (
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={labelClass}>Material (opcional)</label>
                  <MaterialSelect
                    value={material}
                    onChange={setMaterial}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Cor (opcional)</label>
                  <input
                    type="text"
                    value={cor}
                    onChange={(e) => setCor(e.target.value)}
                    className={inputClass}
                    placeholder="Ex: preto, branco"
                  />
                </div>
                <div>
                  <label className={labelClass}>Quantidade de peças (opcional)</label>
                  <input
                    type="number"
                    min={1}
                    value={quantidadePecas}
                    onChange={(e) =>
                      setQuantidadePecas(
                        e.target.value === '' ? '' : parseInt(e.target.value, 10),
                      )
                    }
                    className={inputClass}
                    placeholder="Ex: 2"
                  />
                </div>
              </div>
            )}

            <div>
              <label className={labelClass}>Descrição</label>
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={4}
                className={inputClass}
                placeholder="Descreva o que precisa (material, quantidade, prazo desejado, etc.)"
              />
            </div>

            <div>
              <label className={labelClass}>Fotos (até {MAX_IMAGENS} imagens)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFotos(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={fotos.length >= MAX_IMAGENS}
                className="btn btn-outline btn-sm"
              >
                {fotos.length >= MAX_IMAGENS
                  ? `Máximo ${MAX_IMAGENS} imagens`
                  : 'Adicionar imagens'}
              </button>
              {fotos.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  {fotos.length} imagem(ns) — máx. 10 MB cada
                </p>
              )}
              {fotos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {fotos.map((file, i) => (
                    <div
                      key={i}
                      className="relative inline-block rounded-lg border border-slate-200 bg-slate-50 p-1"
                    >
                      <img
                        src={URL.createObjectURL(file)}
                        alt=""
                        className="h-20 w-20 object-cover rounded"
                      />
                      <button
                        type="button"
                        onClick={() => removeFoto(i)}
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white text-xs hover:bg-rose-600"
                        aria-label="Remover"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className={labelClass}>
                Arquivos 3D e compactados — STL, 3MF, ZIP, RAR, 7z (até {MAX_ARQUIVOS_3D} arquivos)
              </label>
              <input
                ref={arquivos3dInputRef}
                type="file"
                accept={EXTENSÕES_3D}
                multiple
                className="hidden"
                onChange={(e) => {
                  addArquivos3d(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => arquivos3dInputRef.current?.click()}
                disabled={arquivos3d.length >= MAX_ARQUIVOS_3D}
                className="btn btn-outline btn-sm"
              >
                {arquivos3d.length >= MAX_ARQUIVOS_3D
                  ? `Máximo ${MAX_ARQUIVOS_3D} arquivos`
                  : 'Adicionar arquivos .stl, .3mf ou .zip'}
              </button>
              {arquivos3d.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  {arquivos3d.length} arquivo(s) — máx. 50 MB cada
                </p>
              )}
              {arquivos3d.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-sm text-slate-600">
                  {arquivos3d.map((file, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeArquivo3d(i)}
                        className="shrink-0 rounded bg-rose-500 px-1.5 py-0.5 text-xs text-white hover:bg-rose-600"
                        aria-label="Remover"
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
              {loading ? 'Enviando…' : 'Enviar solicitação'}
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}
