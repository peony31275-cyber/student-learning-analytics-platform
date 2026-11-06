import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../src/App';
import { RequireAuth, RequireRole } from '../src/components/Layout';
import { AuthProvider } from '../src/hooks/useAuth';
import { AccountPage } from '../src/pages/MiscPages';
import { http } from '../src/services/http';
import type { SessionUser } from '../src/types/api';

/**
 * Regression tests for the sign-out bug: after "Sign out" the UI kept the old
 * shell and user name, and protected pages showed "Authentication required"
 * instead of returning to /login.
 */

const json = (status: number, body?: unknown) =>
  Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
const unauthorized = () =>
  json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

const teacher: SessionUser = {
  id: 'u1',
  email: 'teacher1@riverside.edu',
  role: 'TEACHER',
  firstName: 'Sarah',
  lastName: 'Thompson',
  schoolId: 's1',
  teacherId: 't1',
  studentId: null,
  mustChangePassword: false,
};
const student: SessionUser = {
  ...teacher,
  id: 'u2',
  email: 'student1@riverside.edu',
  role: 'STUDENT',
  firstName: 'Ava',
  lastName: 'Chen',
  teacherId: null,
  studentId: 'st1',
};

/** A fake server with a session cookie that logout really ends. */
function fakeServer(user: SessionUser) {
  let signedIn = true;
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.includes('/auth/logout')) {
      signedIn = false;
      return json(204);
    }
    if (!signedIn) return unauthorized();
    if (url.includes('/auth/me')) return json(200, { data: { user } });
    if (url.includes('/risk-alerts')) return json(200, { data: [{ id: 'secret-alert' }] });
    return json(404, { error: { code: 'NOT_FOUND', message: 'no mock' } });
  });
  vi.stubGlobal('fetch', fn);
  return {
    fetch: fn,
    expireSession: () => {
      signedIn = false;
    },
  };
}

/** Stand-in for a protected page that loads data (like Risk alerts). */
function AlertsProbe() {
  const q = useQuery({
    queryKey: ['risk-alerts', 'list'],
    queryFn: () => http.get<{ data: { id: string }[] }>('/risk-alerts'),
  });
  if (q.isError) return <div>{q.error.message}</div>;
  return <div>alerts page {q.data?.data.length ?? '…'}</div>;
}

function renderApp(path: string) {
  const qc = createQueryClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<div>login screen</div>} />
            <Route element={<RequireAuth />}>
              <Route path="/account" element={<AccountPage />} />
              <Route element={<RequireRole roles={['ADMIN', 'TEACHER']} />}>
                <Route path="/alerts" element={<AlertsProbe />} />
              </Route>
              <Route element={<RequireRole roles={['STUDENT']} />}>
                <Route path="/me" element={<div>my progress</div>} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

/** Only the (now empty) session entry may remain in the cache after sign-out. */
const protectedQueries = (qc: ReturnType<typeof createQueryClient>) =>
  qc
    .getQueryCache()
    .findAll()
    .filter((q) => q.queryKey[0] !== 'me');

afterEach(() => vi.unstubAllGlobals());

describe('sign out', () => {
  it('teacher: sidebar Sign out ends the session, clears cached data and shows /login', async () => {
    const server = fakeServer(teacher);
    const { qc } = renderApp('/alerts');
    expect(await screen.findByText('alerts page 1')).toBeInTheDocument();
    expect(screen.getByText('Sarah Thompson')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText('Sarah Thompson')).not.toBeInTheDocument();
    expect(screen.queryByText(/Authentication required/)).not.toBeInTheDocument();
    expect(server.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(qc.getQueryData(['me'])).toBeNull();
    expect(protectedQueries(qc)).toHaveLength(0);
  });

  it('student: Account page Sign out returns to /login', async () => {
    fakeServer(student);
    const { qc } = renderApp('/account');
    expect(await screen.findByText(/Signed in as Ava Chen/)).toBeInTheDocument();

    // The Account card and the sidebar both have a Sign out button; use the page's one.
    const buttons = screen.getAllByRole('button', { name: 'Sign out' });
    await userEvent.click(buttons[buttons.length - 1]!);

    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText(/Ava Chen/)).not.toBeInTheDocument();
    expect(qc.getQueryData(['me'])).toBeNull();
  });

  it('still signs out locally when the logout request fails', async () => {
    const server = fakeServer(teacher);
    renderApp('/alerts');
    await screen.findByText('alerts page 1');
    server.fetch.mockImplementationOnce(() => Promise.reject(new TypeError('network down')));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('login screen')).toBeInTheDocument();
  });
});

describe('route protection', () => {
  it('a 401 from any protected request drops to /login and hides the old user', async () => {
    const server = fakeServer(teacher);
    const { qc } = renderApp('/alerts');
    await screen.findByText('alerts page 1');

    server.expireSession(); // cookie expired / revoked on the server
    await qc.refetchQueries({ queryKey: ['risk-alerts'] });

    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText('Sarah Thompson')).not.toBeInTheDocument();
    expect(screen.queryByText(/Authentication required/)).not.toBeInTheDocument();
    expect(protectedQueries(qc)).toHaveLength(0);
  });

  it('protected pages redirect to /login without a session', async () => {
    fakeServer(teacher).expireSession();
    renderApp('/alerts');
    expect(await screen.findByText('login screen')).toBeInTheDocument();
  });

  it('after signing out, opening a protected page again stays on /login', async () => {
    fakeServer(student);
    const first = renderApp('/me');
    await screen.findByText('my progress');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByText('login screen');
    first.unmount();

    renderApp('/me'); // e.g. a reload or the URL typed again: the server says 401
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('my progress')).not.toBeInTheDocument());
  });
});
