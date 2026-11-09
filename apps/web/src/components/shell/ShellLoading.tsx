import { LogoMark } from '@/components/Logo';

/** Shown for the moment it takes to confirm who is signed in. */
export function ShellLoading() {
  return (
    <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading">
      <LogoMark size={56} className="animate-pulse" />
    </div>
  );
}
