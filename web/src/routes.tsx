import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { withSuspense } from './components/Suspense';

/**
 * Route-level code splitting: chart-heavy pages (Recharts) load on demand, so
 * the login screen does not download the charting library.
 */
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const StudentsPage = lazy(() =>
  import('./pages/StudentsPage').then((m) => ({ default: m.StudentsPage })),
);
const StudentDetailPage = lazy(() =>
  import('./pages/StudentDetailPage').then((m) => ({ default: m.StudentDetailPage })),
);
const CourseDetailPage = lazy(() =>
  import('./pages/CourseDetailPage').then((m) => ({ default: m.CourseDetailPage })),
);
const AlertsPage = lazy(() =>
  import('./pages/AlertsPage').then((m) => ({ default: m.AlertsPage })),
);
const MyProgressPage = lazy(() =>
  import('./pages/MyProgressPage').then((m) => ({ default: m.MyProgressPage })),
);
const UsersPage = lazy(() => import('./pages/AdminPages').then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() =>
  import('./pages/AdminPages').then((m) => ({ default: m.SettingsPage })),
);

export const StaffRoutes: RouteObject[] = [
  { path: 'dashboard', element: withSuspense(<DashboardPage />) },
  { path: 'students', element: withSuspense(<StudentsPage />) },
  { path: 'students/:id', element: withSuspense(<StudentDetailPage />) },
  { path: 'alerts', element: withSuspense(<AlertsPage />) },
];
export const CourseRoutes: RouteObject[] = [
  { path: 'courses/:id', element: withSuspense(<CourseDetailPage />) },
];
export const AdminRoutes: RouteObject[] = [
  { path: 'admin/users', element: withSuspense(<UsersPage />) },
  { path: 'admin/settings', element: withSuspense(<SettingsPage />) },
];
export const StudentRoutes: RouteObject[] = [
  { path: 'me', element: withSuspense(<MyProgressPage />) },
];
