import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutShell } from './LayoutShell'

export function ReportsLayout({ children }: { children: ReactNode }) {
  return <LayoutShell>
    <nav aria-label="Visões de relatórios" className="flex flex-wrap gap-2 mb-6">
      {[
        ['/relatorios', 'Indicadores gerais'],
        ['/relatorios/financeiro', 'Financeiro'],
        ['/relatorios/mensal', 'Relatório mensal'],
      ].map(([to, label]) => <NavLink key={to} to={to} end className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'btn-outline'}`}>{label}</NavLink>)}
    </nav>
    {children}
  </LayoutShell>
}
