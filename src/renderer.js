// State
let currentView = 'dashboard';
let selectedNumber = null;
let settings = {};
let messageCaches = {};
let unreadCounts = {};
let readMessages = new Set(); // Track read message IDs
let sidebarSearchQuery = '';

// Load read state from localStorage
try {
  const saved = localStorage.getItem('quack-read-messages');
  if (saved) readMessages = new Set(JSON.parse(saved));
} catch (e) {}

function saveReadState() {
  localStorage.setItem('quack-read-messages', JSON.stringify([...readMessages]));
}

function getMsgId(msg) {
  return `${msg.sender}_${msg.received}_${(msg.message || '').slice(0, 30)}`;
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  settings = await window.quack.getSettings();
  document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
  renderSidebar();
  setupWindowControls();
  setupNavigation();
  setupSidebarSearch();
  listenForNewMessages();
  loadSidebarBalance();
});

// Window controls
function setupWindowControls() {
  document.getElementById('btn-minimize').addEventListener('click', () => window.quack.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.quack.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.quack.close());
}

// Navigation
function setupNavigation() {
  document.getElementById('btn-settings').addEventListener('click', () => showView('settings'));
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-inbox').addEventListener('click', () => selectInbox());
  document.getElementById('link-quackr').addEventListener('click', (e) => {
    e.preventDefault();
    window.quack.openExternal('https://quackr.io');
  });
}

// Sidebar search
function setupSidebarSearch() {
  document.getElementById('sidebar-search-input').addEventListener('input', (e) => {
    sidebarSearchQuery = e.target.value.toLowerCase().trim();
    renderSidebar();
  });
}

function showView(view) {
  currentView = view;
  document.getElementById('view-dashboard').style.display = view === 'dashboard' ? '' : 'none';
  document.getElementById('view-settings').style.display = view === 'settings' ? '' : 'none';

  if (view === 'settings') {
    loadSettingsForm();
    document.querySelectorAll('.sidebar-number').forEach(el => el.classList.remove('active'));
  }
}

async function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  settings.theme = next;
  await window.quack.saveSettings({ theme: next });
}

// Sidebar
function renderSidebar() {
  const container = document.getElementById('sidebar-numbers');
  const numbers = settings.phoneNumbers || [];

  // Update inbox active state
  const inboxEl = document.getElementById('btn-inbox');
  if (selectedNumber === '__inbox__') {
    inboxEl.classList.add('active');
  } else {
    inboxEl.classList.remove('active');
  }

  // Update inbox badge (total unread across all numbers)
  const totalUnread = Object.values(unreadCounts).reduce((sum, c) => sum + c, 0);
  const inboxBadge = document.getElementById('inbox-badge');
  if (totalUnread > 0) {
    inboxBadge.textContent = totalUnread;
    inboxBadge.style.display = '';
  } else {
    inboxBadge.style.display = 'none';
  }

  if (numbers.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">No numbers configured. Go to Settings to add phone numbers.</div>';
    return;
  }

  // Filter by search
  const filtered = numbers.filter(entry => {
    if (!sidebarSearchQuery) return true;
    return (entry.number || '').toLowerCase().includes(sidebarSearchQuery) ||
           (entry.name || '').toLowerCase().includes(sidebarSearchQuery);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">No matching numbers.</div>';
    return;
  }

  container.innerHTML = filtered.map(entry => {
    const name = entry.name || formatPhone(entry.number);
    const unread = unreadCounts[entry.number] || 0;
    return `
      <div class="sidebar-number ${selectedNumber === entry.number ? 'active' : ''}" data-number="${entry.number}">
        <div class="sidebar-number-info">
          <div class="sidebar-number-name">${escapeHtml(name)}</div>
          <div class="sidebar-number-num">${formatPhone(entry.number)}</div>
        </div>
        ${unread > 0 ? `<span class="sidebar-badge">${unread}</span>` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.sidebar-number').forEach(el => {
    el.addEventListener('click', () => selectNumber(el.dataset.number));
  });
}

function formatPhone(num) {
  if (!num) return '';
  const clean = num.replace(/\D/g, '');
  if (clean.length === 11 && clean.startsWith('1')) {
    return `+1 (${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7)}`;
  }
  return num.startsWith('+') ? num : `+${num}`;
}

// Get display name for a phone number
function getNumberDisplayName(number) {
  const entry = (settings.phoneNumbers || []).find(p => p.number === number);
  return entry?.name || formatPhone(number);
}

// Select Inbox (unified view)
async function selectInbox() {
  selectedNumber = '__inbox__';
  showView('dashboard');
  renderSidebar();

  const welcome = document.getElementById('dashboard-welcome');
  const msgContainer = document.getElementById('messages-container');
  welcome.style.display = 'none';
  msgContainer.style.display = 'flex';

  document.getElementById('messages-header').innerHTML = `
    <div class="messages-header-info">
      <h2>Inbox</h2>
      <span>All messages from all numbers</span>
    </div>
    <div class="messages-header-actions">
      <button class="btn-action" id="btn-mark-all-read" title="Mark all as read">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Mark all read
      </button>
      <button class="btn-action" id="btn-refresh-messages" title="Refresh">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        Refresh
      </button>
    </div>
  `;

  document.getElementById('btn-refresh-messages').addEventListener('click', () => loadInbox());
  document.getElementById('btn-mark-all-read').addEventListener('click', () => markAllReadInbox());
  await loadInbox();
}

async function loadInbox() {
  const list = document.getElementById('messages-list');
  list.innerHTML = '<div class="messages-loading">Loading messages...</div>';

  const numbers = settings.phoneNumbers || [];
  const fetchPromises = numbers.map(async (entry) => {
    const result = await window.quack.fetchMessages(entry.number);
    if (result.success === 'true' || result.success === true) {
      const messages = result.data?.messages || [];
      messageCaches[entry.number] = messages;
      return messages.map(msg => ({ ...msg, _phoneNumber: entry.number }));
    }
    return [];
  });

  const results = await Promise.all(fetchPromises);
  const allMessages = results.flat();

  if (allMessages.length === 0) {
    list.innerHTML = '<div class="messages-loading">No messages yet.</div>';
    return;
  }

  const sorted = allMessages.sort((a, b) => (b.received || 0) - (a.received || 0));
  list.innerHTML = sorted.map(msg => renderMessageCard(msg, true)).join('');
  attachMessageCardHandlers(list);
}

function markAllReadInbox() {
  for (const number of Object.keys(messageCaches)) {
    const messages = messageCaches[number] || [];
    for (const msg of messages) {
      readMessages.add(getMsgId(msg));
    }
  }
  saveReadState();
  loadInbox();
}

// Select a phone number
async function selectNumber(number) {
  selectedNumber = number;
  showView('dashboard');

  // Clear unread for this number
  unreadCounts[number] = 0;
  renderSidebar();

  const welcome = document.getElementById('dashboard-welcome');
  const msgContainer = document.getElementById('messages-container');
  welcome.style.display = 'none';
  msgContainer.style.display = 'flex';

  const entry = settings.phoneNumbers.find(p => p.number === number);
  const name = entry?.name || formatPhone(number);

  document.getElementById('messages-header').innerHTML = `
    <div class="messages-header-info">
      <h2>${escapeHtml(name)}</h2>
      <span>${formatPhone(number)}</span>
    </div>
    <div class="messages-header-actions">
      <button class="btn-action" id="btn-mark-all-read" title="Mark all as read">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Mark all read
      </button>
      <button class="btn-action" id="btn-refresh-messages" title="Refresh">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        Refresh
      </button>
    </div>
  `;

  document.getElementById('btn-refresh-messages').addEventListener('click', () => loadMessages(number));
  document.getElementById('btn-mark-all-read').addEventListener('click', () => markAllRead(number));
  await loadMessages(number);
}

function markAllRead(number) {
  const messages = messageCaches[number] || [];
  for (const msg of messages) {
    readMessages.add(getMsgId(msg));
  }
  saveReadState();
  renderMessagesList(number);
}

async function loadMessages(number) {
  const list = document.getElementById('messages-list');
  list.innerHTML = '<div class="messages-loading">Loading messages...</div>';

  const result = await window.quack.fetchMessages(number);

  if (result.success === 'true' || result.success === true) {
    const messages = result.data?.messages || [];
    messageCaches[number] = messages;

    if (messages.length === 0) {
      list.innerHTML = '<div class="messages-loading">No messages yet.</div>';
      return;
    }

    renderMessagesList(number);
  } else {
    list.innerHTML = `<div class="messages-error">Error: ${escapeHtml(result.error || 'Failed to fetch messages')}</div>`;
  }
}

function renderMessagesList(number) {
  const messages = messageCaches[number] || [];
  const list = document.getElementById('messages-list');
  const sorted = [...messages].sort((a, b) => (b.received || 0) - (a.received || 0));
  list.innerHTML = sorted.map(msg => renderMessageCard(msg, false)).join('');
  attachMessageCardHandlers(list);
}

function attachMessageCardHandlers(list) {
  list.querySelectorAll('.message-card').forEach(card => {
    card.addEventListener('click', () => {
      const msgId = card.dataset.msgId;
      card.classList.toggle('expanded');

      // Mark as read on click
      if (msgId && !readMessages.has(msgId)) {
        readMessages.add(msgId);
        saveReadState();
        card.classList.remove('message-unread');
      }
    });
  });
}

function renderMessageCard(msg, showRecipient = false) {
  const ts = msg.received;
  const date = ts ? new Date(Number(ts)) : null;
  const relative = date && !isNaN(date) ? getRelativeTime(date) : '';
  const absolute = date && !isNaN(date) ? date.toLocaleString() : '';

  const sender = msg.sender || 'Unknown';
  const body = msg.message || '';
  const msgId = getMsgId(msg);
  const isRead = readMessages.has(msgId);
  const isLong = body.length > 120;

  const recipientTag = showRecipient && msg._phoneNumber
    ? `<span class="message-recipient">${escapeHtml(getNumberDisplayName(msg._phoneNumber))}</span>`
    : '';

  return `
    <div class="message-card ${isRead ? '' : 'message-unread'} ${isLong ? 'message-truncated' : ''}" data-msg-id="${escapeHtml(msgId)}">
      <div class="message-card-header">
        <span class="message-sender">${escapeHtml(sender)}${recipientTag ? ' ' + recipientTag : ''}</span>
        <span class="message-time" title="${absolute}">
          ${relative}
        </span>
      </div>
      <div class="message-body">${escapeHtml(body)}</div>
      ${isLong ? '<div class="message-expand-hint">Click to expand</div>' : ''}
    </div>
  `;
}

function getRelativeTime(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 5) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

// Listen for real-time new messages from poller
function listenForNewMessages() {
  window.quack.onNewMessages((data) => {
    if (!messageCaches[data.phoneNumber]) messageCaches[data.phoneNumber] = [];
    messageCaches[data.phoneNumber].push(...data.messages);

    if (selectedNumber === '__inbox__') {
      // Refresh inbox view
      loadInbox();
    } else if (selectedNumber === data.phoneNumber) {
      renderMessagesList(data.phoneNumber);
    } else {
      unreadCounts[data.phoneNumber] = (unreadCounts[data.phoneNumber] || 0) + data.messages.length;
      renderSidebar();
    }
  });
}

// Load balance for sidebar
async function loadSidebarBalance() {
  try {
    const result = await window.quack.getBalance();
    if (result.success === true || result.success === 'true') {
      const bal = `${result.currency || '$'}${Number(result.balance).toFixed(2)}`;
      document.getElementById('sidebar-balance-text').textContent = bal;
      document.getElementById('sidebar-balance').style.display = '';
    }
  } catch (e) {}
}

// Utils
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'toast-error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Expose for settings.js
window._app = {
  get settings() { return settings; },
  showView,
  renderSidebar,
  showToast,
  refreshSettings: async () => {
    settings = await window.quack.getSettings();
  }
};
