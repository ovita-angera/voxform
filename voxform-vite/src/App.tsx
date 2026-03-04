import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/hooks/useAuth'

// Layouts
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'

// Pages
import { LandingPage }        from '@/pages/LandingPage'
import { LoginPage }          from '@/pages/LoginPage'
import { RegisterPage }       from '@/pages/RegisterPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { DashboardPage }      from '@/pages/DashboardPage'
import { SurveysPage }        from '@/pages/SurveysPage'
import { SurveyBuilderPage }  from '@/pages/SurveyBuilderPage'
import { NewSurveyPage }      from '@/pages/NewSurveyPage'
import { ResponsesPage }      from '@/pages/ResponsesPage'
import { CollectPage }        from '@/pages/CollectPage'
import { SettingsPage }       from '@/pages/SettingsPage'

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <AppLoader />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-paper">
      <div className="flex gap-1.5">
        <div className="loader-dot loader-dot-1 w-1.5 h-1.5 rounded-full bg-ink" />
        <div className="loader-dot loader-dot-2 w-1.5 h-1.5 rounded-full bg-ink" />
        <div className="loader-dot loader-dot-3 w-1.5 h-1.5 rounded-full bg-ink" />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Public landing */}
      <Route path="/" element={<LandingPage />} />

      {/* Collection — no nav chrome */}
      <Route path="/s/:slug" element={<CollectPage />} />

      {/* Auth */}
      <Route element={<AuthLayout />}>
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/register"        element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Dashboard */}
      <Route element={<Guard><DashboardLayout /></Guard>}>
        <Route path="/dashboard"    element={<DashboardPage />} />
        <Route path="/surveys"      element={<SurveysPage />} />
        <Route path="/surveys/new"  element={<NewSurveyPage />} />
        <Route path="/surveys/:id"  element={<SurveyBuilderPage />} />
        <Route path="/responses"    element={<ResponsesPage />} />
        <Route path="/settings"     element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
