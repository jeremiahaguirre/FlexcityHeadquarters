import { Fingerprint, ScanFace } from 'lucide-react';

/** Fingerprint + face: what most people's devices use to unlock a passkey. */
export function PasskeyIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      <Fingerprint className={className} />
      <ScanFace className={className} />
    </span>
  );
}
