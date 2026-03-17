const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quack', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Messages
  fetchMessages: (phoneNumber) => ipcRenderer.invoke('fetch-messages', phoneNumber),

  // Test notifications
  testNotification: (service) => ipcRenderer.invoke('test-notification', service),

  // Listen for new messages from poller
  onNewMessages: (callback) => {
    ipcRenderer.on('new-messages', (_, data) => callback(data));
  },

  // Open external URL in system browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Quackr API
  getBalance: (apiKeyId) => ipcRenderer.invoke('quackr-balance', apiKeyId),
  getActiveNumbers: (apiKeyId) => ipcRenderer.invoke('quackr-active-numbers', apiKeyId),
  getExpiringNumbers: (apiKeyId) => ipcRenderer.invoke('quackr-expiring-numbers', apiKeyId),
  getNumberDetails: (phoneNumber, apiKeyId) => ipcRenderer.invoke('quackr-number-details', phoneNumber, apiKeyId),
  getNickname: (phoneNumber, apiKeyId) => ipcRenderer.invoke('quackr-get-nickname', phoneNumber, apiKeyId),
  setNickname: (phoneNumber, nickname, apiKeyId) => ipcRenderer.invoke('quackr-set-nickname', phoneNumber, nickname, apiKeyId),
  getWebhook: (apiKeyId) => ipcRenderer.invoke('quackr-get-webhook', apiKeyId),
  setWebhook: (webhookUrl, apiKeyId) => ipcRenderer.invoke('quackr-set-webhook', webhookUrl, apiKeyId),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates')
});
