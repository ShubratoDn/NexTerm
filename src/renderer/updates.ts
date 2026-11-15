import { askConfirm } from './dialogs';
import { emitChange, state } from './state';
import { cleanError, toast } from './toast';
import type { UpdateStatus } from '../shared/types';

let openSessions: () => number = () => 0;

/** Restarts NexTerm into the downloaded update, after warning that open sessions will be closed. */
export async function restartForUpdate(): Promise<void> {
  const n = openSessions();
  if (n > 0) {
    const ok = await askConfirm(
      'Restart NexTerm',
      `Restarting closes your ${n} open session${n === 1 ? '' : 's'}. NexTerm will start again on the new version.`,
      'Restart and install',
    );
    if (!ok) return;
  }
  try {
    await window.termApi.installUpdate();
  } catch (e) {
    toast('error', cleanError(e));
  }
}

/** Follows the automatic update: tells the user when a new version is ready. Call once at startup. */
export function initUpdates(countOpenSessions: () => number): void {
  openSessions = countOpenSessions;
  let announced = '';
  const handle = (s: UpdateStatus) => {
    state.update = s;
    emitChange();
    if (s.state === 'ready' && s.version && announced !== s.version) {
      announced = s.version;
      toast('info', `NexTerm ${s.version} is ready. Restart to install it.`, {
        ms: 20000,
        action: { label: 'Restart now', run: () => void restartForUpdate() },
      });
    }
  };
  void window.termApi.getUpdateStatus().then(handle, () => undefined);
  window.termApi.onUpdateStatus(handle);
  // The Settings dialog asks for a restart through this event, so the two files do not need to import each other.
  document.addEventListener('nexterm:restart-update', () => void restartForUpdate());
}
