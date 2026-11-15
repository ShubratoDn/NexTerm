import type { UpdateStatus } from './types';

export interface UpdateView {
  /** One sentence for Settings. */
  text: string;
  /** "Check now" makes sense. */
  canCheck: boolean;
  /** A downloaded update is waiting for a restart. */
  canInstall: boolean;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Words for the state of the automatic update. */
export function describeUpdate(u: UpdateStatus | null): UpdateView {
  if (!u) return { text: 'Reading the update state…', canCheck: false, canInstall: false };
  switch (u.state) {
    case 'unsupported':
      return { text: u.message ?? 'Automatic updates are not available for this copy.', canCheck: false, canInstall: false };
    case 'idle':
      return { text: 'Not checked yet.', canCheck: true, canInstall: false };
    case 'checking':
      return { text: 'Checking for a new version…', canCheck: false, canInstall: false };
    case 'downloading':
      return { text: `Downloading version ${u.version ?? ''}${u.percent !== undefined ? ` (${u.percent}%)` : ''}…`, canCheck: false, canInstall: false };
    case 'ready':
      return { text: `Version ${u.version ?? ''} is downloaded. Restart NexTerm to install it.`, canCheck: false, canInstall: true };
    case 'current':
      return { text: `You have the latest version${u.checkedAt ? ` (checked at ${clock(u.checkedAt)})` : ''}.`, canCheck: true, canInstall: false };
    case 'error':
      return { text: `Could not check for updates: ${u.message ?? 'unknown error'}`, canCheck: true, canInstall: false };
  }
}
