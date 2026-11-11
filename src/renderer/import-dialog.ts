import { h, put } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { KIND_META, btn, modal } from './dialogs';
import { describeSession } from './state';
import { cleanError } from './toast';
import type { ImportPreview, ImportResult, ImportSourceId, ImportSourceInfo, SessionSummary } from '../shared/types';

const SOURCE_ICON: Record<ImportSourceId, IconName> = { mobaxterm: 'server', putty: 'terminal', openssh: 'key-round' };

const EMPTY_HELP: Record<ImportSourceId, { title: string; body: string }> = {
  mobaxterm: {
    title: 'Find your MobaXterm sessions',
    body: 'NexTerm did not find MobaXterm.ini on its own. It lives in the MobaXterm folder (portable edition) or in %APPDATA%\\MobaXterm. You can also export your sessions from MobaXterm and choose that .mxtsessions file.',
  },
  putty: { title: 'No PuTTY sessions found', body: 'There are no saved PuTTY sessions on this computer.' },
  openssh: { title: 'No SSH config found', body: 'There is no ~/.ssh/config file. If yours is somewhere else, choose it.' },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Status = 'idle' | 'loading' | 'error' | 'ready';

/**
 * Guided import of connections from MobaXterm, PuTTY or an OpenSSH config.
 * Resolves with the import result, or null when the user cancels.
 */
export function importDialog(sources: ImportSourceInfo[], initial?: ImportSourceId): Promise<ImportResult | null> {
  return modal<ImportResult | null>(
    { title: 'Import connections', subtitle: 'Bring your servers from another tool, so you do not have to add them one by one.', width: 940 },
    ({ body, foot, close }) => {
      let current: ImportSourceId = initial ?? sources.find((s) => s.found.length > 0)?.id ?? 'mobaxterm';
      let location: string | null = null;
      const picked: Record<string, { path: string; label: string; count: number }[]> = { mobaxterm: [], putty: [], openssh: [] };
      let status: Status = 'idle';
      let error = '';
      let preview: ImportPreview | null = null;
      let selected = new Set<number>();
      let filter = '';
      let importing = false;

      const cards = h('div', { class: 'import-sources', role: 'radiogroup', 'aria-label': 'Source' });
      const main = h('div', { class: 'import-main' });
      body.append(h('div', { class: 'import' }, cards, main));

      const info = () => sources.find((s) => s.id === current)!;
      const locations = () => [...info().found, ...picked[current]];

      const importBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Import');
      const hint = h('span', { class: 'import-hint' }, icon('info', 14), 'Passwords are never imported. NexTerm asks for them when you first connect, and can remember them.');
      const errBox = h('span', { class: 'error', role: 'alert' });
      foot.append(hint, h('span', { class: 'spacer' }), errBox, btn('Cancel', '', () => close(null)), importBtn);

      const updateFooter = () => {
        const n = selected.size;
        importBtn.disabled = status !== 'ready' || n === 0 || importing;
        importBtn.textContent = importing ? 'Importing…' : n === 0 ? 'Import' : `Import ${plural(n, 'session')}`;
      };

      const renderCards = () => {
        cards.replaceChildren(
          ...sources.map((s) => {
            const total = s.found.reduce((a, l) => a + l.count, 0);
            const el = h(
              'button',
              { type: 'button', class: 'src-card', role: 'radio', 'aria-checked': String(s.id === current) },
              h('span', { class: 'src-icon' }, icon(SOURCE_ICON[s.id], 18)),
              h('span', { class: 'src-txt' }, h('span', { class: 'src-name' }, s.label), h('span', { class: `src-status${total ? ' ok' : ''}` }, total ? `${plural(total, 'session')} found` : s.canBrowse ? 'Choose a file' : 'Not found')),
            );
            el.addEventListener('click', () => select(s.id));
            return el;
          }),
        );
      };

      const select = (id: ImportSourceId) => {
        current = id;
        picked[id] = picked[id] ?? [];
        location = locations()[0]?.path ?? null;
        preview = null;
        selected = new Set();
        filter = '';
        renderCards();
        if (location) void load();
        else {
          status = 'idle';
          renderMain();
          updateFooter();
        }
      };

      const load = async () => {
        if (!location) return;
        status = 'loading';
        error = '';
        renderMain();
        updateFooter();
        try {
          const p = await window.termApi.importPreview(current, location);
          preview = p;
          selected = new Set(p.sessions.map((s, i) => (s.duplicate ? -1 : i)).filter((i) => i >= 0));
          status = 'ready';
        } catch (e) {
          status = 'error';
          error = cleanError(e);
        }
        renderMain();
        updateFooter();
      };

      const choose = async () => {
        const p = await window.termApi.importPick(current);
        if (!p) return;
        if (!locations().some((l) => l.path === p)) picked[current].push({ path: p, label: p, count: 0 });
        location = p;
        void load();
      };

      const chooseBtn = (label = 'Choose file…') => h('button', { type: 'button', class: 'btn', onclick: () => void choose() }, icon('folder-open', 15), label);

      const renderMain = () => {
        main.replaceChildren();
        const src = info();

        if (status === 'idle') {
          const help = EMPTY_HELP[current];
          main.append(h('div', { class: 'import-empty' }, h('div', { class: 'big' }, icon(SOURCE_ICON[current], 24)), h('h3', {}, help.title), h('p', {}, help.body), src.canBrowse ? chooseBtn() : null));
          return;
        }
        if (status === 'loading') {
          main.append(h('div', { class: 'import-empty' }, icon('loader-circle', 26, 'spin'), h('p', {}, 'Reading connections…')));
          return;
        }
        if (status === 'error') {
          main.append(h('div', { class: 'import-empty error' }, h('div', { class: 'big' }, icon('circle-alert', 24)), h('h3', {}, 'Could not read that file'), h('p', {}, error), src.canBrowse ? chooseBtn('Choose another file…') : h('button', { type: 'button', class: 'btn', onclick: () => void load() }, 'Try again')));
          return;
        }
        if (!preview) return;

        // Toolbar: location, filter, select all / none
        const locs = locations();
        const select_ = h('select', { class: 'input', 'aria-label': 'Location' }, ...locs.map((l) => h('option', { value: l.path, selected: l.path === location }, l.count ? `${l.label} (${l.count})` : l.label)));
        select_.addEventListener('change', () => { location = select_.value; void load(); });
        const search = h('input', { class: 'input', placeholder: 'Filter', value: filter, 'aria-label': 'Filter sessions', spellcheck: false });
        search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); renderList(); });
        const bar = h('div', { class: 'import-bar' }, locs.length > 1 || src.canBrowse ? select_ : h('div', { class: 'import-loc' }, locs[0]?.label ?? ''), src.canBrowse ? btn('Other file…', 'ghost', () => void choose(), 'folder-open') : null);
        const tools = h('div', { class: 'import-tools' },
          h('div', { class: 'input-with-icon' }, icon('search', 14), search),
          btn('Select all', 'ghost', () => { selected = new Set(preview!.sessions.map((_, i) => i)); renderList(); }),
          btn('None', 'ghost', () => { selected = new Set(); renderList(); }));

        const summary = h('div', { class: 'import-summary' });
        const list = h('div', { class: 'import-list', role: 'list' });
        listEl = list;
        summaryEl = summary;
        main.append(bar, summary, tools, list);

        // Heads-ups below the list
        const extras: HTMLElement[] = [];
        for (const u of preview.unsupported) {
          const what = u.label.replace(/ sessions$/, u.count === 1 ? ' session' : ' sessions');
          const msg = /^Incomplete/i.test(u.label) ? `Skipped: ${u.count} ${u.label.toLowerCase()}.` : `Not imported: ${u.count} ${what}. NexTerm does not support ${u.count === 1 ? 'this' : 'these'} yet.`;
          extras.push(h('div', { class: 'import-note' }, icon('info', 14), h('span', {}, msg)));
        }
        for (const n of preview.notes) extras.push(h('div', { class: 'import-note warn' }, icon('triangle-alert', 14), h('span', {}, `${n.count}× ${n.label}`)));
        if (extras.length) main.append(h('div', { class: 'import-notes' }, ...extras));
        renderList();
      };

      let listEl: HTMLElement | null = null;
      let summaryEl: HTMLElement | null = null;

      const renderList = () => {
        if (!preview || !listEl || !summaryEl) return;
        const items = preview.sessions;
        const kinds = new Map<string, number>();
        for (const s of items) kinds.set(KIND_META[s.kind].label, (kinds.get(KIND_META[s.kind].label) ?? 0) + 1);
        const dups = items.filter((s) => s.duplicate).length;
        summaryEl.replaceChildren();
        put(
          summaryEl,
          h('strong', {}, plural(items.length, 'session')),
          h('span', {}, ' · ' + [...kinds].map(([k, n]) => `${n} ${k}`).join(', ')),
          dups ? h('span', { class: 'dim' }, ` · ${dups} already in NexTerm`) : null,
        );
        updateFooter();

        const matches = (i: number) => {
          if (!filter) return true;
          const s = items[i];
          return `${s.name} ${s.host ?? ''} ${s.username ?? ''} ${s.folder ?? ''}`.toLowerCase().includes(filter);
        };
        const groups = new Map<string, number[]>();
        items.forEach((s, i) => {
          if (matches(i)) groups.set(s.folder ?? '', [...(groups.get(s.folder ?? '') ?? []), i]);
        });
        if (groups.size === 0) {
          listEl.replaceChildren(h('div', { class: 'import-empty small' }, h('p', {}, 'No sessions match your filter.')));
          return;
        }

        const nodes: HTMLElement[] = [];
        for (const [folder, idxs] of [...groups].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))) {
          const all = idxs.every((i) => selected.has(i));
          const some = idxs.some((i) => selected.has(i));
          const gcheck = h('input', { type: 'checkbox', checked: all, 'aria-label': `Select ${folder || 'sessions without a folder'}` });
          gcheck.indeterminate = some && !all;
          gcheck.addEventListener('change', () => { for (const i of idxs) gcheck.checked ? selected.add(i) : selected.delete(i); renderList(); });
          nodes.push(h('div', { class: 'imp-group' }, gcheck, icon(folder ? 'folder' : 'server', 14), h('span', {}, folder || 'No folder'), h('span', { class: 'count' }, String(idxs.length))));
          for (const i of idxs) {
            const s = items[i];
            const sess: Pick<SessionSummary, 'kind' | 'host' | 'port' | 'username' | 'serialPath' | 'baudRate' | 'shell'> = s;
            const check = h('input', { type: 'checkbox', checked: selected.has(i), tabIndex: -1, 'aria-label': `Import ${s.name}` });
            const row = h('label', { class: `imp-row${selected.has(i) ? ' on' : ''}`, role: 'listitem' },
              check,
              h('span', { class: 'imp-kind', 'data-kind': s.kind }, KIND_META[s.kind].label),
              h('span', { class: 'imp-name' }, s.name),
              h('span', { class: 'imp-sub' }, describeSession(sess)),
              s.duplicate ? h('span', { class: 'badge', title: 'A session with the same type, host, port and user already exists' }, 'Already added') : null,
              s.keyMissing ? h('span', { class: 'badge warn', title: s.keyPath ?? '' }, 'Key file not found') : null,
            );
            check.addEventListener('change', () => { check.checked ? selected.add(i) : selected.delete(i); renderList(); });
            nodes.push(row);
          }
        }
        const keep = listEl.scrollTop;
        listEl.replaceChildren(...nodes);
        listEl.scrollTop = keep;
      };

      importBtn.addEventListener('click', async () => {
        if (!preview || selected.size === 0 || importing) return;
        importing = true;
        errBox.textContent = '';
        updateFooter();
        try {
          const chosen = [...selected].sort((a, b) => a - b).map((i) => {
            const { duplicate: _d, keyMissing: _k, ...session } = preview!.sessions[i];
            return session;
          });
          // The user already decided about duplicates by (un)checking them.
          close(await window.termApi.importCommit(chosen, false));
        } catch (e) {
          importing = false;
          errBox.textContent = cleanError(e);
          updateFooter();
        }
      });

      renderCards();
      select(current);
    },
    null,
  );
}
