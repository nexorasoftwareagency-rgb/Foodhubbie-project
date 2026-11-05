// === src/App.tsx ===
import { Suspense, lazy } from "react";
import { Switch, Route, Redirect } from "wouter";
import { AuthProvider } from "@/contexts/AuthContext";
import { RiderProvider } from "@/contexts/RiderContext";
import { LocationProvider } from "@/contexts/LocationContext";
import { AuthGuard } from "@/components/layout/AuthGuard";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/toaster";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const AvailablePage = lazy(() => import("@/pages/AvailablePage").then((m) => ({ default: m.AvailablePage })));
const ActiveTripPage = lazy(() => import("@/pages/ActiveTripPage").then((m) => ({ default: m.ActiveTripPage })));
const CompletedPage = lazy(() => import("@/pages/CompletedPage").then((m) => ({ default: m.CompletedPage })));
const WalletPage = lazy(() => import("@/pages/WalletPage").then((m) => ({ default: m.WalletPage })));
const EarningsPage = lazy(() => import("@/pages/EarningsPage").then((m) => ({ default: m.EarningsPage })));
const ProfilePage = lazy(() => import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));

function AppRoutes() {
  return (
    <Suspense fallback={<LoadingSpinner fullscreen label="Loading..." />}>
      <Switch>
        <Route path="/">
          <Redirect to="/dashboard" />
        </Route>
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/available" component={AvailablePage} />
        <Route path="/active" component={ActiveTripPage} />
        <Route path="/completed" component={CompletedPage} />
        <Route path="/wallet" component={WalletPage} />
        <Route path="/earnings" component={EarningsPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route component={NotFoundPage} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGuard>
        <RiderProvider>
          <LocationProvider>
            <AppLayout>
              <ErrorBoundary>
                <AppRoutes />
              </ErrorBoundary>
            </AppLayout>
          </LocationProvider>
        </RiderProvider>
      </AuthGuard>
      <Toaster />
    </AuthProvider>
  );
}
