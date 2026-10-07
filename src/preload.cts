import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('speedrun', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb: (s: unknown) => void) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusAdd: (cb: () => void) => ipcRenderer.on('focus-add', () => cb()),
  act: (action: unknown) => ipcRenderer.invoke('act', action),
  listRuns: () => ipcRenderer.invoke('runs:list'),
});
