import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../src/App';
import { RequireAuth } from '../src/components/Layout';
import { AuthProvider } from '../src/hooks/useAuth';
import { AccountPage } from '../src/pages/MiscPages';
import type { Role, SessionUser } from '../src/types/api';

/**
 * Regression tests for long emails breaking the sidebar layout (reported with
 * benjamin.anderson.20@students.riverside.edu). jsdom has no layout engine, so
 * these tests load the real stylesheet and assert the computed styles that keep
 * the text inside the sidebar. Pixel overflow itself is checked in a real browser.
 */

// (Not `new URL(…, import.meta.url)`: Vite rewrites that pattern into an asset URL.)
const stylesheet = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/index.css'),
  'utf8',
);
let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement('style');
  style.textContent = stylesheet;
  document.head.append(style);
});
afterAll(() => style.remove());
afterEach(() => vi.unstubAllGlobals());

const makeUser = (role: Role, firstName: string, lastName: string, email: string): SessionUser => ({
  id: `u-${role}`,
  email,
  role,
  firstName,
  lastName,
  schoolId: 's1',
  teacherId: role === 'TEACHER' ? 't1' : null,
  studentId: role === 'STUDENT' ? 'st1' : null,
});

const USERS = [
  makeUser(
    'ADMIN',
    'Margaret',
    'Okonkwo-Harrington',
    'margaret.okonkwo.harrington@administration.riverside.edu',
  ),
  makeUser('TEACHER', 'Sarah', 'Thompson', 'sarah.thompson.mathematics@faculty.riverside.edu'),
  makeUser('STUDENT', 'Benjamin', 'Anderson', 'benjamin.anderson.20@students.riverside.edu'),
];
const benjamin = USERS[2]!;

function renderSignedIn(user: SessionUser, page: ReactNode = <div>page</div>, path = '/page') {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { user } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path={path} element={page} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function expectSingleLineEllipsis(el: HTMLElement) {
  const css = getComputedStyle(el);
  expect(css.overflow).toBe('hidden');
  expect(css.textOverflow).toBe('ellipsis');
  expect(css.whiteSpace).toBe('nowrap');
}

describe('sidebar user info', () => {
  it.each(USERS)(
    '$role: a long email is cut with an ellipsis and shown in full on hover',
    async (user) => {
      renderSignedIn(user);
      const sidebar = await screen.findByRole('complementary', { name: 'Main navigation' });
      const roleLabel = user.role.charAt(0) + user.role.slice(1).toLowerCase();

      const email = within(sidebar).getByTitle(user.email);
      // The ellipsis is visual only: the whole address stays in the DOM for screen readers.
      expect(email).toHaveTextContent(user.email);
      expectSingleLineEllipsis(email);
      // It is a flex item, whose default min-width (auto) is the full text width.
      expect(getComputedStyle(email).minWidth).toMatch(/^0(px)?$/);

      // Role and email are items of a wrapping row: an email that fits stays fully
      // visible beside or below the role; only one wider than the sidebar is cut.
      const meta = email.parentElement!;
      expect(meta).toHaveTextContent(`${roleLabel} · ${user.email}`);
      expect(getComputedStyle(meta).display).toBe('flex');
      expect(getComputedStyle(meta).flexWrap).toBe('wrap');

      // Names keep wrapping at spaces; a single overlong word may break anywhere.
      const name = within(sidebar).getByText(`${user.firstName} ${user.lastName}`);
      expect(getComputedStyle(name).overflowWrap).toBe('anywhere');
    },
  );

  it('the footer column is pinned to the sidebar width', async () => {
    renderSignedIn(benjamin);
    const sidebar = await screen.findByRole('complementary', { name: 'Main navigation' });
    const footer = within(sidebar).getByRole('button', { name: 'Sign out' }).parentElement!;
    // An `auto` grid column grows to its widest unbreakable content (the email),
    // which pushed the text and the Sign out button out of the sidebar.
    expect(getComputedStyle(footer).gridTemplateColumns).toBe('minmax(0, 1fr)');
  });
});

describe('account page', () => {
  it('lets a long email in the header wrap instead of widening the page', async () => {
    renderSignedIn(benjamin, <AccountPage />, '/account');
    const heading = await screen.findByRole('heading', { name: 'Account' });
    const email = within(heading.closest('header')!).getByText(benjamin.email);
    expect(getComputedStyle(email).overflowWrap).toBe('anywhere');
  });
});
