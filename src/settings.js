// Settings panel logic
let localApiKeys = [];
let localPhoneNumbers = [];
let phoneSearchQuery = '';

function loadSettingsForm() {
  const s = window._app.settings;
  localApiKeys = JSON.parse(JSON.stringify(s.apiKeys || []));
  localPhoneNumbers = JSON.parse(JSON.stringify(s.phoneNumbers || []));
  phoneSearchQuery = '';

  renderApiKeys();
  renderPhoneNumbers();

  document.getElementById('global-poll-interval').value = s.globalPollInterval || 10;

  // Notifications
  const n = s.notifications || {};
  document.getElementById('notif-desktop').checked = n.desktop !== false;

  // Discord
  document.getElementById('notif-discord-enabled').checked = n.discord?.enabled || false;
  document.getElementById('discord-method').value = n.discord?.method || 'webhook';
  document.getElementById('discord-webhook-url').value = n.discord?.webhookUrl || '';
  document.getElementById('discord-bot-token').value = n.discord?.botToken || '';
  document.getElementById('discord-channel-id').value = n.discord?.channelId || '';
  toggleDiscordConfig();

  // Slack
  document.getElementById('notif-slack-enabled').checked = n.slack?.enabled || false;
  document.getElementById('slack-method').value = n.slack?.method || 'webhook';
  document.getElementById('slack-webhook-url').value = n.slack?.webhookUrl || '';
  document.getElementById('slack-bot-token').value = n.slack?.botToken || '';
  document.getElementById('slack-channel-id').value = n.slack?.channelId || '';
  toggleSlackConfig();

  // Telegram
  document.getElementById('notif-telegram-enabled').checked = n.telegram?.enabled || false;
  document.getElementById('telegram-bot-token').value = n.telegram?.botToken || '';
  document.getElementById('telegram-chat-id').value = n.telegram?.chatId || '';
  toggleTelegramConfig();

  setupSettingsListeners();
  setupTabNavigation();
  loadAccountData();
  loadWebhookData();
}

// Tab navigation
function setupTabNavigation() {
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Update tab active state
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding panel
      const targetId = tab.dataset.tab;
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
    });
  });
}

function setupSettingsListeners() {
  // Remove old listeners by cloning
  const replacer = (id) => {
    const el = document.getElementById(id);
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    return clone;
  };

  replacer('btn-add-api-key').addEventListener('click', addApiKey);
  replacer('btn-add-phone').addEventListener('click', addPhoneNumber);
  replacer('btn-save-settings').addEventListener('click', saveAllSettings);
  replacer('btn-cancel-settings').addEventListener('click', () => window._app.showView('dashboard'));

  // Phone search
  const searchEl = replacer('phone-search');
  searchEl.value = phoneSearchQuery;
  searchEl.addEventListener('input', (e) => {
    phoneSearchQuery = e.target.value;
    renderPhoneNumbers();
  });

  replacer('notif-discord-enabled').addEventListener('change', toggleDiscordConfig);
  replacer('discord-method').addEventListener('change', toggleDiscordMethod);
  replacer('notif-slack-enabled').addEventListener('change', toggleSlackConfig);
  replacer('slack-method').addEventListener('change', toggleSlackMethod);
  replacer('notif-telegram-enabled').addEventListener('change', toggleTelegramConfig);

  // Test notification buttons
  replacer('btn-test-desktop').addEventListener('click', () => testNotification('desktop', 'btn-test-desktop'));
  replacer('btn-test-discord').addEventListener('click', () => testNotification('discord', 'btn-test-discord'));
  replacer('btn-test-slack').addEventListener('click', () => testNotification('slack', 'btn-test-slack'));
  replacer('btn-test-telegram').addEventListener('click', () => testNotification('telegram', 'btn-test-telegram'));

  // Account
  replacer('btn-refresh-account').addEventListener('click', loadAccountData);
  replacer('btn-import-numbers').addEventListener('click', importActiveNumbers);

  // Webhooks
  replacer('btn-set-webhook').addEventListener('click', saveWebhook);
  replacer('btn-refresh-webhook').addEventListener('click', loadWebhookData);

  // Help / About links
  replacer('link-quackr-site').addEventListener('click', (e) => {
    e.preventDefault();
    window.quack.openExternal('https://quackr.io');
  });
  replacer('link-api-docs').addEventListener('click', (e) => {
    e.preventDefault();
    window.quack.openExternal('https://api.quackr.io');
  });
  replacer('link-github').addEventListener('click', (e) => {
    e.preventDefault();
    window.quack.openExternal('https://github.com/GoblinRules/quack-manager');
  });
  replacer('btn-check-update').addEventListener('click', checkForUpdates);
}

// API Keys
function renderApiKeys() {
  const container = document.getElementById('api-keys-list');
  container.innerHTML = localApiKeys.map((key, i) => `
    <div class="entry-row">
      <div class="form-group">
        <label>Name</label>
        <input type="text" class="input api-key-name" data-index="${i}" value="${escapeAttr(key.name || '')}" placeholder="My API Key">
      </div>
      <div class="form-group" style="flex:2">
        <label>Key</label>
        <input type="password" class="input api-key-value" data-index="${i}" value="${escapeAttr(key.key || '')}" placeholder="x-api-key value">
      </div>
      <button class="btn btn-danger btn-small" data-index="${i}" onclick="removeApiKey(${i})">Remove</button>
    </div>
  `).join('');

  container.querySelectorAll('.api-key-name').forEach(el => {
    el.addEventListener('input', (e) => { localApiKeys[e.target.dataset.index].name = e.target.value; });
  });
  container.querySelectorAll('.api-key-value').forEach(el => {
    el.addEventListener('input', (e) => { localApiKeys[e.target.dataset.index].key = e.target.value; });
  });
}

function addApiKey() {
  localApiKeys.push({ id: generateId(), name: '', key: '' });
  renderApiKeys();
}

window.removeApiKey = function(index) {
  localApiKeys.splice(index, 1);
  renderApiKeys();
  renderPhoneNumbers();
};

// Phone Numbers
function renderPhoneNumbers() {
  const container = document.getElementById('phone-numbers-list');
  const query = phoneSearchQuery.toLowerCase().trim();

  // Filter by search
  const filtered = localPhoneNumbers.map((entry, i) => ({ entry, originalIndex: i })).filter(({ entry }) => {
    if (!query) return true;
    return (entry.number || '').toLowerCase().includes(query) ||
           (entry.name || '').toLowerCase().includes(query);
  });

  container.innerHTML = filtered.map(({ entry, originalIndex }) => `
    <div class="entry-row" style="flex-wrap: wrap;" data-original-index="${originalIndex}">
      <div class="form-group">
        <label>Phone Number</label>
        <input type="text" class="input phone-number-val" data-index="${originalIndex}" value="${escapeAttr(entry.number || '')}" placeholder="12269165114">
      </div>
      <div class="form-group">
        <label>Name (optional)</label>
        <input type="text" class="input phone-name-val" data-index="${originalIndex}" value="${escapeAttr(entry.name || '')}" placeholder="SIM 1">
      </div>
      <div class="form-group">
        <label>API Key</label>
        <select class="input phone-apikey-val" data-index="${originalIndex}">
          <option value="">-- Select --</option>
          ${localApiKeys.map(k => `<option value="${k.id}" ${entry.apiKeyId === k.id ? 'selected' : ''}>${escapeAttr(k.name || 'Unnamed')}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="max-width:100px;">
        <label>Poll (s)</label>
        <input type="number" class="input phone-poll-val" data-index="${originalIndex}" value="${entry.pollInterval || ''}" placeholder="Global" min="5" max="300">
      </div>
      <button class="btn btn-danger btn-small" onclick="removePhone(${originalIndex})">Remove</button>
    </div>
  `).join('');

  // Update count
  const countEl = document.getElementById('phone-count');
  if (countEl) {
    if (query) {
      countEl.textContent = `Showing ${filtered.length} of ${localPhoneNumbers.length} numbers`;
    } else {
      countEl.textContent = localPhoneNumbers.length > 0 ? `${localPhoneNumbers.length} number${localPhoneNumbers.length !== 1 ? 's' : ''}` : '';
    }
  }

  container.querySelectorAll('.phone-number-val').forEach(el => {
    el.addEventListener('input', (e) => { localPhoneNumbers[e.target.dataset.index].number = e.target.value; });
  });
  container.querySelectorAll('.phone-name-val').forEach(el => {
    el.addEventListener('input', (e) => { localPhoneNumbers[e.target.dataset.index].name = e.target.value; });
  });
  container.querySelectorAll('.phone-apikey-val').forEach(el => {
    el.addEventListener('change', (e) => { localPhoneNumbers[e.target.dataset.index].apiKeyId = e.target.value; });
  });
  container.querySelectorAll('.phone-poll-val').forEach(el => {
    el.addEventListener('input', (e) => {
      const val = e.target.value ? parseInt(e.target.value) : null;
      localPhoneNumbers[e.target.dataset.index].pollInterval = val;
    });
  });
}

function addPhoneNumber() {
  localPhoneNumbers.push({ number: '', name: '', apiKeyId: '', pollInterval: null });
  phoneSearchQuery = '';
  const searchEl = document.getElementById('phone-search');
  if (searchEl) searchEl.value = '';
  renderPhoneNumbers();
}

window.removePhone = function(index) {
  localPhoneNumbers.splice(index, 1);
  renderPhoneNumbers();
};

// Notification toggles
function toggleDiscordConfig() {
  const enabled = document.getElementById('notif-discord-enabled').checked;
  document.getElementById('discord-config').style.display = enabled ? '' : 'none';
  document.getElementById('btn-test-discord').style.display = enabled ? '' : 'none';
  if (enabled) toggleDiscordMethod();
}

function toggleDiscordMethod() {
  const method = document.getElementById('discord-method').value;
  document.getElementById('discord-webhook-fields').style.display = method === 'webhook' ? '' : 'none';
  document.getElementById('discord-bot-fields').style.display = method === 'bot' ? '' : 'none';
}

function toggleSlackConfig() {
  const enabled = document.getElementById('notif-slack-enabled').checked;
  document.getElementById('slack-config').style.display = enabled ? '' : 'none';
  document.getElementById('btn-test-slack').style.display = enabled ? '' : 'none';
  if (enabled) toggleSlackMethod();
}

function toggleSlackMethod() {
  const method = document.getElementById('slack-method').value;
  document.getElementById('slack-webhook-fields').style.display = method === 'webhook' ? '' : 'none';
  document.getElementById('slack-bot-fields').style.display = method === 'bot' ? '' : 'none';
}

function toggleTelegramConfig() {
  const enabled = document.getElementById('notif-telegram-enabled').checked;
  document.getElementById('telegram-config').style.display = enabled ? '' : 'none';
  document.getElementById('btn-test-telegram').style.display = enabled ? '' : 'none';
}

// Test notification
async function testNotification(service, btnId) {
  const btn = document.getElementById(btnId);
  const originalText = btn.textContent;
  btn.textContent = 'Sending...';
  btn.className = 'btn-test testing';

  // Save current settings first so main process has latest config
  await saveCurrentNotificationSettings();

  const result = await window.quack.testNotification(service);

  if (result.success) {
    btn.textContent = 'Sent!';
    btn.className = 'btn-test test-success';
  } else {
    btn.textContent = result.error || 'Failed';
    btn.className = 'btn-test test-fail';
  }

  setTimeout(() => {
    btn.textContent = originalText;
    btn.className = 'btn-test';
  }, 3000);
}

// Save just notification settings (used before test)
async function saveCurrentNotificationSettings() {
  await window.quack.saveSettings({
    notifications: {
      desktop: document.getElementById('notif-desktop').checked,
      discord: {
        enabled: document.getElementById('notif-discord-enabled').checked,
        method: document.getElementById('discord-method').value,
        webhookUrl: document.getElementById('discord-webhook-url').value,
        botToken: document.getElementById('discord-bot-token').value,
        channelId: document.getElementById('discord-channel-id').value
      },
      slack: {
        enabled: document.getElementById('notif-slack-enabled').checked,
        method: document.getElementById('slack-method').value,
        webhookUrl: document.getElementById('slack-webhook-url').value,
        botToken: document.getElementById('slack-bot-token').value,
        channelId: document.getElementById('slack-channel-id').value
      },
      telegram: {
        enabled: document.getElementById('notif-telegram-enabled').checked,
        botToken: document.getElementById('telegram-bot-token').value,
        chatId: document.getElementById('telegram-chat-id').value
      }
    }
  });
}

// Save
async function saveAllSettings() {
  const newSettings = {
    apiKeys: localApiKeys,
    phoneNumbers: localPhoneNumbers,
    globalPollInterval: parseInt(document.getElementById('global-poll-interval').value) || 10,
    notifications: {
      desktop: document.getElementById('notif-desktop').checked,
      discord: {
        enabled: document.getElementById('notif-discord-enabled').checked,
        method: document.getElementById('discord-method').value,
        webhookUrl: document.getElementById('discord-webhook-url').value,
        botToken: document.getElementById('discord-bot-token').value,
        channelId: document.getElementById('discord-channel-id').value
      },
      slack: {
        enabled: document.getElementById('notif-slack-enabled').checked,
        method: document.getElementById('slack-method').value,
        webhookUrl: document.getElementById('slack-webhook-url').value,
        botToken: document.getElementById('slack-bot-token').value,
        channelId: document.getElementById('slack-channel-id').value
      },
      telegram: {
        enabled: document.getElementById('notif-telegram-enabled').checked,
        botToken: document.getElementById('telegram-bot-token').value,
        chatId: document.getElementById('telegram-chat-id').value
      }
    }
  };

  await window.quack.saveSettings(newSettings);
  await window._app.refreshSettings();
  window._app.renderSidebar();
  window._app.showToast('Settings saved!');
  window._app.showView('dashboard');
}

// === Account ===
async function loadAccountData() {
  // Balance
  const balanceEl = document.getElementById('account-balance');
  balanceEl.textContent = 'Loading...';

  const balanceResult = await window.quack.getBalance();
  if (balanceResult.success === true || balanceResult.success === 'true') {
    const bal = `${balanceResult.currency || '$'}${Number(balanceResult.balance).toFixed(2)}`;
    balanceEl.textContent = bal;
    // Update sidebar balance
    const sidebarBal = document.getElementById('sidebar-balance');
    document.getElementById('sidebar-balance-text').textContent = bal;
    sidebarBal.style.display = '';
  } else {
    balanceEl.textContent = balanceResult.error || 'Failed to load';
  }

  // Active numbers
  const activeList = document.getElementById('active-numbers-list');
  activeList.innerHTML = '<div class="form-help">Loading...</div>';

  const activeResult = await window.quack.getActiveNumbers();
  if (activeResult.success === true || activeResult.success === 'true') {
    const numbers = activeResult.activeNumbers || [];
    if (numbers.length === 0) {
      activeList.innerHTML = '<div class="form-help">No active numbers.</div>';
    } else {
      activeList.innerHTML = numbers.map(n => {
        const endDate = n.rentalEndDate ? new Date(n.rentalEndDate) : null;
        const endStr = endDate ? endDate.toLocaleDateString() : 'N/A';
        const daysLeft = endDate ? Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24)) : null;
        const expiryBadge = daysLeft !== null
          ? (daysLeft <= 1 ? `<span class="badge-expiry-warn">${daysLeft <= 0 ? 'Expired' : daysLeft + 'd left'}</span>`
            : daysLeft <= 7 ? `<span class="badge-expiry-warn">${daysLeft}d left</span>`
            : `<span class="badge-expiry-ok">${daysLeft}d left</span>`)
          : '';
        return `
          <div class="number-info-card">
            <div class="number-info-card-left">
              <span class="number-info-card-number">${n.number}</span>
              <span class="number-info-card-meta">${n.nickname || 'No nickname'} &middot; Expires ${endStr}</span>
            </div>
            <div class="number-info-card-right">
              <span class="badge-locale">${n.locale || '??'}</span>
              ${expiryBadge}
            </div>
          </div>`;
      }).join('');
    }
  } else {
    activeList.innerHTML = `<div class="form-help" style="color:var(--danger);">${activeResult.error || 'Failed'}</div>`;
  }

  // Expiring numbers
  const expiringList = document.getElementById('expiring-numbers-list');
  expiringList.innerHTML = '<div class="form-help">Loading...</div>';

  const expiringResult = await window.quack.getExpiringNumbers();
  if (expiringResult.success === true || expiringResult.success === 'true') {
    const numbers = expiringResult.expiringNumbers || [];
    if (numbers.length === 0) {
      expiringList.innerHTML = '<div class="form-help">No numbers expiring soon.</div>';
    } else {
      expiringList.innerHTML = numbers.map(n => {
        const mins = n.minutesRemaining || 0;
        const timeStr = mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
        return `
          <div class="number-info-card">
            <div class="number-info-card-left">
              <span class="number-info-card-number">${n.number}</span>
              <span class="number-info-card-meta">${n.nickname || 'No nickname'}</span>
            </div>
            <div class="number-info-card-right">
              <span class="badge-locale">${n.locale || '??'}</span>
              <span class="badge-expiry-warn">${timeStr} left</span>
            </div>
          </div>`;
      }).join('');
    }
  } else {
    expiringList.innerHTML = `<div class="form-help" style="color:var(--danger);">${expiringResult.error || 'Failed'}</div>`;
  }
}

async function importActiveNumbers() {
  const btn = document.getElementById('btn-import-numbers');
  btn.textContent = 'Importing...';
  btn.disabled = true;

  const result = await window.quack.getActiveNumbers();
  if (result.success === true || result.success === 'true') {
    const activeNumbers = result.activeNumbers || [];
    let imported = 0;

    for (const an of activeNumbers) {
      const exists = localPhoneNumbers.some(p => p.number === an.number);
      if (!exists) {
        // Try to get nickname from Quackr
        let nickname = an.nickname || '';
        if (!nickname) {
          const nickResult = await window.quack.getNickname(an.number);
          if ((nickResult.success === true || nickResult.success === 'true') && nickResult.nickname) {
            nickname = nickResult.nickname;
          }
        }

        localPhoneNumbers.push({
          number: an.number,
          name: nickname,
          apiKeyId: localApiKeys.length > 0 ? localApiKeys[0].id : '',
          pollInterval: null
        });
        imported++;
      }
    }

    renderPhoneNumbers();
    btn.textContent = imported > 0 ? `Imported ${imported} number${imported !== 1 ? 's' : ''}!` : 'No new numbers';
  } else {
    btn.textContent = result.error || 'Failed';
  }

  setTimeout(() => {
    btn.textContent = 'Import from Quackr';
    btn.disabled = false;
  }, 3000);
}

// === Webhooks ===
async function loadWebhookData() {
  const currentEl = document.getElementById('webhook-current');
  currentEl.textContent = 'Loading...';

  const result = await window.quack.getWebhook();
  if (result.success === true || result.success === 'true') {
    currentEl.textContent = result.webhookUrl || 'Not configured';
  } else {
    currentEl.textContent = result.error || 'Failed to load';
  }
}

async function saveWebhook() {
  const urlInput = document.getElementById('webhook-url-input');
  const url = urlInput.value.trim();
  if (!url) {
    window._app.showToast('Please enter a webhook URL', true);
    return;
  }

  const btn = document.getElementById('btn-set-webhook');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  const result = await window.quack.setWebhook(url);
  if (result.success === true || result.success === 'true') {
    window._app.showToast('Webhook saved!');
    urlInput.value = '';
    loadWebhookData();
  } else {
    window._app.showToast(result.error || 'Failed to save webhook', true);
  }

  btn.textContent = 'Save Webhook';
  btn.disabled = false;
}

// === Help / About ===
async function checkForUpdates() {
  const btn = document.getElementById('btn-check-update');
  const statusEl = document.getElementById('update-status');
  btn.textContent = 'Checking...';
  btn.disabled = true;
  statusEl.textContent = '';
  statusEl.className = 'about-update-status';

  const result = await window.quack.checkForUpdates();

  if (result.error) {
    statusEl.textContent = result.error;
    statusEl.className = 'about-update-status update-error';
  } else if (result.upToDate) {
    statusEl.textContent = `You're up to date! (v${result.currentVersion})`;
    statusEl.className = 'about-update-status update-ok';
  } else {
    statusEl.innerHTML = `New version available: <strong>v${result.latestVersion}</strong> (current: v${result.currentVersion})`;
    statusEl.className = 'about-update-status update-available';

    // Add a link to the release page
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = ' View release';
    link.style.marginLeft = '8px';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.quack.openExternal(`https://github.com/GoblinRules/quack-manager/releases/tag/v${result.latestVersion}`);
    });
    statusEl.appendChild(link);
  }

  btn.textContent = 'Check for Updates';
  btn.disabled = false;
}

// Utils
function generateId() {
  return 'key_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
