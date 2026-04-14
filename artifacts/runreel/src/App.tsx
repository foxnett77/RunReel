import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { LangProvider } from "@/lib/i18n";
import { setDeviceIdGetter } from "@workspace/api-client-react";
import { getDeviceId, initDeviceId } from "@/lib/device";

const Home           = lazy(() => import("@/pages/Home"));
const Activities     = lazy(() => import("@/pages/Activities"));
const ActivityDetail = lazy(() => import("@/pages/ActivityDetail"));
const Live           = lazy(() => import("@/pages/Live"));
const Upload         = lazy(() => import("@/pages/Upload"));
const StravaCallback = lazy(() => import("@/pages/StravaCallback"));
const NotFound       = lazy(() => import("@/pages/not-found"));

// Register getter synchronously — getDeviceId reads localStorage immediately
// so existing devices get their ID on the very first fetch
setDeviceIdGetter(getDeviceId);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

function PageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <svg
        className="animate-spin text-primary"
        width="32" height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </div>
  );
}

function DeviceInit() {
  const qc = useQueryClient();
  useEffect(() => {
    // Handles first-time devices: claim 'default' or generate UUID,
    // then refetch so all queries use the correct device ID.
    initDeviceId().then(() => {
      qc.invalidateQueries();
    });
  }, [qc]);
  return null;
}

function Router() {
  return (
    <Layout>
      <Suspense fallback={<PageSpinner />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/activities" component={Activities} />
          <Route path="/activities/:id" component={ActivityDetail} />
          <Route path="/live" component={Live} />
          <Route path="/upload" component={Upload} />
          <Route path="/strava/callback" component={StravaCallback} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <LangProvider>
      <QueryClientProvider client={queryClient}>
        <DeviceInit />
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </LangProvider>
  );
}

export default App;
