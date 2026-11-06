import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../src/App';
import { InviteModal } from '../src/components/InviteModal';
import { RequireAuth } from '../src/components/Layout';
import { AuthProvider } from '../src/hooks/useAuth';
import { ActivatePage, ChangePasswordPage } from '../src/pages/AccountSetupPages';
import { LoginPage } from '../src/pages/AuthPages';
import type { SessionUser, StudentDetail } from '../src/types/api';

const json = (status: number, body?: unknown) =>
  Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
const apiError = (status: number, code: string, message = code) =>
  json(status, { error: { code, message } });
const signedOut = () => apiError(401, 'UNAUTHORIZED', 'Authentication required');
const pathOf = (input: RequestInfo | URL) => new URL(String(input), 'http://app.test').pathname;

/** Routes requests by "METHOD /path" (exact path under /api/v1). */
function mockApi(handlers: Record<string, () => Promise<Response>>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${pathOf(input).replace('/api/v1', '')}`;
    return handlers[key]?.() ?? apiError(404, 'NOT_FOUND', `no mock for ${key}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderAt(path: string, routes: ReactNode, client = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>{routes}</Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const TOKEN = 'k3Jx9QvT2bW7nY4pL8sD1fH6gZ0cR5mA2eU9iO3tV7q';
const STUDENT_EMAIL = 'benjamin.patel.50@students.riverside.edu';
const teacher: SessionUser = {
  id: 'u1',
  email: 'new.teacher@riverside.edu',
  role: 'TEACHER',
  firstName: 'New',
  lastName: 'Teacher',
  schoolId: 's1',
  teacherId: 't1',
  studentId: null,
  mustChangePassword: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('student activation page', () => {
  const activationRoutes = (
    <>
      <Route path="/activate" element={<ActivatePage />} />
      <Route path="/login" element={<LoginPage />} />
    </>
  );

  it('without a link, explains that activation needs a personal link (no form)', async () => {
    mockApi({ 'GET /auth/me': signedOut });
    renderAt('/activate', activationRoutes);
    expect(await screen.findByText(/uses a personal link from your school/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it.each([
    [400, 'ACTIVATION_TOKEN_INVALID', 'This activation link is not valid'],
    [410, 'ACTIVATION_TOKEN_EXPIRED', 'This activation link has expired'],
    [410, 'ACTIVATION_TOKEN_USED', 'This activation link has already been used'],
    [410, 'ACTIVATION_TOKEN_REVOKED', 'This activation link was replaced'],
  ])('shows a clear message for %s %s', async (status, code, text) => {
    mockApi({
      'GET /auth/me': signedOut,
      'POST /auth/activation/verify': () => apiError(status, code),
    });
    renderAt(`/activate#token=${TOKEN}`, activationRoutes);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByLabelText(/New password/)).not.toBeInTheDocument();
  });

  it('a disabled account cannot be activated: shows the server reason', async () => {
    mockApi({
      'GET /auth/me': signedOut,
      'POST /auth/activation/verify': () =>
        apiError(
          409,
          'ACCOUNT_EXISTS',
          'This student’s account is disabled. Contact an administrator.',
        ),
    });
    renderAt(`/activate#token=${TOKEN}`, activationRoutes);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This account cannot be activated');
    expect(alert).toHaveTextContent('account is disabled');
  });

  it('a valid link lets the student set a password, then sends them to sign in', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': signedOut,
      'POST /auth/activation/verify': () =>
        json(200, {
          data: {
            firstName: 'Benjamin',
            lastName: 'Patel',
            email: STUDENT_EMAIL,
            school: 'Riverside High',
          },
        }),
      'POST /auth/activation': () => json(201, { data: { email: STUDENT_EMAIL } }),
    });
    renderAt(`/activate#token=${TOKEN}`, activationRoutes);

    expect(await screen.findByText('Benjamin Patel · Riverside High')).toBeInTheDocument();
    expect(screen.getByLabelText(/School email/)).toHaveValue(STUDENT_EMAIL);

    await userEvent.type(screen.getByLabelText(/New password/), 'MyPass123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Different1');
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The passwords do not match');
    expect(fetchMock.mock.calls.some(([u]) => pathOf(u).endsWith('/auth/activation'))).toBe(false);

    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), 'MyPass123');
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Your account is active');
    expect(screen.getByLabelText('Email')).toHaveValue(STUDENT_EMAIL);
    const call = fetchMock.mock.calls.find(([u]) => pathOf(u).endsWith('/auth/activation'))!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ token: TOKEN, password: 'MyPass123' });
    // The token only ever travels in POST bodies, never in a request URL.
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes(TOKEN))).toBe(true);
  });
});

describe('first sign-in with a temporary password', () => {
  it('signing in with a temporary password goes to the change-password screen', async () => {
    mockApi({
      'GET /auth/me': signedOut,
      'POST /auth/login': () => json(200, { data: { user: teacher } }),
    });
    renderAt(
      '/login',
      <>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<div>change password screen</div>} />
        <Route path="/dashboard" element={<div>teacher dashboard</div>} />
      </>,
    );
    await userEvent.type(await screen.findByLabelText('Email'), teacher.email);
    await userEvent.type(screen.getByLabelText('Password'), 'TempPass123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('change password screen')).toBeInTheDocument();
    expect(screen.queryByText('teacher dashboard')).not.toBeInTheDocument();
  });

  it('protected pages redirect to it; after the change the user signs in again', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': () => json(200, { data: { user: teacher } }),
      'PATCH /auth/password': () => json(204),
    });
    renderAt(
      '/dashboard',
      <>
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<div>teacher dashboard</div>} />
        </Route>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/login" element={<LoginPage />} />
      </>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Set your own password' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('teacher dashboard')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Temporary password'), 'TempPass123');
    await userEvent.type(screen.getByLabelText(/^New password/), 'MyOwnPass456');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'MyOwnPass456');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Your password was changed');
    expect(screen.getByLabelText('Email')).toHaveValue(teacher.email);
    // Only the session endpoints were called: no business API before the change.
    const paths = fetchMock.mock.calls.map(([u]) => pathOf(u));
    expect(paths).toContain('/api/v1/auth/password');
    expect(paths.every((p) => /\/auth\/(me|password)$/.test(p))).toBe(true);
  });
});

describe('staff activation invite', () => {
  const student: StudentDetail = {
    id: 'st9',
    studentNumber: 'S2026050',
    firstName: 'Benjamin',
    lastName: 'Patel',
    email: STUDENT_EMAIL,
    gradeLevel: 10,
    status: 'ACTIVE',
    hasAccount: false,
    account: { status: 'NONE', pendingInvite: null },
    riskLevel: null,
    enrollments: [],
  };
  const renderModal = (s: StudentDetail) =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <InviteModal student={s} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  const link = `http://localhost:5173/activate#token=${TOKEN}`;
  const created = () =>
    json(201, {
      data: { delivery: 'dev-link', expiresAt: '2026-11-07T12:00:00.000Z', activationUrl: link },
    });

  it('creates a link and shows it with a development-only warning', async () => {
    mockApi({ 'POST /students/st9/activation-invite': created });
    renderModal(student);
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Activation link created');
    expect(screen.getByText(/Development only/)).toBeInTheDocument();
    expect(screen.getByLabelText('Activation link')).toHaveValue(link);
  });

  it('says when a new link replaces a pending one', async () => {
    mockApi({ 'POST /students/st9/activation-invite': created });
    renderModal({
      ...student,
      account: {
        status: 'NONE',
        pendingInvite: { createdAt: '2026-11-06T09:00:00Z', expiresAt: '2026-11-07T09:00:00Z' },
      },
    });
    expect(screen.getByText(/Creating a new one replaces it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create new link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The previous link no longer works',
    );
  });

  it('explains when the server has no secure delivery and shows no link', async () => {
    mockApi({
      'POST /students/st9/activation-invite': () =>
        apiError(
          503,
          'INVITES_DISABLED',
          'Activation invites are turned off: this server has no secure way to deliver them (such as email).',
        ),
    });
    renderModal(student);
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Activation invites are turned off');
    expect(screen.queryByLabelText('Activation link')).not.toBeInTheDocument();
  });
});

describe('route guards after the session ends', () => {
  const student: SessionUser = {
    ...teacher,
    id: 'u2',
    email: 'student1@riverside.edu',
    role: 'STUDENT',
    teacherId: null,
    studentId: 'st1',
    mustChangePassword: false,
  };
  const guarded = (
    <>
      <Route element={<RequireAuth />}>
        <Route path="/account" element={<div>account page</div>} />
        <Route path="/me" element={<div>student home</div>} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
    </>
  );
  async function signInAsStudent() {
    await userEvent.type(await screen.findByLabelText('Email'), student.email);
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }
  function signedOutClient(deliberately: boolean) {
    const client = createQueryClient();
    client.setQueryData(['me'], null);
    if (deliberately) client.setQueryData(['me', 'ended'], {});
    return client;
  }

  it('after a deliberate sign-out, the guard does not remember the previous page', async () => {
    mockApi({ 'POST /auth/login': () => json(200, { data: { user: student } }) });
    renderAt('/account', guarded, signedOutClient(true));
    await signInAsStudent();
    expect(await screen.findByText('student home')).toBeInTheDocument();
    expect(screen.queryByText('account page')).not.toBeInTheDocument();
  });

  it('after an expired session, the guard still returns the user to their page', async () => {
    mockApi({ 'POST /auth/login': () => json(200, { data: { user: student } }) });
    renderAt('/account', guarded, signedOutClient(false));
    await signInAsStudent();
    expect(await screen.findByText('account page')).toBeInTheDocument();
  });
});
