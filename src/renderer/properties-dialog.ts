import { h, put } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { btn, modal } from './dialogs';
import { cleanError, toast } from './toast';
import { copyToClipboard } from './clipboard';
import { formatBytes, formatOctal, modeToSymbolic, parseOctalMode } from '../shared/format';
import type { SftpEntry, SftpStat, SftpTreeSize } from '../shared/types';

export interface PropertiesTarget {
  /** Absolute remote path. */
  path: string;
  entry: SftpEntry;
}

const when = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '–');
const dirname = (p: string) => p.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

const sizeText = (t: SftpTreeSize) =>
  `${formatBytes(t.bytes)} (${t.bytes.toLocaleString()} bytes) · ${plural(t.files, 'file')}, ${plural(t.dirs, 'folder')}${t.truncated ? ' — at least; the folder is very large' : ''}`;

function row(label: string, value: string | Node): HTMLElement {
  return h('div', { class: 'props-row' }, h('div', { class: 'k' }, label), h('div', { class: 'val' }, value));
}

/**
 * Properties of one file or folder (details, folder size, editable permissions),
 * or a summary of several items. `onChanged` runs after a successful change so the listing can refresh.
 */
export function showProperties(connId: string, targets: PropertiesTarget[], onChanged: () => void): Promise<void> {
  if (targets.length === 0) return Promise.resolve();
  const single = targets.length === 1 ? targets[0] : null;

  return modal<void>({ title: 'Properties', width: 540 }, ({ body, foot, close }) => {
    foot.append(h('span', { class: 'spacer' }));
    const closeBtn = btn('Close', 'primary', () => close());
    closeBtn.setAttribute('autofocus', '');

    /* ---------- several items ---------- */
    if (!single) {
      const files = targets.filter((t) => !t.entry.isDir);
      const dirs = targets.filter((t) => t.entry.isDir);
      const direct = files.reduce((n, t) => n + t.entry.size, 0);
      const total = h('span', {}, `${formatBytes(direct)} in the selected files`);
      const calc = h('button', { class: 'btn', type: 'button' }, icon('gauge', 14), 'Calculate total size');
      calc.addEventListener('click', async () => {
        calc.disabled = true;
        total.textContent = 'Calculating…';
        try {
          let bytes = direct;
          let fileCount = files.length;
          let dirCount = 0;
          let truncated = false;
          for (const d of dirs) {
            const t = await window.termApi.sftp.treeSize(connId, d.path);
            bytes += t.bytes;
            fileCount += t.files;
            dirCount += t.dirs + 1;
            truncated ||= t.truncated;
          }
          total.textContent = sizeText({ bytes, files: fileCount, dirs: dirCount, truncated });
        } catch (e) {
          total.textContent = cleanError(e);
        }
        calc.disabled = false;
      });
      put(
        body,
        h('div', { class: 'props-head' }, h('span', { class: 'props-icon' }, icon('files', 22)), h('div', {}, h('strong', {}, plural(targets.length, 'item')), h('div', { class: 'sub' }, `${plural(files.length, 'file')}, ${plural(dirs.length, 'folder')}`))),
        row('Location', dirname(targets[0].path)),
        row('Size', h('div', { class: 'stack' }, total, dirs.length ? calc : null)),
        h('div', { class: 'hint' }, 'Select a single item to see its details and change its permissions.'),
      );
      foot.append(closeBtn);
      return;
    }

    /* ---------- one item ---------- */
    const { path: fullPath, entry } = single;
    const holder = h('div', { class: 'props-body' }, h('div', { class: 'props-loading' }, icon('loader-circle', 18, 'spin'), 'Reading details…'));
    body.append(holder);
    foot.append(closeBtn);

    void window.termApi.sftp.stat(connId, fullPath).then(
      (st) => render(st),
      (e) => holder.replaceChildren(h('div', { class: 'import-note warn' }, icon('triangle-alert', 14), h('span', {}, `Could not read the details: ${cleanError(e)}`))),
    );

    function render(st: SftpStat): void {
      const isDir = st.isLink ? !!st.targetIsDir : st.isDir;
      const ic: IconName = st.isLink ? 'link' : st.isDir ? 'folder' : 'file';
      const kind = st.isLink ? `Symbolic link${st.targetIsDir ? ' to a folder' : ''}` : st.isDir ? 'Folder' : 'File';

      // Size
      const sizeVal = h('span', {}, st.isDir ? '–' : `${formatBytes(st.size)} (${st.size.toLocaleString()} bytes)`);
      const sizeCell = h('div', { class: 'stack' }, sizeVal);
      if (st.isDir) {
        const calc = h('button', { class: 'btn', type: 'button' }, icon('gauge', 14), 'Calculate size');
        calc.addEventListener('click', async () => {
          calc.disabled = true;
          sizeVal.textContent = 'Calculating…';
          try {
            sizeVal.textContent = sizeText(await window.termApi.sftp.treeSize(connId, st.path));
            calc.remove();
          } catch (e) {
            sizeVal.textContent = cleanError(e);
            calc.disabled = false;
          }
        });
        sizeCell.append(calc);
      }

      // Path with a copy button
      const copy = h('button', { class: 'icon-btn', type: 'button', title: 'Copy path', 'aria-label': 'Copy path' }, icon('copy', 14));
      copy.addEventListener('click', () => {
        void copyToClipboard(st.path).then((ok) => ok && toast('success', 'Path copied'));
      });

      // Permissions: nine checkboxes and an octal box that stay in sync
      const original = st.mode;
      let current = st.mode;
      const bits: { label: string; shift: number }[] = [{ label: 'Owner', shift: 6 }, { label: 'Group', shift: 3 }, { label: 'Others', shift: 0 }];
      const kinds: { label: string; bit: number }[] = [{ label: 'Read', bit: 4 }, { label: 'Write', bit: 2 }, { label: 'Execute', bit: 1 }];
      const symbolic = h('code', { class: 'sym' });
      const octal = h('input', { class: 'input octal', value: formatOctal(current), spellcheck: false, maxLength: 4, 'aria-label': 'Permissions in octal' });
      const apply = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Apply permissions');
      const boxes: HTMLInputElement[][] = [];
      const sync = (fromOctal = false) => {
        bits.forEach((b, r) => kinds.forEach((k, c) => (boxes[r][c].checked = !!(current & (k.bit << b.shift)))));
        if (!fromOctal) octal.value = formatOctal(current);
        octal.classList.remove('invalid');
        symbolic.textContent = modeToSymbolic(current, st.isLink ? 'link' : st.isDir ? 'dir' : 'file');
        apply.disabled = current === original;
      };
      const grid = h('div', { class: 'perm-grid', role: 'group', 'aria-label': 'Permissions' }, h('span', {}), ...kinds.map((k) => h('span', { class: 'ph' }, k.label)));
      bits.forEach((b, r) => {
        boxes[r] = [];
        grid.append(h('span', { class: 'pl' }, b.label));
        kinds.forEach((k) => {
          const box = h('input', { type: 'checkbox', 'aria-label': `${b.label} ${k.label.toLowerCase()}` });
          box.addEventListener('change', () => {
            current = box.checked ? current | (k.bit << b.shift) : current & ~(k.bit << b.shift);
            sync();
          });
          boxes[r].push(box);
          grid.append(box);
        });
      });
      octal.addEventListener('input', () => {
        const m = parseOctalMode(octal.value);
        if (m === null) {
          octal.classList.add('invalid');
          apply.disabled = true;
          return;
        }
        current = m;
        sync(true);
      });
      apply.addEventListener('click', async () => {
        apply.disabled = true;
        try {
          await window.termApi.sftp.chmod(connId, st.path, current);
          toast('success', `Permissions of “${st.name}” set to ${formatOctal(current)}`);
          onChanged();
          close();
        } catch (e) {
          toast('error', cleanError(e));
          apply.disabled = false;
        }
      });
      sync();

      holder.replaceChildren();
      put(
        holder,
        h('div', { class: 'props-head' }, h('span', { class: 'props-icon' }, icon(ic, 22)), h('div', { class: 'props-title' }, h('strong', {}, st.name), h('div', { class: 'sub' }, kind))),
        row('Location', dirname(st.path)),
        row('Path', h('div', { class: 'stack' }, h('span', { class: 'mono' }, st.path), copy)),
        st.isLink ? row('Points to', st.linkTarget ?? '(unreadable)') : null,
        row('Size', sizeCell),
        row('Modified', when(st.mtimeMs)),
        row('Accessed', when(st.atimeMs)),
        row('Owner', `user ${st.uid}, group ${st.gid}`),
        h('div', { class: 'props-section' }, h('h4', {}, icon('key-round', 14), 'Permissions'),
          h('div', { class: 'perm-wrap' }, grid, h('div', { class: 'perm-side' }, h('label', {}, 'Octal'), octal, symbolic, apply)),
          isDir && !st.isLink ? h('div', { class: 'hint' }, 'Changes apply to this folder only, not to what is inside it.') : null,
          st.isLink ? h('div', { class: 'hint' }, 'This changes the target of the link.') : null),
      );
    }
  }, undefined);
}
