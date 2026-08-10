import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminPage } from "./pages/AdminPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { ConfirmSignupPage } from "./pages/ConfirmSignupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { InfoPage } from "./pages/InfoPage";
import { InvitationAcceptPage } from "./pages/InvitationAcceptPage";
import { LoginPage } from "./pages/LoginPage";
import { OrganizationConsolePage } from "./pages/OrganizationConsolePage";
import { OverlayPage } from "./pages/OverlayPage";
import { RequestPage } from "./pages/RequestPage";
import { SignupPage } from "./pages/SignupPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/confirm" element={<ConfirmSignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/terms" element={<InfoPage kind="terms" />} />
      <Route path="/privacy" element={<InfoPage kind="privacy" />} />
      <Route path="/acceptable-use" element={<InfoPage kind="acceptable-use" />} />
      <Route path="/support" element={<InfoPage kind="support" />} />
      <Route path="/status" element={<InfoPage kind="status" />} />
      <Route path="/event/:eventId" element={<RequestPage />} />
      <Route path="/overlay/:eventId" element={<OverlayPage />} />
      <Route
        path="/console"
        element={
          <ProtectedRoute>
            <OrganizationConsolePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invitations/:token"
        element={
          <ProtectedRoute>
            <InvitationAcceptPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics/:eventId"
        element={
          <ProtectedRoute>
            <AnalyticsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/:eventId?"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;
