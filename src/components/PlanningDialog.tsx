import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function PlanningDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close() } }, [])
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); onClose() }} className="planning-dialog" aria-labelledby="planning-dialog-title">
    <header className="flex items-center justify-between gap-4 mb-5"><h2 id="planning-dialog-title" className="text-lg font-semibold">{title}</h2><button type="button" className="btn btn-ghost" aria-label="Fechar" onClick={onClose}><X size={18} /></button></header>
    {children}
  </dialog>
}
