import '../src/styles/global.css';
import { loadCommands, onCommandsChanged } from '../src/lib/store.js';
import { iconHTML } from '../src/lib/icons.js';

function muxy() {
  if (!window.muxy) throw new Error('window.muxy unavailable — open inside Muxy.');
  return window.muxy;
}

const listEl = document.querySelector('#list');
const emptyEl = document.querySelector('#empty');
const manageBtn = document.querySelector('#manage');

manageBtn.querySelector('.manage-icon').innerHTML = iconHTML('gear', 14);

function render(commands) {
  listEl.innerHTML = '';
  emptyEl.hidden = commands.length > 0;
  for (const cmd of commands) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cmd';
    btn.title = cmd.command;
    btn.innerHTML = `<span class="cmd-icon">${iconHTML(cmd.icon, 14)}</span>` +
      `<span class="cmd-name">${escapeHTML(cmd.name || cmd.command)}</span>`;
    btn.addEventListener('click', () => run(cmd));
    li.appendChild(btn);
    listEl.appendChild(li);
  }
  resize();
}

async function run(cmd) {
  if (!cmd.command) return;
  try {
    const request = { kind: 'terminal', command: cmd.command };
    if (cmd.cwd) request.directory = cmd.cwd;
    await muxy().tabs.open(request);
    muxy().popover?.close?.();
  } catch (error) {
    muxy().toast?.({ title: 'Failed to run command', body: error?.message || String(error) });
  }
}

async function openSettings() {
  try {
    await muxy().tabs.open({ kind: 'extensionWebView', extension: { id: muxy().extensionID, tabType: 'settings' } });
    muxy().popover?.close?.();
  } catch (error) {
    muxy().toast?.({ title: 'Could not open settings', body: error?.message || String(error) });
  }
}

function resize() {
  const m = muxy();
  if (!m.popover?.resize) return;
  m.popover.resize(220, Math.min(document.documentElement.scrollHeight, 480));
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

manageBtn.addEventListener('click', openSettings);
onCommandsChanged(render);
render(loadCommands());
