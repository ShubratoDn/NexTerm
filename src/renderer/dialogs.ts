import { $, h, put } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { defaultPort, parseQuickTarget } from '../shared/quick';
import type { AuthMethod, SessionInput, SessionKind, SessionSummary, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

export const KIND_META: Record<SessionKind, { label: string; icon: IconName }> = {
  ssh: { label: 'SSH', icon: 'terminal' },
  sftp: { label: 'SFTP', icon: 'folder' },
  telnet: { label: 'Telnet', icon: 'plug' },
  local: { label: 'Local', icon: 'square-terminal' },
  serial: { label: 'Serial', icon: 'cable' },
};

/* ------------------------------------------------------------------ modal framework */

interface Ctx<T> {
  body: HTMLElement;
  foot: HTMLElement;
  close: (v: T) => void;
  dlg: HTMLDialogElement;
}

export function modal<T>(opts: { title: string; subtitle?: string; width?: number }, build: (c: Ctx<T>) => void, onCancel: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const dlg = h('dialog', { class: 'modal', style: `--w:${opts.width ?? 520}px`, 'aria-label': opts.title });
    const body = h('div', { class: 'modal-body' });
    const foot = h('div', { class: 'modal-foot' });
    let finished = false;
    const close = (v: T) => {
      if (finished) return;
      finished = true;
      dlg.close();
      dlg.remove();
      if (prev?.isConnected) prev.focus();
      resolve(v);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(onCancel);
    });
    dlg.addEventListener('mousedown', (e) => {
      if (e.target === dlg) close(onCancel); // click on the backdrop
    });
    put(
      dlg,
      h('div', { class: 'modal-head' }, h('h2', {}, opts.title), h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => close(onCancel) }, icon('x', 16))),
      opts.subtitle ? h('p', { class: 'modal-sub' }, opts.subtitle) : null,
      body,
      foot,
    );
    build({ body, foot, close, dlg });
    $('dialogs').append(dlg);
    dlg.showModal();
    (dlg.querySelector<HTMLElement>('[autofocus]') ?? dlg.querySelector<HTMLElement>('.modal-body input:not([type=checkbox]), .modal-body select'))?.focus();
  });
}

export interface Field {
  el: HTMLElement;
  error: (msg: string | null) => void;
}

export function field(label: string, control: HTMLElement, hint?: string): Field {
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  const target = control.matches('input, select') ? control : control.querySelector('input, select');
  if (target) target.id = id;
  const err = h('div', { class: 'error', role: 'alert' });
  const el = h('div', { class: 'field' }, h(target ? 'label' : 'div', target ? { htmlFor: id } : { class: 'lbl' }, label), control, hint ? h('div', { class: 'hint' }, hint) : null, err);
  return {
    el,
    error: (msg) => {
      err.textContent = msg ?? '';
      (target as HTMLElement | null)?.classList.toggle('invalid', !!msg);
    },
  };
}

interface Seg<T extends string> {
  el: HTMLElement;
  value: () => T;
  set: (v: T) => void;
}

function segmented<T extends string>(options: { value: T; label: string; icon?: IconName }[], initial: T, onChange: (v: T) => void, full = false): Seg<T> {
  let cur = initial;
  const el = h('div', { class: `segmented${full ? ' full' : ''}`, role: 'radiogroup' });
  const paint = () => {
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === cur));
  };
  for (const o of options) {
    const b = h('button', { type: 'button', role: 'radio', 'data-v': o.value }, o.icon ? icon(o.icon, 14) : null, o.label);
    b.addEventListener('click', () => {
      cur = o.value;
      paint();
      onChange(cur);
    });
    el.append(b);
  }
  paint();
  return { el, value: () => cur, set: (v) => { cur = v; paint(); } };
}

function toggle(initial: boolean, onChange: (v: boolean) => void, label: string): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(initial), 'aria-label': label });
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

function passwordInput(placeholder = ''): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { class: 'input', type: 'password', placeholder, autocomplete: 'off', spellcheck: false });
  const eye = h('button', { type: 'button', class: 'icon-btn', title: 'Show password', 'aria-label': 'Show password' }, icon('eye', 15));
  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.replaceChildren(icon(show ? 'eye-off' : 'eye', 15));
    eye.title = eye.ariaLabel = show ? 'Hide password' : 'Show password';
  });
  return { el: h('div', { class: 'input-group' }, input, eye), input };
}

export const btn = (label: string, cls: string, onclick: () => void, ic?: IconName) =>
  h('button', { type: 'button', class: `btn ${cls}`, onclick }, ic ? icon(ic, 15) : null, label);

function submitOnEnter(root: HTMLElement, fn: () => void): void {
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && !e.shiftKey && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') {
      e.preventDefault();
      fn();
    }
  });
}

/* ------------------------------------------------------------------ simple prompts */

export function askText(title: string, label: string, initial = '', confirmLabel = 'OK'): Promise<string | null> {
  return modal<string | null>({ title, width: 420 }, ({ body, foot, close }) => {
    const input = h('input', { class: 'input', value: initial, spellcheck: false, autofocus: true });
    const f = field(label, input);
    const submit = () => {
      const v = input.value.trim();
      if (!v) return f.error('Enter a value');
      close(v);
    };
    body.append(f.el);
    submitOnEnter(body, submit);
    foot.append(h('span', { class: 'spacer' }), btn('Cancel', '', () => close(null)), btn(confirmLabel, 'primary', submit));
    queueMicrotask(() => input.select());
  }, null);
}

export function askConfirm(title: string, message: string, confirmLabel = 'Confirm', danger = false): Promise<boolean> {
  return modal<boolean>({ title, width: 420 }, ({ body, foot, close }) => {
    body.append(h('p', { style: 'margin:0;color:var(--text-2);line-height:1.55' }, message));
    const ok = btn(confirmLabel, danger ? 'danger-solid' : 'primary', () => close(true));
    ok.setAttribute('autofocus', '');
    foot.append(h('span', { class: 'spacer' }), btn('Cancel', '', () => close(false)), ok);
  }, false);
}

export function askSecret(opts: { title: string; message: string; confirmLabel?: string; remember?: string }): Promise<{ value: string; remember: boolean } | null> {
  return modal<{ value: string; remember: boolean } | null>({ title: opts.title, subtitle: opts.message, width: 420 }, ({ body, foot, close }) => {
    const pw = passwordInput();
    pw.input.setAttribute('autofocus', '');
    const remember = h('input', { type: 'checkbox' });
    body.append(field('Password', pw.el).el);
    if (opts.remember) body.append(h('label', { class: 'check' }, remember, opts.remember));
    const submit = () => close({ value: pw.input.value, remember: remember.checked });
    submitOnEnter(body, submit);
    foot.append(h('span', { class: 'spacer' }), btn('Cancel', '', () => close(null)), btn(opts.confirmLabel ?? 'Continue', 'primary', submit));
  }, null);
}

/* ------------------------------------------------------------------ session editor */

export type SessionDialogResult = { action: 'save' | 'connect'; input: SessionInput } | { action: 'delete' } | null;

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

function shellPresets(): string[] {
  return window.termApi.platform === 'win32' ? ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'wsl.exe'] : ['/bin/bash', '/bin/zsh', '/bin/sh', '/usr/bin/fish'];
}

export function sessionDialog(existing: SessionSummary | undefined, serialPorts: string[], folders: string[]): Promise<SessionDialogResult> {
  const e = existing;
  return modal<SessionDialogResult>({ title: e ? 'Edit session' : 'New session', width: 540 }, ({ body, foot, close }) => {
    let kind: SessionKind = e?.kind ?? 'ssh';
    const kindSeg = segmented(
      (Object.keys(KIND_META) as SessionKind[]).map((k) => ({ value: k, label: KIND_META[k].label, icon: KIND_META[k].icon })),
      kind,
      (k) => { kind = k; refresh(); },
      true,
    );

    const name = h('input', { class: 'input', value: e?.name ?? '', placeholder: 'Defaults to the host name', spellcheck: false });
    const folder = h('input', { class: 'input', value: e?.folder ?? '', list: 'dlg-folders', placeholder: 'Optional', spellcheck: false });
    const folderList = h('datalist', { id: 'dlg-folders' }, ...folders.map((f) => h('option', { value: f })));
    const host = h('input', { class: 'input', value: e?.host ?? '', placeholder: 'example.com or 192.168.1.10', spellcheck: false, autocapitalize: 'off' });
    const port = h('input', { class: 'input', type: 'number', min: '1', max: '65535', value: e?.port ? String(e.port) : '' });
    const user = h('input', { class: 'input', value: e?.username ?? '', placeholder: 'Current user', spellcheck: false, autocapitalize: 'off' });
    let auth: AuthMethod = e?.authMethod ?? 'password';
    const authSeg = segmented<AuthMethod>(
      [{ value: 'password', label: 'Password' }, { value: 'key', label: 'Private key' }, { value: 'agent', label: 'SSH agent' }],
      auth,
      (a) => { auth = a; refresh(); },
      true,
    );
    const pw = passwordInput(e?.hasPassword ? 'Saved — leave blank to keep' : 'Optional — asked on connect if empty');
    const forget = h('input', { type: 'checkbox' });
    const keyPath = h('input', { class: 'input', value: e?.keyPath ?? '', placeholder: 'C:\\Users\\you\\.ssh\\id_ed25519', spellcheck: false });
    const browse = btn('Browse…', '', async () => { const p = await window.termApi.pickKeyFile(); if (p) keyPath.value = p; });
    const shell = h('input', { class: 'input', value: e?.shell ?? '', list: 'dlg-shells', placeholder: 'System default', spellcheck: false });
    const shellList = h('datalist', { id: 'dlg-shells' }, ...shellPresets().map((s) => h('option', { value: s })));
    const serialPath = h('input', { class: 'input', value: e?.serialPath ?? '', list: 'dlg-ports', placeholder: serialPorts[0] ?? 'COM3', spellcheck: false });
    const portList = h('datalist', { id: 'dlg-ports' }, ...serialPorts.map((p) => h('option', { value: p })));
    const baud = h('select', { class: 'input' }, ...BAUDS.map((b) => h('option', { value: String(b), selected: (e?.baudRate ?? 115200) === b }, String(b))));

    const fName = field('Name', name);
    const fFolder = field('Folder', folder);
    const fHost = field('Host', host);
    const fPort = field('Port', port);
    const fUser = field('Username', user);
    const fPass = field(auth === 'key' ? 'Key passphrase' : 'Password', pw.el);
    const fKey = field('Private key file', h('div', { style: 'display:flex;gap:8px' }, keyPath, browse));
    const fShell = field('Shell', shell, 'Leave empty to use the system default.');
    const fSerial = field('Port', serialPath);
    const fBaud = field('Baud rate', baud);

    const netSection = h('div', { class: 'section' }, h('div', { class: 'grid2 wide-left' }, fHost.el, fPort.el), fUser.el);
    const authSection = h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Authentication'), authSeg.el, fPass.el, fKey.el,
      e?.hasPassword ? h('label', { class: 'check' }, forget, 'Forget the saved password') : null);
    const localSection = h('div', { class: 'section' }, fShell.el);
    const serialSection = h('div', { class: 'section' }, h('div', { class: 'grid2' }, fSerial.el, fBaud.el));

    const refresh = () => {
      const sshLike = kind === 'ssh' || kind === 'sftp';
      netSection.classList.toggle('hidden', !sshLike && kind !== 'telnet');
      fUser.el.classList.toggle('hidden', !sshLike);
      authSection.classList.toggle('hidden', !sshLike);
      fPass.el.classList.toggle('hidden', auth === 'agent');
      (fPass.el.querySelector('label') as HTMLElement).textContent = auth === 'key' ? 'Key passphrase' : 'Password';
      fKey.el.classList.toggle('hidden', auth !== 'key');
      localSection.classList.toggle('hidden', kind !== 'local');
      serialSection.classList.toggle('hidden', kind !== 'serial');
      port.placeholder = String(defaultPort(kind) ?? '');
    };

    const collect = (): SessionInput | null => {
      let ok = true;
      const bad = (f: Field, m: string) => { f.error(m); ok = false; };
      [fName, fHost, fPort, fKey, fSerial].forEach((f) => f.error(null));
      const input: SessionInput = { id: e?.id, name: name.value.trim(), kind, folder: folder.value.trim() || undefined };
      if (kind === 'ssh' || kind === 'sftp' || kind === 'telnet') {
        input.host = host.value.trim();
        if (!input.host) bad(fHost, 'Enter a host name or IP address');
        else if (/\s/.test(input.host)) bad(fHost, 'A host name cannot contain spaces');
        if (port.value) {
          const n = Number(port.value);
          if (!Number.isInteger(n) || n < 1 || n > 65535) bad(fPort, '1–65535');
          else input.port = n;
        }
      }
      if (kind === 'ssh' || kind === 'sftp') {
        input.username = user.value.trim() || undefined;
        input.authMethod = auth;
        if (auth === 'key') {
          input.keyPath = keyPath.value.trim();
          if (!input.keyPath) bad(fKey, 'Choose the private key file');
        }
        if (auth !== 'agent') {
          if (forget.checked) input.password = null;
          else if (pw.input.value) input.password = pw.input.value;
        }
      }
      if (kind === 'local') input.shell = shell.value.trim() || undefined;
      if (kind === 'serial') {
        input.serialPath = serialPath.value.trim();
        if (!input.serialPath) bad(fSerial, 'Enter the serial port');
        input.baudRate = Number(baud.value);
      }
      if (!input.name) input.name = input.host || input.serialPath || (kind === 'local' ? 'Local shell' : '');
      if (!ok) {
        body.querySelector<HTMLElement>('.invalid')?.focus();
        return null;
      }
      return input;
    };

    body.append(
      kindSeg.el,
      h('div', { class: 'grid2' }, fName.el, fFolder.el),
      folderList, shellList, portList,
      netSection, authSection, localSection, serialSection,
    );
    refresh();

    const doSave = (action: 'save' | 'connect') => () => {
      const input = collect();
      if (input) close({ action, input });
    };
    submitOnEnter(body, doSave('connect'));
    if (e) foot.append(btn('Delete', 'danger', () => close({ action: 'delete' }), 'trash-2'));
    foot.append(h('span', { class: 'spacer' }), btn('Cancel', '', () => close(null)), btn('Save', '', doSave('save')), btn('Save & connect', 'primary', doSave('connect')));
  }, null);
}

/* ------------------------------------------------------------------ quick connect */

export interface QuickResult {
  input: SessionInput;
  save: boolean;
}

export function quickDialog(serialPorts: string[]): Promise<QuickResult | null> {
  return modal<QuickResult | null>({ title: 'Quick connect', subtitle: 'Connect without saving a session.', width: 480 }, ({ body, foot, close }) => {
    let kind: 'ssh' | 'sftp' | 'telnet' | 'serial' = 'ssh';
    const seg = segmented<'ssh' | 'sftp' | 'telnet' | 'serial'>(
      (['ssh', 'sftp', 'telnet', 'serial'] as const).map((k) => ({ value: k, label: KIND_META[k].label, icon: KIND_META[k].icon })), 'ssh', (k) => { kind = k; refresh(); }, true);
    const addr = h('input', { class: 'input', placeholder: 'user@host:port', spellcheck: false, autocapitalize: 'off', autofocus: true });
    const fAddr = field('Address', addr);
    const preview = h('div', { class: 'hint' });
    const pw = passwordInput('Optional — asked on connect if empty');
    const fPw = field('Password', pw.el);
    const serialPath = h('input', { class: 'input', list: 'qd-ports', placeholder: serialPorts[0] ?? 'COM3', spellcheck: false });
    const baud = h('select', { class: 'input' }, ...BAUDS.map((b) => h('option', { value: String(b), selected: b === 115200 }, String(b))));
    const fSerial = field('Port', serialPath);
    const fBaud = field('Baud rate', baud);
    const save = h('input', { type: 'checkbox' });
    const net = h('div', { class: 'section' }, h('div', {}, fAddr.el, preview), fPw.el);
    const ser = h('div', { class: 'grid2' }, fSerial.el, fBaud.el);

    const refresh = () => {
      net.classList.toggle('hidden', kind === 'serial');
      ser.classList.toggle('hidden', kind !== 'serial');
      fPw.el.classList.toggle('hidden', kind !== 'ssh' && kind !== 'sftp');
      updatePreview();
    };
    const updatePreview = () => {
      const t = parseQuickTarget(addr.value);
      preview.textContent = !addr.value.trim() ? '' : t ? `${t.username ? t.username + ' @ ' : ''}${t.host} · port ${t.port ?? defaultPort(kind)}` : 'Not a valid address yet';
    };
    addr.addEventListener('input', () => { updatePreview(); fAddr.error(null); });

    const submit = () => {
      if (kind === 'serial') {
        const p = serialPath.value.trim();
        if (!p) return fSerial.error('Enter the serial port');
        return close({ save: save.checked, input: { name: p, kind, serialPath: p, baudRate: Number(baud.value) } });
      }
      const t = parseQuickTarget(addr.value);
      if (!t) return fAddr.error('Enter an address such as admin@192.168.1.10:22');
      close({
        save: save.checked,
        input: { name: t.host, kind, host: t.host, port: t.port, username: kind === 'ssh' || kind === 'sftp' ? t.username : undefined, authMethod: 'password', password: (kind === 'ssh' || kind === 'sftp') && pw.input.value ? pw.input.value : undefined },
      });
    };

    body.append(seg.el, net, ser, h('datalist', { id: 'qd-ports' }, ...serialPorts.map((p) => h('option', { value: p }))), h('label', { class: 'check' }, save, 'Add to saved sessions'));
    refresh();
    submitOnEnter(body, submit);
    foot.append(h('span', { class: 'spacer' }), btn('Cancel', '', () => close(null)), btn('Connect', 'primary', submit));
  }, null);
}

/* ------------------------------------------------------------------ settings */

const FONT_CHOICES = ['JetBrains Mono', 'Cascadia Mono', 'Consolas', 'Menlo', 'Courier New'];

export function settingsDialog(cur: Settings, apply: (patch: Partial<Settings>) => Promise<Settings>): Promise<void> {
  return modal<void>({ title: 'Settings', width: 520 }, ({ body, foot, close }) => {
    let s = { ...cur };
    const set = async (patch: Partial<Settings>) => {
      try {
        s = await apply(patch);
      } catch {
        /* the caller reports the failure */
      }
      updatePreview();
    };
    const row = (title: string, desc: string, control: HTMLElement) =>
      h('div', { class: 'setting' }, h('div', { class: 'txt' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), control);

    const theme = segmented<Settings['theme']>([{ value: 'system', label: 'System', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }], s.theme, (v) => void set({ theme: v }));
    const fonts = FONT_CHOICES.includes(s.fontFamily) ? FONT_CHOICES : [s.fontFamily, ...FONT_CHOICES];
    const font = h('select', { class: 'input' }, ...fonts.map((f) => h('option', { value: f, selected: f === s.fontFamily }, f)));
    font.addEventListener('change', () => void set({ fontFamily: font.value }));
    const size = h('input', { class: 'input', type: 'number', min: '8', max: '32', value: String(s.fontSize) });
    size.addEventListener('change', () => { const n = Math.min(32, Math.max(8, Math.round(Number(size.value) || 13))); size.value = String(n); void set({ fontSize: n }); });
    const cursor = segmented<Settings['cursorStyle']>([{ value: 'bar', label: 'Bar' }, { value: 'block', label: 'Block' }, { value: 'underline', label: 'Underline' }], s.cursorStyle, (v) => void set({ cursorStyle: v }));
    const blink = toggle(s.cursorBlink, (v) => void set({ cursorBlink: v }), 'Cursor blink');
    const scroll = h('input', { class: 'input', type: 'number', min: '0', max: '100000', step: '1000', value: String(s.scrollback) });
    scroll.addEventListener('change', () => { const n = Math.min(100000, Math.max(0, Math.round(Number(scroll.value) || 0))); scroll.value = String(n); void set({ scrollback: n }); });

    const monitorOn = toggle(s.monitor, (v) => void set({ monitor: v }), 'Server status bar');
    const INTERVALS = [2, 3, 5, 10, 30];
    const every = h('select', { class: 'input', 'aria-label': 'Refresh interval' }, ...INTERVALS.map((n) => h('option', { value: String(n), selected: n === s.monitorInterval }, `Every ${n} seconds`)));
    every.addEventListener('change', () => void set({ monitorInterval: Number(every.value) }));

    const preview = h('div', { class: 'preview' });
    const updatePreview = () => {
      preview.style.fontFamily = `"${s.fontFamily}", "JetBrains Mono", monospace`;
      preview.style.fontSize = `${s.fontSize}px`;
      preview.replaceChildren(h('b', {}, 'admin@server'), ':', h('i', {}, '~'), '$ ls -la /var/log', h('br'), 'drwxr-xr-x  12 root  syslog  4096 Nov 11 09:41 .');
    };
    updatePreview();

    body.append(
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Appearance'), row('Theme', 'Follows the operating system by default.', theme.el)),
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, 'Terminal'),
        row('Font', '', font), row('Font size', 'Also Ctrl + / Ctrl − in a terminal.', size),
        row('Cursor', '', cursor.el), row('Blinking cursor', '', blink), row('Scrollback', 'Lines kept per terminal.', scroll),
        preview,
      ),
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, 'Server status'),
        row('Show the status bar', 'Live CPU, memory, network, uptime and disk usage under SSH terminals. Reads /proc over a separate channel; nothing is installed on the server.', monitorOn),
        row('Refresh', 'Only the tab you are looking at is sampled.', every),
      ),
    );
    foot.append(
      btn('Reset to defaults', 'ghost', async () => {
        await set({ ...DEFAULT_SETTINGS });
        theme.set(s.theme); font.value = s.fontFamily; size.value = String(s.fontSize); cursor.set(s.cursorStyle); blink.setAttribute('aria-checked', String(s.cursorBlink)); scroll.value = String(s.scrollback); monitorOn.setAttribute('aria-checked', String(s.monitor)); every.value = String(s.monitorInterval);
      }),
      h('span', { class: 'spacer' }), btn('Done', 'primary', () => close()),
    );
  }, undefined);
}
