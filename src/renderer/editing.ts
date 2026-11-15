import { askConfirm } from './dialogs';
import { toast } from './toast';

/** Dialogs already open, so one file does not stack up several warnings. */
const asking = new Set<number>();

/**
 * Reports what happens to remote files that are open in a local program: confirmations, a warning when the server
 * copy changed in the meantime, and errors. Call once at startup.
 */
export function initEditing(): void {
  window.termApi.onEditStatus((s) => {
    if (s.state === 'saved') {
      toast('success', `Saved “${s.name}” to the server.`, { ms: 2500 });
    } else if (s.state === 'error') {
      toast('error', `Could not save “${s.name}” to the server: ${s.message ?? 'unknown error'}`, { ms: 12000 });
    } else if (s.state === 'conflict') {
      if (asking.has(s.id)) return;
      asking.add(s.id);
      void askConfirm(
        'File changed on the server',
        `“${s.name}” was changed on the server after you opened it. Do you want to replace the server version with your edited copy? The other changes will be lost.`,
        'Replace server version',
        true,
      )
        .then(async (replace) => {
          if (replace) await window.termApi.editResolve(s.id, true);
          else toast('info', `Kept the server version of “${s.name}”. Your edited copy was not uploaded; save it again to be asked once more.`, { ms: 8000 });
        })
        .catch((e) => toast('error', (e as Error).message))
        .finally(() => asking.delete(s.id));
    }
  });
}
