import { type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { AuthProvider } from '@/context/AuthContext';
import { AppShell } from '@/components/shell/app-shell';

import Home from '@/pages/home';
import Explore from '@/pages/explore';
import Search from '@/pages/search';
import ArtistProfile from '@/pages/artist';
import ProjectDetail from '@/pages/project';
import Pledges from '@/pages/pledges';
import Receipt from '@/pages/receipt';
import Profile from '@/pages/profile';
import Login from '@/pages/login';
import Register from '@/pages/register';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Router() {
  return (
    <AppShell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/explore" component={Explore} />
          <Route path="/search" component={Search} />
          <Route path="/artist/:id" component={ArtistProfile} />
          <Route path="/project/:id" component={ProjectDetail} />
          <Route path="/pledges" component={Pledges} />
          <Route path="/receipt/:id" component={Receipt} />
          <Route path="/profile" component={Profile} />
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AppShell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
