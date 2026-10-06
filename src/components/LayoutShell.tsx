import { useRef, useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, List, User, Plus, Inbox, UserCheck, Calendar,
  Calculator, SlidersHorizontal, BarChart3,
  Image, Rss, Bell, LogOut, ChevronLeft,
  Menu, Camera, X,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { uploadAvatar } from '../services/appUsers'
import { useUnreadCounts } from '../hooks/useUnreadCounts'
import logoCtp from '../assets/logo-ctp.svg'

interface NavItemDef {
  to: string
  icon: React.ElementType
  label: string
  end?: boolean
  accent?: boolean
  badge?: number
  show?: boolean
}

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/demandas': 'Todas as demandas',
  '/demandas/minhas': 'Minhas demandas',
  '/demandas/nova': 'Nova demanda',
  '/triagem': 'Caixa de entrada',
  '/atribuir': 'Definir responsável',
  '/demandas-whatsapp': 'Demandas WhatsApp',
  '/prontos': 'Prontos / Galeria',
  '/planejamento': 'Planejamento de equipe',
  '/eventos': 'Aulas e eventos',
  '/feed': 'Feed',
  '/estoque': 'Estoque',
  '/prefeitura': 'Prefeitura',
  '/orcamento': 'Calculadora de orçamento',
  '/configuracoes-calculadora': 'Config. da Calculadora',
  '/relatorios': 'Relatórios',
  '/relatorios/financeiro': 'Relatório financeiro',
  '/relatorios/mensal': 'Relatório mensal',
}

function SidebarNavItem({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItemDef
  collapsed: boolean
  onNavigate: () => void
}) {
  if (item.accent) {
    return (
      <NavLink
        to={item.to}
        onClick={onNavigate}
        className="flex items-center gap-2.5 mx-3 my-1 px-3.5 py-2.5 rounded-lg font-semibold text-[13px] transition-all"
        style={{ background: 'var(--ctp-lime)', color: 'var(--ctp-navy-deeper)' }}
        title={collapsed ? item.label : undefined}
      >
        <item.icon size={16} strokeWidth={2.5} />
        {!collapsed && item.label}
      </NavLink>
    )
  }
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={16} strokeWidth={2} />
      {!collapsed && (
        <span className="flex flex-1 items-center justify-between">
          <span>{item.label}</span>
          {item.badge && item.badge > 0 ? (
            <span
              className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
              style={{ background: '#EF4444' }}
            >
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          ) : null}
        </span>
      )}
    </NavLink>
  )
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const { appUser, signOut, refreshAppUser } = useAuth()
  const unread = useUnreadCounts(appUser?.id)
  const location = useLocation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  const isFelipe = appUser?.role === 'felipe'
  const isTriagem = isFelipe || appUser?.role === 'executor'
  const canFeed = appUser?.can_access_feed !== false

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // Fecha o drawer mobile ao trocar de rota
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !appUser) return
    if (!file.type.startsWith('image/')) return
    setUploadingAvatar(true)
    try {
      await uploadAvatar(appUser.id, file)
      await refreshAppUser()
    } finally {
      setUploadingAvatar(false)
      e.target.value = ''
    }
  }

  const totalUnread = unread.minhas + unread.triagem + (canFeed ? unread.feed : 0)

  const notifs = [
    unread.minhas > 0 && { label: 'Minhas demandas', desc: `${unread.minhas} atualização(ões)`, to: '/demandas/minhas', color: '#3B82F6' },
    isTriagem && unread.triagem > 0 && { label: 'Caixa de entrada', desc: `${unread.triagem} nova(s) demanda(s)`, to: '/triagem', color: '#F59E0B' },
    canFeed && unread.feed > 0 && { label: 'Feed', desc: `${unread.feed} nova(s) publicação(ões)`, to: '/feed', color: '#22C55E' },
  ].filter(Boolean) as { label: string; desc: string; to: string; color: string }[]

  const principal: NavItemDef[] = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/demandas', icon: List, label: 'Todas as demandas', end: true },
    { to: '/demandas/minhas', icon: User, label: 'Minhas demandas', badge: unread.minhas },
  ]
  const operacoes: NavItemDef[] = [
    { to: '/triagem', icon: Inbox, label: 'Caixa de entrada', badge: unread.triagem, show: isTriagem },
    { to: '/atribuir', icon: UserCheck, label: 'Definir responsável', show: isTriagem },
    { to: '/eventos', icon: Calendar, label: 'Aulas e eventos' },
  ]
  const gestao: NavItemDef[] = [
    { to: '/planejamento', icon: Calendar, label: 'Planejamento de equipe' },
    { to: '/prontos', icon: Image, label: 'Prontos / Galeria' },
    { to: '/feed', icon: Rss, label: 'Feed', badge: unread.feed, show: canFeed },
  ]
  const financeiro: NavItemDef[] = [
    { to: '/orcamento', icon: Calculator, label: 'Calculadora de orçamento' },
    { to: '/configuracoes-calculadora', icon: SlidersHorizontal, label: 'Config calculadora' },
    { to: '/relatorios', icon: BarChart3, label: 'Relatórios' },
  ]

  const closeMobile = () => setMobileOpen(false)

  const sidebar = (
    <aside
      className="flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden h-full"
      style={{
        width: collapsed ? '60px' : '232px',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: '56px',
          padding: collapsed ? '0 10px' : '0 14px',
          borderBottom: '1px solid var(--sidebar-border)',
        }}
      >
        {!collapsed && (
          <img
            src={logoCtp}
            alt="Cilla Tech Park"
            style={{ height: '22px', filter: 'brightness(0) invert(1)', maxWidth: '140px' }}
          />
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="hidden md:flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
          style={{ width: '28px', height: '28px', background: 'var(--sidebar-hover)', color: 'rgba(255,255,255,0.7)' }}
        >
          {collapsed ? <Menu size={14} /> : <ChevronLeft size={14} />}
        </button>
        <button
          onClick={closeMobile}
          className="md:hidden flex items-center justify-center rounded-lg flex-shrink-0"
          style={{ width: '28px', height: '28px', background: 'var(--sidebar-hover)', color: 'rgba(255,255,255,0.7)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3" style={{ scrollbarWidth: 'none' }}>
        {!collapsed && <p className="section-title">Principal</p>}
        {principal.map((it) => (
          <SidebarNavItem key={it.to} item={it} collapsed={collapsed} onNavigate={closeMobile} />
        ))}

        {!collapsed && <p className="section-title" style={{ marginTop: '1rem' }}>Operações</p>}
        <div style={{ margin: '0.5rem 0' }}>
          <SidebarNavItem
            item={{ to: '/demandas/nova', icon: Plus, label: 'Nova demanda', accent: true }}
            collapsed={collapsed}
            onNavigate={closeMobile}
          />
        </div>
        {operacoes.filter((it) => it.show !== false).map((it) => (
          <SidebarNavItem key={it.to} item={it} collapsed={collapsed} onNavigate={closeMobile} />
        ))}

        {!collapsed && <p className="section-title" style={{ marginTop: '1rem' }}>Gestão</p>}
        {gestao.filter((it) => it.show !== false).map((it) => (
          <SidebarNavItem key={it.to} item={it} collapsed={collapsed} onNavigate={closeMobile} />
        ))}
        {!collapsed && <p className="section-title" style={{ marginTop: '1rem' }}>Financeiro</p>}
        {financeiro.map((it) => (
          <SidebarNavItem key={it.to} item={it} collapsed={collapsed} onNavigate={closeMobile} />
        ))}
      </nav>

      {/* User footer */}
      <div
        className="flex-shrink-0 flex items-center gap-2.5"
        style={{ borderTop: '1px solid var(--sidebar-border)', padding: collapsed ? '12px 10px' : '12px 14px', minHeight: '60px' }}
      >
        <label className="relative cursor-pointer flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleAvatarChange}
            disabled={uploadingAvatar}
          />
          {appUser?.avatar_url ? (
            <img src={appUser.avatar_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div
              className="flex items-center justify-center rounded-lg text-xs font-bold"
              style={{ width: '32px', height: '32px', background: 'var(--ctp-lime)', color: 'var(--ctp-navy-deeper)' }}
            >
              {appUser?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
          )}
          <span
            className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full"
            style={{ width: '15px', height: '15px', background: 'var(--ctp-navy)', border: '1.5px solid var(--sidebar-bg)' }}
          >
            {uploadingAvatar ? (
              <span className="text-[7px] text-white">…</span>
            ) : (
              <Camera size={8} color="#fff" />
            )}
          </span>
        </label>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.95)' }}>
                {appUser?.name}
              </p>
              <p className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {isFelipe ? 'Triagem' : appUser?.role === 'admin' ? 'Admin' : 'Executor'}
              </p>
            </div>
            <button
              onClick={() => signOut()}
              className="flex-shrink-0 p-1.5 rounded-md transition-colors"
              style={{ color: 'rgba(255,255,255,0.45)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              title="Sair"
            >
              <LogOut size={14} />
            </button>
          </>
        )}
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-app)' }}>
      {/* Sidebar desktop */}
      <div className="hidden md:flex h-full">{sidebar}</div>

      {/* Sidebar mobile (drawer) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={closeMobile} />
          <div className="relative h-full">{sidebar}</div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="topbar">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden flex items-center justify-center rounded-lg mr-auto"
            style={{ width: '36px', height: '36px', color: 'var(--text-secondary)' }}
          >
            <Menu size={18} />
          </button>

          <div className="flex-1 hidden md:block">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              {ROUTE_TITLES[location.pathname] ?? ''}
            </p>
          </div>

          {/* Bell */}
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => setBellOpen((v) => !v)}
              className="relative flex items-center justify-center rounded-lg transition-colors"
              style={{
                width: '36px',
                height: '36px',
                background: bellOpen ? 'rgba(6,58,112,0.07)' : 'transparent',
                color: 'var(--text-secondary)',
              }}
            >
              <Bell size={18} />
              {totalUnread > 0 && (
                <span
                  className="absolute top-0.5 right-0.5 flex items-center justify-center text-white font-bold"
                  style={{ width: '16px', height: '16px', background: '#EF4444', borderRadius: '99px', fontSize: '9px', border: '1.5px solid white' }}
                >
                  {totalUnread > 9 ? '9+' : totalUnread}
                </span>
              )}
            </button>

            {bellOpen && (
              <div
                className="absolute right-0 top-full mt-2 overflow-hidden"
                style={{ width: '320px', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border-default)', zIndex: 50 }}
              >
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-default)' }}>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Notificações</p>
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: totalUnread > 0 ? 'var(--ctp-navy)' : '#E2E8F0', color: totalUnread > 0 ? '#fff' : 'var(--text-muted)' }}
                  >
                    {totalUnread}
                  </span>
                </div>
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {notifs.length === 0 ? (
                    <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                      <Bell size={26} />
                      <p>Tudo em dia</p>
                    </div>
                  ) : (
                    notifs.map((n) => (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        onClick={() => setBellOpen(false)}
                        className="alert-chip"
                        style={{ textDecoration: 'none' }}
                      >
                        <div className="alert-dot" style={{ background: n.color, marginTop: '5px' }} />
                        <div>
                          <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{n.label}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{n.desc}</p>
                        </div>
                      </NavLink>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Avatar mini */}
          <div
            className="flex items-center justify-center rounded-lg text-xs font-bold ml-1 overflow-hidden"
            style={{ width: '32px', height: '32px', background: 'var(--ctp-navy)', color: 'var(--ctp-lime)' }}
            title={appUser?.name ?? ''}
          >
            {appUser?.avatar_url ? (
              <img src={appUser.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              appUser?.name?.charAt(0)?.toUpperCase() ?? '?'
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto" style={{ padding: '1.75rem 2rem 3rem' }}>
          <div className="mx-auto w-full max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
