import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { LoginPage } from './screens/LoginPage'
import { DashboardPage } from './screens/DashboardPage'
import { TicketListPage } from './screens/TicketListPage'
import { TicketDetailPage } from './screens/TicketDetailPage'
import { NewTicketPage } from './screens/NewTicketPage'
import { InboxTriagemPage } from './screens/InboxTriagemPage'
import { AtribuirResponsavelPage } from './screens/AtribuirResponsavelPage'
import { ReadyGalleryPage } from './screens/ReadyGalleryPage'
import { ReportsPage } from './screens/ReportsPage'
import { FinancialReportsPage } from './screens/FinancialReportsPage'
import { RelatorioMensalPage } from './screens/RelatorioMensalPage'
import { SolicitarPage } from './screens/SolicitarPage'
import { FeedPage } from './screens/FeedPage'
import { CalculadoraConfigPage } from './screens/CalculadoraConfigPage'
import { OrcamentoCalculadoraPage } from './screens/OrcamentoCalculadoraPage'
import { PlanningPage } from './screens/PlanningPage'
import { EventsPage } from './screens/EventsPage'
import { isSupabaseConfigured } from './lib/supabaseClient'

function App() {
  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-slate-800">
        <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <h1 className="text-lg font-semibold text-amber-900">Configuração necessária</h1>
          <p className="mt-2 text-sm text-amber-800">
            Defina no Vercel (Settings → Environment Variables) as variáveis <strong>VITE_SUPABASE_URL</strong> e <strong>VITE_SUPABASE_ANON_KEY</strong> do seu projeto Supabase e faça um novo deploy.
          </p>
        </div>
      </div>
    )
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/solicitar" element={<SolicitarPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/demandas/minhas"
            element={
              <ProtectedRoute>
                <TicketListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/demandas"
            element={
              <ProtectedRoute>
                <TicketListPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/demandas/nova"
            element={
              <ProtectedRoute>
                <NewTicketPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/demandas/:id"
            element={
              <ProtectedRoute>
                <TicketDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/triagem"
            element={
              <ProtectedRoute>
                <InboxTriagemPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/atribuir"
            element={
              <ProtectedRoute>
                <AtribuirResponsavelPage />
              </ProtectedRoute>
            }
          />
          <Route path="/demandas-whatsapp" element={<Navigate to="/demandas" replace />} />

          <Route
            path="/prontos"
            element={
              <ProtectedRoute>
                <ReadyGalleryPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/relatorios"
            element={
              <ProtectedRoute>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/relatorios/financeiro"
            element={
              <ProtectedRoute>
                <FinancialReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/relatorios/mensal"
            element={
              <ProtectedRoute>
                <RelatorioMensalPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/feed"
            element={
              <ProtectedRoute requireFeedAccess>
                <FeedPage />
              </ProtectedRoute>
            }
          />

          <Route path="/agenda" element={<Navigate to="/planejamento" replace />} />

          <Route path="/estoque" element={<Navigate to="/" replace />} />
          <Route path="/prefeitura" element={<Navigate to="/" replace />} />
          <Route
            path="/orcamento"
            element={
              <ProtectedRoute>
                <OrcamentoCalculadoraPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/configuracoes-calculadora"
            element={
              <ProtectedRoute>
                <CalculadoraConfigPage />
              </ProtectedRoute>
            }
          />

          <Route path="/planejamento" element={<ProtectedRoute><PlanningPage /></ProtectedRoute>} />
          <Route path="/eventos" element={<ProtectedRoute><EventsPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
