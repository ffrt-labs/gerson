import type { ReactNode } from 'react';
import { JobStatusBar } from './JobStatusBar';

interface SurfaceProps {
  header: ReactNode;
  children: ReactNode;
  mainClassName?: string;
}

export function Surface({ header, children, mainClassName }: SurfaceProps) {
  return (
    <div className="surface">
      <header className="surface-header">{header}</header>
      <main className={['surface-main', mainClassName].filter(Boolean).join(' ')}>
        {children}
      </main>
      <JobStatusBar />
    </div>
  );
}
