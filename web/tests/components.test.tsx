import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../src/App';
import { RequireRole } from '../src/components/Layout';
import { RiskExplanation } from '../src/components/RiskFactors';
import { QueryState, RiskBadge } from '../src/components/ui';
import { AuthProvider } from '../src/hooks/useAuth';
import { LoginPage } from '../src/pages/AuthPages';
import { ApiError } from '../src/services/http';
import type { RiskAlert, SessionUser } from '../src/types/api';

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

function mockFetch(routes: Record<string, () => Promise<Response>>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => {
      const [method, path] = k.split(' ');
      return (init?.method ?? 'GET') === method && url.includes(path!);
    });
    return key ? routes[key]!() : json(404, { error: { code: 'NOT_FOUND', message: 'no mock' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderWithProviders(ui: ReactNode, path = '/') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const teacher: SessionUser = {
  id: 'u1',
  email: 'teacher1@riverside.edu',
  role: 'TEACHER',
  firstName: 'Sarah',
  lastName: 'Thompson',
  schoolId: 's1',
  teacherId: 't1',
  studentId: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('RiskBadge', () => {
  it('communicates risk with text, not color alone', () => {
    render(<RiskBadge level="HIGH" score={72} />);
    expect(screen.getByText(/High risk/)).toBeInTheDocument();
    expect(screen.getByText(/72/)).toBeInTheDocument();
  });
  it('shows a neutral label when not evaluated', () => {
    render(<RiskBadge level={null} />);
    expect(screen.getByText('Not evaluated')).toBeInTheDocument();
  });
});

describe('QueryState', () => {
  const base = { data: undefined, isPending: false, isError: false, error: null, refetch: vi.fn() };
  it('renders loading, error (with retry), empty and data states', async () => {
    const { rerender } = render(
      <QueryState query={{ ...base, isPending: true }}>{() => 'content'}</QueryState>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();

    const refetch = vi.fn();
    rerender(
      <QueryState
        query={{
          ...base,
          isError: true,
          error: new ApiError(500, 'X', 'Server exploded'),
          refetch,
        }}
      >
        {() => 'content'}
      </QueryState>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Server exploded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();

    rerender(
      <QueryState query={{ ...base, data: [] as number[] }} isEmpty={(d) => d.length === 0}>
        {() => 'content'}
      </QueryState>,
    );
    expect(screen.getByText('No data yet')).toBeInTheDocument();

    rerender(
      <QueryState query={{ ...base, data: [1, 2] }} isEmpty={(d) => d.length === 0}>
        {(d) => `items: ${d.length}`}
      </QueryState>,
    );
    expect(screen.getByText('items: 2')).toBeInTheDocument();
  });
});

describe('RiskExplanation', () => {
  const alert: RiskAlert = {
    id: 'a1',
    level: 'HIGH',
    previousLevel: 'MEDIUM',
    score: 55,
    metrics: {},
    status: 'OPEN',
    computedAt: '2026-11-05T10:00:00Z',
    acknowledgedAt: null,
    note: null,
    student: { id: 's', studentNumber: 'S1', firstName: 'Ava', lastName: 'Chen', gradeLevel: 9 },
    course: { id: 'c', code: 'MATH-201', name: 'Algebra II' },
    factors: [
      {
        rule: 'attendance',
        severity: 'CRITICAL',
        points: 25,
        value: 70,
        threshold: 80,
        message: 'Attendance is 70% (6 absences), below the 80% threshold',
        suggestion: 'Contact the family.',
      },
    ],
  };
  it('shows each factor with points, the reason and a staff action', () => {
    render(<RiskExplanation alert={alert} />);
    expect(screen.getByText('Low attendance')).toBeInTheDocument();
    expect(screen.getByText(/\+25 pts/)).toBeInTheDocument();
    expect(screen.getByText(/below the 80% threshold/)).toBeInTheDocument();
    expect(screen.getByText(/Suggested action: Contact the family/)).toBeInTheDocument();
    expect(screen.getByText(/was medium/)).toBeInTheDocument();
  });
  it('shows student-friendly tips instead of staff actions for students', () => {
    render(<RiskExplanation alert={alert} audience="student" />);
    expect(screen.queryByText(/Suggested action/)).not.toBeInTheDocument();
    expect(screen.getByText(/Tip:/)).toBeInTheDocument();
  });
});

describe('LoginPage', () => {
  it('signs in and redirects a teacher to the dashboard', async () => {
    const fetchMock = mockFetch({
      'GET /auth/me': () =>
        json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }),
      'POST /auth/login': () => json(200, { data: { user: teacher } }),
    });
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
      </Routes>,
      '/login',
    );
    await userEvent.type(await screen.findByLabelText('Email'), 'teacher1@riverside.edu');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('dashboard page')).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/login'))!;
    expect(loginCall[1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(JSON.parse(String(loginCall[1]!.body))).toEqual({
      email: 'teacher1@riverside.edu',
      password: 'Password123',
    });
  });

  it('shows the API error message on failed login', async () => {
    mockFetch({
      'GET /auth/me': () => json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
      'POST /auth/login': () =>
        json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }),
    });
    renderWithProviders(<LoginPage />, '/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.edu');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('RequireRole', () => {
  it('redirects a student away from staff-only screens', async () => {
    mockFetch({
      'GET /auth/me': () =>
        json(200, {
          data: { user: { ...teacher, role: 'STUDENT', studentId: 'st1', teacherId: null } },
        }),
    });
    renderWithProviders(
      <Routes>
        <Route element={<RequireRole roles={['ADMIN', 'TEACHER']} />}>
          <Route path="/students" element={<div>staff only</div>} />
        </Route>
        <Route path="/me" element={<div>student home</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>,
      '/students',
    );
    await waitFor(() => expect(screen.getByText('student home')).toBeInTheDocument());
    expect(screen.queryByText('staff only')).not.toBeInTheDocument();
  });
});
