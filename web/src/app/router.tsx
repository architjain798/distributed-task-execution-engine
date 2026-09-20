import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '../components/layout/app-shell';
import { AnalyticsRoute } from './routes/analytics';
import { DashboardRoute } from './routes/dashboard';
import { TasksRoute } from './routes/tasks';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardRoute /> },
      { path: 'tasks', element: <TasksRoute /> },
      { path: 'analytics', element: <AnalyticsRoute /> },
    ],
  },
]);
