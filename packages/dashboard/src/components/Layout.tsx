import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar.js';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full bg-white text-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
