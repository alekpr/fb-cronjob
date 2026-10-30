'use strict';

const $ = (id) => document.getElementById(id);
let timer;

const STATUS_LABEL = {
  queued: 'รอคิว',
  publishing: 'กำลังโพสต์',
  done: 'เสร็จ',
  paused: 'หยุดชั่วคราว',
  failed: 'ล้มเหลว',
};

function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  t.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => (t.hidden = true), 5000);
}

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: isForm ? {} : { 'Content-Type': 'application/json' },
    body: opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmtBkk(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts * 1000));
}

function humanize(sec) {
  const a = Math.abs(sec);
  let out;
  if (a < 60) out = a + ' วิ';
  else if (a < 3600) out = Math.floor(a / 60) + ' นาที';
  else if (a < 86400) out = Math.floor(a / 3600) + ' ชม. ' + Math.floor((a % 3600) / 60) + ' นาที';
  else out = Math.floor(a / 86400) + ' วัน ' + Math.floor((a % 86400) / 3600) + ' ชม.';
  return sec < 0 ? 'เกิน ' + out + ' แล้ว' : 'อีก ' + out;
}

function switchView(name) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + name));
  if (name === 'queue') loadQueue();
  if (name === 'history') loadHistory();
  if (name === 'pages') loadPages();
  if (name === 'log') loadLogs();
}

// ---- Config ----
async function loadConfig() {
  try {
    const c = await api('/config');
    const badge = $('badge');
    if (c.dryRun) {
      badge.textContent = c.pageCount ? `DRY-RUN • ${c.pageCount} เพจ` : 'DRY-RUN • ยังไม่มีเพจ';
      badge.className = 'badge';
    } else if (c.pageCount) {
      badge.textContent = `พร้อม • ${c.pageCount} เพจ`;
      badge.className = 'badge ok';
    } else {
      badge.textContent = 'ยังไม่มีเพจ';
      badge.className = 'badge err';
    }
  } catch {
    /* ignore */
  }
}

// ---- Create form ----
function updateScheduleUI() {
  const t = $('scheduleType').value;
  $('onceGroup').classList.toggle('hidden', t !== 'once');
  $('recurringGroup').classList.toggle('hidden', t === 'once');
  $('weeklyGroup').classList.toggle('hidden', t !== 'weekly');
  $('monthlyGroup').classList.toggle('hidden', t !== 'monthly');
}

$('scheduleType').onchange = updateScheduleUI;

$('createBtn').onclick = async () => {
  const pageId = $('pageSelect').value;
  const scheduleType = $('scheduleType').value;
  const message = $('message').value;
  const hashtags = $('hashtags').value;
  const media = $('media').files;

  if (!pageId) return toast('กรุณาเลือกเพจ (เพิ่มในแท็บ "ตั้งค่าเพจ" ก่อน)', true);
  if (!message.trim()) return toast('กรุณากรอกข้อความโพสต์', true);

  const fd = new FormData();
  fd.append('pageId', pageId);
  fd.append('scheduleType', scheduleType);
  fd.append('message', message);
  fd.append('hashtags', hashtags);

  if (scheduleType === 'once') {
    fd.append('datetime', $('datetime').value);
  } else {
    fd.append('time', $('time').value);
    if (scheduleType === 'weekly') {
      const wd = [...document.querySelectorAll('#weekdays input:checked')].map((c) => Number(c.value));
      if (!wd.length) return toast('กรุณาเลือกวันในสัปดาห์', true);
      fd.append('weekdays', JSON.stringify(wd));
    }
    if (scheduleType === 'monthly') fd.append('dayOfMonth', $('dayOfMonth').value);
  }
  for (const f of media) fd.append('media', f);

  $('createBtn').disabled = true;
  $('createStatus').textContent = 'กำลังบันทึก…';
  try {
    const r = await api('/jobs', { method: 'POST', body: fd });
    $('createStatus').textContent = '';
    toast('เพิ่มเข้าคิวแล้ว • ' + r.job.recurrence_label);
    $('message').value = '';
    $('hashtags').value = '';
    $('media').value = '';
    switchView('queue');
  } catch (e) {
    toast('เพิ่มไม่สำเร็จ: ' + e.message, true);
    $('createStatus').textContent = '';
  } finally {
    $('createBtn').disabled = false;
  }
};

// ---- Pages ----
async function loadPages() {
  const { pages } = await api('/pages');
  const sel = $('pageSelect');
  sel.replaceChildren();
  if (!pages.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— ยังไม่มีเพจ —';
    sel.appendChild(o);
  }
  for (const p of pages) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = (p.is_default ? '⭐ ' : '') + (p.name || p.id);
    sel.appendChild(o);
  }
  renderPagesList(pages);
}

function renderPagesList(pages) {
  const wrap = $('pagesList');
  if (!pages.length) {
    wrap.innerHTML = '<div class="empty">ยังไม่มีเพจ — เพิ่มด้านล่าง</div>';
    return;
  }
  let html =
    '<table class="data"><thead><tr><th>เพจ</th><th>Page ID</th><th>ค่าเริ่มต้น</th><th>จัดการ</th></tr></thead><tbody>';
  for (const p of pages) {
    html += `<tr><td>${esc(p.name)}</td><td>${esc(p.id)}</td><td>${p.is_default ? '⭐' : '—'}</td><td>${pageActions(p)}</td></tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function pageActions(p) {
  const b = [];
  if (!p.is_default) b.push(`<button data-act="default" data-id="${esc(p.id)}">ตั้งเป็นค่าเริ่มต้น</button>`);
  b.push(`<button data-act="test" data-id="${esc(p.id)}">ทดสอบ</button>`);
  b.push(`<button data-act="delete" data-id="${esc(p.id)}">ลบ</button>`);
  return b.join(' ');
}

$('pagesList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'default') {
    await api('/pages/' + encodeURIComponent(id) + '/default', { method: 'POST' });
    toast('ตั้งเป็นค่าเริ่มต้นแล้ว');
    loadPages();
    loadConfig();
  }
  if (act === 'delete') {
    if (!confirm('ลบเพจนี้? job ที่ผูกกับเพจนี้จะโพสต์ล้มเหลว')) return;
    await api('/pages/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('ลบแล้ว');
    loadPages();
    loadConfig();
  }
  if (act === 'test') {
    try {
      const r = await api('/pages/' + encodeURIComponent(id) + '/test', { method: 'POST' });
      toast('เชื่อมต่อได้: ' + r.pageName);
    } catch (err) {
      toast(err.message, true);
    }
  }
});

$('addPageBtn').onclick = async () => {
  const id = $('addPageId').value.trim();
  const name = $('addPageName').value.trim();
  const accessToken = $('addPageToken').value.trim();
  if (!id || !accessToken) return toast('กรุณากรอก Page ID และ Token', true);
  try {
    await api('/pages', { method: 'POST', body: JSON.stringify({ id, name, accessToken }) });
    $('addPageId').value = '';
    $('addPageName').value = '';
    $('addPageToken').value = '';
    toast('เพิ่มเพจแล้ว');
    loadPages();
    loadConfig();
  } catch (e) {
    toast(e.message, true);
  }
};

$('importBtn').onclick = async () => {
  const userToken = $('importToken').value.trim();
  if (!userToken) return toast('กรุณาวาง User Access Token', true);
  $('importBtn').disabled = true;
  $('importStatus').textContent = 'กำลังดึงเพจ…';
  try {
    const r = await api('/pages/import', { method: 'POST', body: JSON.stringify({ userToken }) });
    $('importToken').value = '';
    $('importStatus').textContent = '';
    toast('นำเข้า ' + r.imported + ' เพจแล้ว');
    loadPages();
    loadConfig();
  } catch (e) {
    toast(e.message, true);
    $('importStatus').textContent = '';
  } finally {
    $('importBtn').disabled = false;
  }
};

// ---- Queue ----
async function loadQueue() {
  const { jobs } = await api('/jobs');
  renderQueue(jobs);
}

function renderQueue(jobs) {
  const wrap = $('queueTable');
  if (!jobs.length) {
    wrap.innerHTML = '<div class="empty">ยังไม่มีโพสต์ในคิว</div>';
    return;
  }
  let html =
    '<table class="data"><thead><tr><th>เพจ</th><th>ข้อความ</th><th>media</th><th>ตาราง</th><th>โพสต์เมื่อ</th><th>นับถอยหลัง</th><th>สถานะ</th><th>รันแล้ว</th><th>จัดการ</th></tr></thead><tbody>';
  for (const j of jobs) {
    const err = j.error_message ? `<div class="error-list">${esc(j.error_message)}</div>` : '';
    html += `<tr><td>${esc(j.page_name || j.page_id)}</td><td>${esc(j.message)}</td><td>${esc((j.media_files || []).join('; '))}</td><td>${esc(j.recurrence_label)}</td><td>${fmtBkk(j.next_run_at)}</td><td class="countdown" data-next="${j.next_run_at || ''}"></td><td><span class="status ${j.status}">${STATUS_LABEL[j.status] || j.status}</span>${err}</td><td>${j.run_count}</td><td>${jobActions(j)}</td></tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  updateCountdowns();
}

function jobActions(j) {
  const b = [];
  if (j.status === 'queued') b.push(`<button data-act="pause" data-id="${j.id}">หยุด</button>`);
  if (j.status === 'paused') b.push(`<button data-act="resume" data-id="${j.id}">ทำต่อ</button>`);
  if (j.status !== 'publishing') b.push(`<button data-act="run-now" data-id="${j.id}">โพสต์เลย</button>`);
  b.push(`<button data-act="delete" data-id="${j.id}">ลบ</button>`);
  return b.join(' ');
}

function updateCountdowns() {
  const now = Math.floor(Date.now() / 1000);
  document.querySelectorAll('.countdown').forEach((el) => {
    const next = Number(el.dataset.next);
    el.textContent = next ? humanize(next - now) : '';
  });
}

$('queueTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'pause') {
    await api('/jobs/' + id + '/pause', { method: 'POST' });
    loadQueue();
  }
  if (act === 'resume') {
    await api('/jobs/' + id + '/resume', { method: 'POST' });
    loadQueue();
  }
  if (act === 'run-now') {
    if (!confirm('โพสต์ job นี้ทันที?')) return;
    await api('/jobs/' + id + '/run-now', { method: 'POST' });
    toast('กำลังโพสต์…');
    loadQueue();
  }
  if (act === 'delete') {
    if (!confirm('ลบ job นี้ออกจากคิว?')) return;
    await api('/jobs/' + id, { method: 'DELETE' });
    loadQueue();
  }
});

// ---- History ----
async function loadHistory() {
  const { history } = await api('/history?limit=200');
  const wrap = $('historyTable');
  if (!history.length) {
    wrap.innerHTML = '<div class="empty">ยังไม่มีประวัติ</div>';
    return;
  }
  let html =
    '<table class="data"><thead><tr><th>เวลา</th><th>เพจ</th><th>ข้อความ</th><th>ผล</th><th>fb_post_id</th><th>error</th></tr></thead><tbody>';
  for (const h of history) {
    const result = h.success
      ? '<span style="color:#b5f3ce">สำเร็จ</span>'
      : '<span style="color:#f3b5b5">ล้มเหลว</span>';
    html += `<tr><td>${esc((h.created_at || '').replace('T', ' ').slice(0, 19))}</td><td>${esc(h.page_name || h.page_id)}</td><td>${esc(h.message || '')}</td><td>${result}</td><td>${esc(h.fb_post_id || '—')}</td><td class="error-list">${esc(h.error || '')}</td></tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ---- Log ----
async function loadLogs() {
  const { lines } = await api('/logs?lines=300');
  const pretty = lines.map((l) => {
    try {
      const o = JSON.parse(l);
      const time = o.time ? new Date(o.time).toLocaleString('th-TH') : '';
      const extras = Object.entries(o)
        .filter(([k]) => !['level', 'time', 'msg'].includes(k))
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
      return [time, o.msg, extras].filter(Boolean).join('  ');
    } catch {
      return l;
    }
  });
  $('logBody').textContent = pretty.join('\n') || '(ยังไม่มี log)';
}

// ---- Init ----
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
$('queueRefresh').onclick = loadQueue;
$('historyRefresh').onclick = loadHistory;
$('logRefresh').onclick = loadLogs;

loadConfig();
loadPages();
loadQueue();
updateScheduleUI();

setInterval(updateCountdowns, 1000);
setInterval(loadQueue, 15000);
