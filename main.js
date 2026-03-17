const { app, BrowserWindow, ipcMain, Notification, net, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

app.setName('Quack Manager');
if (process.platform === 'win32') {
  app.setAppUserModelId('Quack Manager');
}

const store = new Store({
  defaults: {
    apiKeys: [],
    phoneNumbers: [],
    globalPollInterval: 10,
    notifications: {
      desktop: true,
      discord: { enabled: false, method: 'webhook', webhookUrl: '', botToken: '', channelId: '' },
      slack: { enabled: false, method: 'webhook', webhookUrl: '', botToken: '', channelId: '' },
      telegram: { enabled: false, botToken: '', chatId: '' }
    },
    theme: 'dark',
    lastSeenTimestamps: {}
  }
});

let mainWindow;
const pollers = new Map();

// Load persisted timestamps so we don't re-notify on restart
const lastSeenTimestamps = new Map(Object.entries(store.get('lastSeenTimestamps') || {}));

function persistTimestamps() {
  store.set('lastSeenTimestamps', Object.fromEntries(lastSeenTimestamps));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 550,
    icon: path.join(__dirname, 'assets', 'icon2.png'),
    frame: false,
    titleBarStyle: 'hidden',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  startAllPollers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopAllPollers();
  if (process.platform !== 'darwin') app.quit();
});

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

// Settings IPC
ipcMain.handle('get-settings', () => {
  return {
    apiKeys: store.get('apiKeys'),
    phoneNumbers: store.get('phoneNumbers'),
    globalPollInterval: store.get('globalPollInterval'),
    notifications: store.get('notifications'),
    theme: store.get('theme')
  };
});

ipcMain.handle('save-settings', (_, settings) => {
  if (settings.apiKeys !== undefined) store.set('apiKeys', settings.apiKeys);
  if (settings.phoneNumbers !== undefined) store.set('phoneNumbers', settings.phoneNumbers);
  if (settings.globalPollInterval !== undefined) store.set('globalPollInterval', settings.globalPollInterval);
  if (settings.notifications !== undefined) store.set('notifications', settings.notifications);
  if (settings.theme !== undefined) store.set('theme', settings.theme);
  restartAllPollers();
  return true;
});

// Fetch messages for a specific number
ipcMain.handle('fetch-messages', async (_, phoneNumber) => {
  const phoneNumbers = store.get('phoneNumbers');
  const entry = phoneNumbers.find(p => p.number === phoneNumber);
  if (!entry) return { success: false, error: 'Number not configured' };

  const apiKeys = store.get('apiKeys');
  const apiKey = apiKeys.find(k => k.id === entry.apiKeyId);
  if (!apiKey) return { success: false, error: 'API key not found' };

  return await fetchSms(phoneNumber, apiKey.key);
});

// Helper: make authenticated Quackr API call using first available API key
async function quackrApi(endpoint, options = {}) {
  const apiKeys = store.get('apiKeys');
  const apiKeyId = options.apiKeyId;
  const apiKey = apiKeyId ? apiKeys.find(k => k.id === apiKeyId) : apiKeys[0];
  if (!apiKey) return { success: false, error: 'No API key configured' };

  try {
    const method = options.method || 'GET';
    const fetchOpts = {
      method,
      headers: { 'x-api-key': apiKey.key, 'Content-Type': 'application/json' }
    };
    if (options.body) fetchOpts.body = JSON.stringify(options.body);

    const url = `https://api.quackr.io${endpoint}`;
    const res = await fetch(url, fetchOpts);
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Quackr API handlers
ipcMain.handle('quackr-balance', async (_, apiKeyId) => {
  return await quackrApi('/balance', { apiKeyId });
});

ipcMain.handle('quackr-active-numbers', async (_, apiKeyId) => {
  return await quackrApi('/active-numbers?limit=1000', { apiKeyId });
});

ipcMain.handle('quackr-expiring-numbers', async (_, apiKeyId) => {
  return await quackrApi('/expiring-numbers', { apiKeyId });
});

ipcMain.handle('quackr-number-details', async (_, phoneNumber, apiKeyId) => {
  return await quackrApi(`/number?phoneNumber=${phoneNumber}`, { apiKeyId });
});

ipcMain.handle('quackr-get-nickname', async (_, phoneNumber, apiKeyId) => {
  return await quackrApi(`/nickname?phoneNumber=${phoneNumber}`, { apiKeyId });
});

ipcMain.handle('quackr-set-nickname', async (_, phoneNumber, nickname, apiKeyId) => {
  return await quackrApi('/nickname', { method: 'POST', body: { phoneNumber, nickname }, apiKeyId });
});

ipcMain.handle('quackr-get-webhook', async (_, apiKeyId) => {
  return await quackrApi('/webhook', { apiKeyId });
});

ipcMain.handle('quackr-set-webhook', async (_, webhookUrl, apiKeyId) => {
  return await quackrApi('/webhook', { method: 'POST', body: { webhookUrl }, apiKeyId });
});

// Check for updates
ipcMain.handle('check-for-updates', async () => {
  try {
    const currentVersion = require('./package.json').version;
    const res = await fetch('https://api.github.com/repos/GoblinRules/quack-manager/releases/latest', {
      headers: { 'User-Agent': 'QuackManager' }
    });
    if (!res.ok) {
      return { error: 'Could not check for updates. GitHub API returned ' + res.status };
    }
    const data = await res.json();
    const latestVersion = (data.tag_name || '').replace(/^v/, '');
    if (!latestVersion) {
      return { error: 'No releases found.' };
    }
    const upToDate = latestVersion === currentVersion;
    return { currentVersion, latestVersion, upToDate };
  } catch (err) {
    return { error: err.message };
  }
});

// Polling engine
async function fetchSms(phoneNumber, apiKey) {
  try {
    const response = await fetch(`https://api.quackr.io/receive-sms?phoneNumber=${phoneNumber}`, {
      headers: { 'x-api-key': apiKey }
    });
    const data = await response.json();
    return data;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function startPollerForNumber(entry) {
  const apiKeys = store.get('apiKeys');
  const apiKey = apiKeys.find(k => k.id === entry.apiKeyId);
  if (!apiKey) return;

  const globalInterval = store.get('globalPollInterval');
  const interval = (entry.pollInterval || globalInterval) * 1000;

  const poll = async () => {
    const result = await fetchSms(entry.number, apiKey.key);
    if (result.success === 'true' || result.success === true) {
      const messages = result.data?.messages || [];
      const lastSeen = lastSeenTimestamps.get(entry.number) || 0;
      const isFirstSync = lastSeen === 0;

      if (isFirstSync && messages.length > 0) {
        // First poll for this number — set watermark, send to renderer, but skip notifications
        const maxTs = Math.max(...messages.map(m => m.received));
        lastSeenTimestamps.set(entry.number, maxTs);
        persistTimestamps();
        mainWindow?.webContents.send('new-messages', {
          phoneNumber: entry.number,
          messages: messages
        });
        return;
      }

      const newMessages = messages.filter(m => m.received > lastSeen);

      if (newMessages.length > 0) {
        const maxTs = Math.max(...messages.map(m => m.received));
        lastSeenTimestamps.set(entry.number, maxTs);
        persistTimestamps();

        mainWindow?.webContents.send('new-messages', {
          phoneNumber: entry.number,
          messages: newMessages
        });

        for (const msg of newMessages) {
          sendNotifications(entry, msg);
        }
      }
    }
  };

  poll();
  const timer = setInterval(poll, interval);
  pollers.set(entry.number, timer);
}

function startAllPollers() {
  const phoneNumbers = store.get('phoneNumbers');
  // Stagger initial polls by 500ms each to avoid flooding API and notifications
  phoneNumbers.forEach((entry, i) => {
    setTimeout(() => startPollerForNumber(entry), i * 500);
  });
}

function stopAllPollers() {
  for (const [, timer] of pollers) {
    clearInterval(timer);
  }
  pollers.clear();
}

function restartAllPollers() {
  stopAllPollers();
  startAllPollers();
}

// Test notification handler
ipcMain.handle('test-notification', async (_, service) => {
  const settings = store.get('notifications');
  const testMsg = { sender: 'QuackTest', message: 'This is a test notification from Quack Manager!', received: Date.now() };
  const testEntry = { name: 'Test Number', number: '0000000000' };

  try {
    if (service === 'desktop') {
      if (Notification.isSupported()) {
        new Notification({
          title: 'SMS for Test Number',
          body: `From QuackTest: ${testMsg.message}`,
          icon: path.join(__dirname, 'assets', 'icon2.png')
        }).show();
        return { success: true };
      }
      return { success: false, error: 'Desktop notifications not supported' };
    }

    if (service === 'discord') {
      if (settings.discord?.method === 'webhook' && settings.discord.webhookUrl) {
        const res = await fetch(settings.discord.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{ title: 'Quack Manager Test', description: testMsg.message, color: 0x4ecdc4, timestamp: new Date().toISOString() }]
          })
        });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        return { success: true };
      } else if (settings.discord?.method === 'bot' && settings.discord.botToken && settings.discord.channelId) {
        const res = await fetch(`https://discord.com/api/v10/channels/${settings.discord.channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bot ${settings.discord.botToken}` },
          body: JSON.stringify({
            embeds: [{ title: 'Quack Manager Test', description: testMsg.message, color: 0x4ecdc4, timestamp: new Date().toISOString() }]
          })
        });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        return { success: true };
      }
      return { success: false, error: 'Discord not configured' };
    }

    if (service === 'slack') {
      if (settings.slack?.method === 'webhook' && settings.slack.webhookUrl) {
        const res = await fetch(settings.slack.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Quack Manager Test*\n${testMsg.message}` } }] })
        });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        return { success: true };
      } else if (settings.slack?.method === 'bot' && settings.slack.botToken && settings.slack.channelId) {
        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.slack.botToken}` },
          body: JSON.stringify({ channel: settings.slack.channelId, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Quack Manager Test*\n${testMsg.message}` } }] })
        });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        return { success: true };
      }
      return { success: false, error: 'Slack not configured' };
    }

    if (service === 'telegram') {
      if (settings.telegram?.botToken && settings.telegram.chatId) {
        const res = await fetch(`https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: settings.telegram.chatId, text: `Quack Manager Test\n${testMsg.message}` })
        });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        return { success: true };
      }
      return { success: false, error: 'Telegram not configured' };
    }

    return { success: false, error: 'Unknown service' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Notifications
async function sendNotifications(entry, msg) {
  const settings = store.get('notifications');
  const displayName = entry.name || entry.number;

  // Desktop notification
  if (settings.desktop && Notification.isSupported()) {
    new Notification({
      title: `SMS for ${displayName}`,
      body: `From ${msg.sender}: ${msg.message}`,
      icon: path.join(__dirname, 'assets', 'icon2.png')
    }).show();
  }

  // Discord
  if (settings.discord?.enabled) {
    try {
      if (settings.discord.method === 'webhook' && settings.discord.webhookUrl) {
        await fetch(settings.discord.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: `SMS for ${displayName}`,
              description: msg.message,
              fields: [{ name: 'Sender', value: msg.sender, inline: true }],
              color: 0x4ecdc4,
              timestamp: new Date(msg.received).toISOString()
            }]
          })
        });
      } else if (settings.discord.method === 'bot' && settings.discord.botToken && settings.discord.channelId) {
        await fetch(`https://discord.com/api/v10/channels/${settings.discord.channelId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${settings.discord.botToken}`
          },
          body: JSON.stringify({
            embeds: [{
              title: `SMS for ${displayName}`,
              description: msg.message,
              fields: [{ name: 'Sender', value: msg.sender, inline: true }],
              color: 0x4ecdc4,
              timestamp: new Date(msg.received).toISOString()
            }]
          })
        });
      }
    } catch (e) { console.error('Discord notification failed:', e); }
  }

  // Slack
  if (settings.slack?.enabled) {
    try {
      if (settings.slack.method === 'webhook' && settings.slack.webhookUrl) {
        await fetch(settings.slack.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: `*SMS for ${displayName}*\nFrom: ${msg.sender}\n${msg.message}` }
            }]
          })
        });
      } else if (settings.slack.method === 'bot' && settings.slack.botToken && settings.slack.channelId) {
        await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.slack.botToken}`
          },
          body: JSON.stringify({
            channel: settings.slack.channelId,
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: `*SMS for ${displayName}*\nFrom: ${msg.sender}\n${msg.message}` }
            }]
          })
        });
      }
    } catch (e) { console.error('Slack notification failed:', e); }
  }

  // Telegram
  if (settings.telegram?.enabled && settings.telegram.botToken && settings.telegram.chatId) {
    try {
      await fetch(`https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegram.chatId,
          text: `📱 SMS for ${displayName}\nFrom: ${msg.sender}\n${msg.message}`,
          parse_mode: 'HTML'
        })
      });
    } catch (e) { console.error('Telegram notification failed:', e); }
  }
}
