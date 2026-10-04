const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (name, args) => ipcRenderer.invoke('api', name, args),
});
