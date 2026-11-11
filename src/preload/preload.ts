import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { TermApi } from '../shared/api';

const api: TermApi = {
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

  sftp: {
    realpath: (id, p) => ipcRenderer.invoke('sftp:realpath', id, p),
    list: (id, p) => ipcRenderer.invoke('sftp:list', id, p),
    download: (id, p) => ipcRenderer.invoke('sftp:download', id, p),
    downloadMany: (id, paths) => ipcRenderer.invoke('sftp:downloadMany', id, paths),
    upload: (id, d) => ipcRenderer.invoke('sftp:upload', id, d),
    uploadPaths: (id, d, paths) => ipcRenderer.invoke('sftp:uploadPaths', id, d, paths),
    mkdir: (id, p) => ipcRenderer.invoke('sftp:mkdir', id, p),
    rename: (id, a, b) => ipcRenderer.invoke('sftp:rename', id, a, b),
    remove: (id, p, isDir) => ipcRenderer.invoke('sftp:remove', id, p, isDir),
  },
};

contextBridge.exposeInMainWorld('termApi', api);
