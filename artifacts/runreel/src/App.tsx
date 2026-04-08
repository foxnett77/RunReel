import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Activities from "@/pages/Activities";
import ActivityDetail from "@/pages/ActivityDetail";
import Live from "@/pages/Live";
import Upload from "@/pages/Upload";
import NotFound from "@/pages/not-found";
import StravaCallback from "@/pages/StravaCallback";
import { LangProvider } from "@/lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/activities" component={Activities} />
        <Route path="/activities/:id" component={ActivityDetail} />
        <Route path="/live" component={Live} />
        <Route path="/upload" component={Upload} />
        <Route path="/strava/callback" component={StravaCallback} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <LangProvider>
      <QueryClientProvider client={queryClient}>
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
