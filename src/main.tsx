import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireRole } from "@/components/RequireRole";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NoRole = lazy(() => import("./pages/NoRole.tsx"));
const JudgeTeams = lazy(() => import("./pages/judge/JudgeTeams.tsx"));
const JudgeReview = lazy(() => import("./pages/judge/JudgeReview.tsx"));
const AdminOverview = lazy(() => import("./pages/admin/AdminOverview.tsx"));
const AdminHackathon = lazy(() => import("./pages/admin/AdminHackathon.tsx"));
const AdminRubric = lazy(() => import("./pages/admin/AdminRubric.tsx"));
const AdminJudges = lazy(() => import("./pages/admin/AdminJudges.tsx"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit.tsx"));
const AdminTeams = lazy(() => import("./pages/admin/AdminTeams.tsx"));
const AdminTeamDetail = lazy(
  () => import("./pages/admin/AdminTeamDetail.tsx"),
);
const ParticipantHome = lazy(
  () => import("./pages/participant/ParticipantHome.tsx"),
);
const ParticipantTeam = lazy(
  () => import("./pages/participant/ParticipantTeam.tsx"),
);
const ParticipantSubmission = lazy(
  () => import("./pages/participant/ParticipantSubmission.tsx"),
);
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/no-role"
                element={
                  <RequireAuth>
                    <NoRole />
                  </RequireAuth>
                }
              />

              {/* Admin surface. */}
              <Route
                path="/admin"
                element={
                  <RequireAuth>
                    <RequireRole allow={["admin"]}>
                      <AdminOverview />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/hackathon"
                element={
                  <RequireAuth>
                    <RequireRole allow={["admin"]}>
                      <AdminHackathon />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/rubric"
                element={
                  <RequireAuth>
                    <RequireRole allow={["admin"]}>
                      <AdminRubric />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/judges"
                element={
                  <RequireAuth>
                    <RequireRole allow={["admin"]}>
                      <AdminJudges />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/audit"
                element={
                  <RequireAuth>
                    <RequireRole allow={["admin"]}>
                      <AdminAudit />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/teams"
                element={
                  <RequireAuth>
                    <RequireRole allow={["admin"]}>
                      <AdminTeams />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/teams/:teamId"
                element={
                  <RequireAuth>
                    <RequireRole allow={["admin"]}>
                      <AdminTeamDetail />
                    </RequireRole>
                  </RequireAuth>
                }
              />

              {/* Judge surface. */}
              <Route
                path="/judge"
                element={
                  <RequireAuth>
                    <RequireRole allow={["judge"]}>
                      <JudgeTeams />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/judge/teams/:teamId"
                element={
                  <RequireAuth>
                    <RequireRole allow={["judge"]}>
                      <JudgeReview />
                    </RequireRole>
                  </RequireAuth>
                }
              />

              {/* Participant surface. */}
              <Route
                path="/participant"
                element={
                  <RequireAuth>
                    <RequireRole allow={["participant"]}>
                      <ParticipantHome />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/participant/team"
                element={
                  <RequireAuth>
                    <RequireRole allow={["participant"]}>
                      <ParticipantTeam />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/participant/submission"
                element={
                  <RequireAuth>
                    <RequireRole allow={["participant"]}>
                      <ParticipantSubmission />
                    </RequireRole>
                  </RequireAuth>
                }
              />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
