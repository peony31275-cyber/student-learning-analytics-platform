import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';
import { RequireAuth, RequireRole, homeFor } from './components/Layout';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AdminRoutes, CourseRoutes, StaffRoutes, StudentRoutes } from './routes';
import { ActivatePage, ChangePasswordPage } from './pages/AccountSetupPages';
import { LoginPage } from './pages/AuthPages';
import { AccountPage, NotFoundPage } from './pages/MiscPages';
import { CoursesPage } from './pages/CoursesPage';
import { ApiError } from './services/http';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Dashboard data changes when teachers enter grades, not second by second;
        // 30s of freshness removes duplicate requests when navigating between pages.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Never retry client errors (401/403/404/400); retry transient failures once.
        retry: (count, err) =>
          !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
      },
    },
  });
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/activate', element: <ActivatePage /> },
  { path: '/register', element: <Navigate to="/activate" replace /> },
  // Outside the app shell: the only screen for a user with a temporary password.
  { path: '/change-password', element: <ChangePasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      { index: true, element: <Home /> },
      { path: 'courses', element: <CoursesPage /> },
      { path: 'account', element: <AccountPage /> },
      { element: <RequireRole roles={['STUDENT']} />, children: StudentRoutes },
      {
        element: <RequireRole roles={['ADMIN', 'TEACHER']} />,
        children: [...StaffRoutes, ...CourseRoutes],
      },
      { element: <RequireRole roles={['ADMIN']} />, children: AdminRoutes },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

const queryClient = createQueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
