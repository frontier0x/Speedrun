import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('speedrun', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb: (s: unknown) => void) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusAdd: (cb: () => void) => ipcRenderer.on('focus-add', () => cb()),
  onCountdown: (cb: (ms: number) => void) => ipcRenderer.on('countdown', (_e, ms) => cb(ms)),
  onFlash: (cb: (f: unknown) => void) => ipcRenderer.on('flash', (_e, f) => cb(f)),
  act: (action: unknown) => ipcRenderer.invoke('act', action),
  listRuns: () => ipcRenderer.invoke('runs:list'),
});
