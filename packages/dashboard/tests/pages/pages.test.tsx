import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/App.js';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('page routing', () => {
  // Each page renders its own heading — asserting the heading confirms that
  // the correct page component mounted.
  const cases: Array<{ path: string; heading: string }> = [
    { path: '/', heading: 'Overview' },
    { path: '/agents', heading: 'Agents' },
    { path: '/memory', heading: 'Memory' },
    { path: '/skills', heading: 'Skills' },
    { path: '/scheduler', heading: 'Scheduler' },
    { path: '/health', heading: 'Health' },
    { path: '/costs', heading: 'Costs' },
    { path: '/audit', heading: 'Audit' },
    { path: '/settings', heading: 'Settings' },
  ];
  for (const { path, heading } of cases) {
    it(`renders ${heading} at ${path}`, () => {
      renderAt(path);
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy();
    });
  }
});

describe('sidebar navigation', () => {
  it('renders links for all 10 primary routes', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const label of [
      'Home',
      'Chat',
      'Agents',
      'Memory',
      'Skills',
      'Scheduler',
      'Health',
      'Costs',
      'Audit',
      'Settings',
    ]) {
      expect(nav.textContent).toContain(label);
    }
  });
});
