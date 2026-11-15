import { cleanError, toast } from './toast';

/** Copies text to the system clipboard. Reports a failure instead of ignoring it. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await window.termApi.writeClipboard(text);
    return true;
  } catch (e) {
    toast('error', `Could not copy: ${cleanError(e)}`);
    return false;
  }
}

/** The text on the system clipboard, or "" when it cannot be read. */
export async function readFromClipboard(): Promise<string> {
  try {
    return await window.termApi.readClipboard();
  } catch (e) {
    toast('error', `Could not paste: ${cleanError(e)}`);
    return '';
  }
}
