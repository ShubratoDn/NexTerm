import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { TermApi } from '../shared/api';
import type { EditStatus, ServerStats, TransferProgress } from '../shared/types';

const api: TermApi = {
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  saveSession: (s) => ipcRenderer.invoke('sessions:save', s),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  duplicateSession: (id) => ipcRenderer.invoke('sessions:duplicate', id),
  platform: process.platform,
  pathForFile: (file) => {
    const p = webUtils.getPathForFile(file);
    if (p) ipcRenderer.send('drop:register', p); // main only uploads paths the user actually dropped
    return p;
  },
  setTitleBar: (bg, fg) => ipcRenderer.send('ui:titlebar', bg, fg),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  listSerialPorts: () => ipcRenderer.invoke('serial:list'),
  importDetect: () => ipcRenderer.invoke('import:detect'),
  importPick: (source) => ipcRenderer.invoke('import:pick', source),
  importPreview: (source, path) => ipcRenderer.invoke('import:preview', source, path),
  importCommit: (items, skip) => ipcRenderer.invoke('import:commit', items, skip),
  pickKeyFile: () => ipcRenderer.invoke('dialog:key'),

  open: (req) => ipcRenderer.invoke('conn:open', req),
  write: (id, d) => ipcRenderer.send('conn:write', id, d),
  resize: (id, c, r) => ipcRenderer.send('conn:resize', id, c, r),
  close: (id) => ipcRenderer.send('conn:close', id),
  onData: (cb) => {
    const l = (_e: unknown, id: string, d: Uint8Array) => cb(id, d);
    ipcRenderer.on('conn:data', l);
    return () => void ipcRenderer.removeListener('conn:data', l);
  },
  onClosed: (cb) => {
    const l = (_e: unknown, id: string, reason?: string) => cb(id, reason);
    ipcRenderer.on('conn:closed', l);
    return () => void ipcRenderer.removeListener('conn:closed', l);
  },

  monitorStart: (id) => ipcRenderer.invoke('monitor:start', id),
  monitorStop: (id) => ipcRenderer.invoke('monitor:stop', id),
  monitorDetail: (id, on) => ipcRenderer.invoke('monitor:detail', id, on),
  monitorRefresh: (id) => ipcRenderer.invoke('monitor:refresh', id),
  onMonitor: (cb) => {
    const l = (_e: unknown, id: string, s: ServerStats | null) => cb(id, s);
    ipcRenderer.on('monitor:stats', l);
    return () => void ipcRenderer.removeListener('monitor:stats', l);
  },
  onEditStatus: (cb) => {
    const l = (_e: unknown, s: EditStatus) => cb(s);
    ipcRenderer.on('edit:status', l);
    return () => void ipcRenderer.removeListener('edit:status', l);
  },
  editResolve: (id, overwrite) => ipcRenderer.invoke('edit:resolve', id, overwrite),
  chooseEditor: () => ipcRenderer.invoke('editor:choose'),
  clearEditor: () => ipcRenderer.invoke('editor:clear'),
  onTransfer: (cb) => {
    const l = (_e: unknown, p: TransferProgress) => cb(p);
    ipcRenderer.on('transfer:progress', l);
    return () => void ipcRenderer.removeListener('transfer:progress', l);
  },

  sftp: {
    edit: (id, p, mode) => ipcRenderer.invoke('sftp:edit', id, p, mode),
    pasteFiles: (id, dir) => ipcRenderer.invoke('sftp:pasteFiles', id, dir),
    copy: (from, paths, to, dir, move) => ipcRenderer.invoke('sftp:copy', from, paths, to, dir, move),
    realpath: (id, p) => ipcRenderer.invoke('sftp:realpath', id, p),
    list: (id, p) => ipcRenderer.invoke('sftp:list', id, p),
    download: (id, p) => ipcRenderer.invoke('sftp:download', id, p),
    downloadMany: (id, paths) => ipcRenderer.invoke('sftp:downloadMany', id, paths),
    upload: (id, d) => ipcRenderer.invoke('sftp:upload', id, d),
    uploadPaths: (id, d, paths) => ipcRenderer.invoke('sftp:uploadPaths', id, d, paths),
    mkdir: (id, p) => ipcRenderer.invoke('sftp:mkdir', id, p),
    mkfile: (id, p) => ipcRenderer.invoke('sftp:mkfile', id, p),
    stat: (id, p) => ipcRenderer.invoke('sftp:stat', id, p),
    chmod: (id, p, mode) => ipcRenderer.invoke('sftp:chmod', id, p, mode),
    treeSize: (id, p) => ipcRenderer.invoke('sftp:treeSize', id, p),
    downloadTree: (id, p) => ipcRenderer.invoke('sftp:downloadTree', id, p),
    uploadFolder: (id, d) => ipcRenderer.invoke('sftp:uploadFolder', id, d),
    removeTree: (id, p) => ipcRenderer.invoke('sftp:removeTree', id, p),
    rename: (id, a, b) => ipcRenderer.invoke('sftp:rename', id, a, b),
    remove: (id, p, isDir) => ipcRenderer.invoke('sftp:remove', id, p, isDir),
  },
};

contextBridge.exposeInMainWorld('termApi', api);
