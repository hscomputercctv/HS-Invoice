import { supabase } from './supabase-config.js';
import { formatMoney, formatDate, requireAuth, escapeHtml, showMsg } from './utils.js';

const $ = (id) => document.getElementById(id);

let me = null;
let allInvoicesCache = [];
let selectedInvoices = new Set();
let allTechInvCache = [];
let selectedTechInv = new Set();
let notificationsCache = [];
let unreadCount = 0;

// ============================================
// INIT
// ============================================
(async () => {
  const ctx = await requireAuth(supabase, 'admin');
  if (!ctx) return;
  me = ctx.profile;

  // ─── Logout ───
  $('logoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  // ─── Tabs ───
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const view = b.dataset.view;
      if (!view) return;
      
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('view-' + view)?.classList.add('active');
    });
  });

  // ─── New Invoice Button ───
  $('newInvoiceBtn')?.addEventListener('click', () => {
    window.location.href = 'invoice.html';
  });

  // ─── Invoice Filters ───
  $('invSearch')?.addEventListener('input', (e) => loadInvoices(e.target.value));
  $('invFromDate')?.addEventListener('change', () => loadInvoices($('invSearch')?.value || ''));
  $('invToDate')?.addEventListener('change', () => loadInvoices($('invSearch')?.value || ''));
  $('downloadInvoicesBtn')?.addEventListener('click', downloadInvoicesCSV);
  $('bulkDeleteInvoicesBtn')?.addEventListener('click', bulkDeleteInvoices);

  // ─── Technician Invoice Filters ───
  $('techInvSearch')?.addEventListener('input', (e) => loadTechnicianInvoices(e.target.value));
  $('techInvFromDate')?.addEventListener('change', () => loadTechnicianInvoices($('techInvSearch')?.value || ''));
  $('techInvToDate')?.addEventListener('change', () => loadTechnicianInvoices($('techInvSearch')?.value || ''));
  $('techInvStatusFilter')?.addEventListener('change', () => loadTechnicianInvoices($('techInvSearch')?.value || ''));
  $('downloadTechInvBtn')?.addEventListener('click', downloadTechInvoicesCSV);
  $('bulkDeleteTechInvBtn')?.addEventListener('click', bulkDeleteTechInvoices);

  // ─── Notification Setup ───
  setupNotificationBell();

  // ─── Load Everything ───
  await loadShopSettings();
  await loadOverview();
  await loadInvoices();
  await loadTechnicianInvoices();
  await loadWorkers();
  await loadNotifications();
  bindForms();
  setupLogoUpload();
  setupRealtimeNotifications();
})();

// ============================================
// OVERVIEW
// ============================================
async function loadOverview() {
  const { data: invoices } = await supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false });

  const all = invoices || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sales = all.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const todayCount = all.filter((i) => new Date(i.created_at) >= today).length;

  $('statSales').textContent = formatMoney(sales);
  $('statToday').textContent = todayCount;
  $('statTotal').textContent = all.length;

  // Active workers count
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'worker')
    .eq('is_active', true);
  $('statWorkers').textContent = count || 0;

  // Technician stats
  const { data: techInvoices } = await supabase
    .from('technician_invoices')
    .select('*')
    .order('created_at', { ascending: false });

  const allTech = techInvoices || [];
  const techRevenue = allTech.reduce((s, i) => s + Number(i.grand_total || 0), 0);

  $('statTechJobs').textContent = allTech.length;
  $('statTechRevenue').textContent = formatMoney(techRevenue);

  // Pending count
  const { count: pendingCount } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', false);

  const pendingCard = $('pendingCard');
  if (pendingCard) {
    if (pendingCount > 0) {
      pendingCard.style.display = 'block';
      $('statPending').textContent = pendingCount;
    } else {
      pendingCard.style.display = 'none';
    }
  }

  // Recent customer invoices
  const tbody = $('recentTable').querySelector('tbody');
  tbody.innerHTML = all.slice(0, 8).map((i) => `
    <tr>
      <td>${escapeHtml(i.invoice_number)}</td>
      <td>${escapeHtml(i.customer_name)}</td>
      <td>${formatMoney(i.grand_total)}</td>
      <td>${escapeHtml(i.created_by_name || '-')}</td>
      <td>${formatDate(i.created_at)}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No invoices yet</td></tr>`;

  // Recent technician invoices
  const techTbody = $('recentTechTable')?.querySelector('tbody');
  if (techTbody) {
    techTbody.innerHTML = allTech.slice(0, 5).map((i) => {
      const statusColor =
        i.payment_status === 'Paid' ? '#10b981' :
        i.payment_status === 'Partial' ? '#f59e0b' : '#ef4444';

      return `
        <tr>
          <td>${escapeHtml(i.invoice_number)}</td>
          <td>${escapeHtml(i.technician_name || '-')}</td>
          <td>${escapeHtml(i.customer_name)}</td>
          <td>${formatMoney(i.grand_total)}</td>
          <td><span style="color:${statusColor};font-weight:600;font-size:12px">${i.payment_status || 'Pending'}</span></td>
          <td>${formatDate(i.created_at)}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">No technician invoices yet</td></tr>`;
  }
}

// ============================================
// CUSTOMER INVOICES
// ============================================
async function loadInvoices(filter = '') {
  const fromDate = $('invFromDate')?.value || '';
  const toDate = $('invToDate')?.value || '';

  let query = supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false });

  if (fromDate) query = query.gte('created_at', fromDate);
  if (toDate) query = query.lte('created_at', toDate + 'T23:59:59');

  const { data, error } = await query;
  if (error) {
    console.error('Load invoices error:', error);
    return;
  }

  allInvoicesCache = data || [];

  const list = allInvoicesCache.filter((i) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      (i.invoice_number || '').toLowerCase().includes(f) ||
      (i.customer_name || '').toLowerCase().includes(f) ||
      (i.created_by_name || '').toLowerCase().includes(f)
    );
  });

  const totalEl = $('invTotalCount');
  if (totalEl) totalEl.textContent = `${list.length} invoice${list.length !== 1 ? 's' : ''}`;

  const tbody = $('invoicesTable').querySelector('tbody');

  if (!list.length) {
    tbody.innerHTML = `
      <tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Koi invoice nahi mili.</td></tr>`;
    updateBulkDeleteButton();
    return;
  }

  tbody.innerHTML = list.map((i) => `
    <tr data-invoice-id="${i.id}">
      <td style="text-align:center">
        <input type="checkbox" class="inv-checkbox" data-id="${i.id}" style="width:auto;cursor:pointer" />
      </td>
      <td>${escapeHtml(i.invoice_number)}</td>
      <td>${escapeHtml(i.customer_name)}</td>
      <td>${formatMoney(i.grand_total)}</td>
      <td>${escapeHtml(i.created_by_name || '-')}</td>
      <td>${formatDate(i.created_at)}</td>
      <td>
        <button class="btn" style="padding:6px 10px;min-height:auto;font-size:12px" 
          onclick="window.location.href='invoice.html?id=${i.id}'">View</button>
      </td>
    </tr>
  `).join('');

  // Checkbox handlers
  tbody.querySelectorAll('.inv-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedInvoices.add(cb.dataset.id);
      else selectedInvoices.delete(cb.dataset.id);
      updateBulkDeleteButton();
    });
  });

  const selectAll = $('invSelectAll');
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    selectAll.onchange = () => {
      const cbs = tbody.querySelectorAll('.inv-checkbox');
      cbs.forEach((cb) => {
        cb.checked = selectAll.checked;
        if (selectAll.checked) selectedInvoices.add(cb.dataset.id);
        else selectedInvoices.delete(cb.dataset.id);
      });
      updateBulkDeleteButton();
    };
  }

  updateBulkDeleteButton();
}

function updateBulkDeleteButton() {
  const btn = $('bulkDeleteInvoicesBtn');
  const countEl = $('selectedInvCount');
  if (!btn) return;
  const count = selectedInvoices.size;
  if (countEl) countEl.textContent = count;
  btn.disabled = count === 0;
}

async function bulkDeleteInvoices() {
  if (selectedInvoices.size === 0) return;
  const count = selectedInvoices.size;

  if (!confirm(`🗑️ ${count} invoice${count > 1 ? 's' : ''} delete karni hain?\n\nYe action undo nahi ho sakta!`)) return;

  const btn = $('bulkDeleteInvoicesBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Deleting...';

  const ids = Array.from(selectedInvoices);
  const { error } = await supabase.from('invoices').delete().in('id', ids);

  if (error) {
    alert('❌ Delete failed: ' + error.message);
    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }

  selectedInvoices.clear();
  alert(`✅ ${count} invoice${count > 1 ? 's' : ''} delete ho gayi${count > 1 ? 'n' : ''}!`);

  await loadInvoices($('invSearch')?.value || '');
  await loadOverview();
}

function downloadInvoicesCSV() {
  if (!allInvoicesCache.length) {
    return alert('❌ Koi invoice nahi hai download karne ke liye');
  }

  const search = $('invSearch')?.value || '';
  const filtered = allInvoicesCache.filter((i) => {
    if (!search) return true;
    const f = search.toLowerCase();
    return (
      (i.invoice_number || '').toLowerCase().includes(f) ||
      (i.customer_name || '').toLowerCase().includes(f) ||
      (i.created_by_name || '').toLowerCase().includes(f)
    );
  });

  if (!filtered.length) return alert('❌ Filter me koi invoice nahi hai');

  const headers = ['Invoice #', 'Date', 'Customer', 'Phone', 'Address', 'GSTIN', 'Subtotal', 'Tax', 'Discount', 'Grand Total', 'Payment Mode', 'Notes', 'Created By'];
  const rows = filtered.map((i) => [
    i.invoice_number || '',
    formatDate(i.created_at),
    i.customer_name || '',
    i.customer_phone || '',
    i.customer_address || '',
    i.customer_gstin || '',
    Number(i.subtotal || 0).toFixed(2),
    Number(i.tax_total || 0).toFixed(2),
    Number(i.discount || 0).toFixed(2),
    Number(i.grand_total || 0).toFixed(2),
    i.payment_mode || 'Cash',
    i.notes || '',
    i.created_by_name || ''
  ]);

  const totalAmount = filtered.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  rows.push([]);
  rows.push(['', '', '', '', '', '', '', '', '', totalAmount.toFixed(2), 'TOTAL', '', '']);

  const csv = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const fromDate = $('invFromDate')?.value || '';
  const toDate = $('invToDate')?.value || '';
  const dateRange = fromDate && toDate ? `${fromDate}_to_${toDate}` : new Date().toISOString().slice(0, 10);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoices_${dateRange}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================
// TECHNICIAN INVOICES
// ============================================
async function loadTechnicianInvoices(filter = '') {
  const fromDate = $('techInvFromDate')?.value || '';
  const toDate = $('techInvToDate')?.value || '';
  const statusFilter = $('techInvStatusFilter')?.value || '';

  let query = supabase
    .from('technician_invoices')
    .select('*')
    .order('created_at', { ascending: false });

  if (fromDate) query = query.gte('created_at', fromDate);
  if (toDate) query = query.lte('created_at', toDate + 'T23:59:59');
  if (statusFilter) query = query.eq('payment_status', statusFilter);

  const { data, error } = await query;
  if (error) {
    console.error('Load tech invoices error:', error);
    return;
  }

  allTechInvCache = data || [];

  const list = allTechInvCache.filter((i) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      (i.invoice_number || '').toLowerCase().includes(f) ||
      (i.customer_name || '').toLowerCase().includes(f) ||
      (i.technician_name || '').toLowerCase().includes(f) ||
      (i.service_type || '').toLowerCase().includes(f)
    );
  });

  const totalEl = $('techInvTotalCount');
  if (totalEl) totalEl.textContent = `${list.length} invoice${list.length !== 1 ? 's' : ''}`;

  const tbody = $('techInvoicesTable').querySelector('tbody');

  if (!list.length) {
    tbody.innerHTML = `
      <tr><td colspan="9" class="muted" style="text-align:center;padding:20px">Koi technician invoice nahi mili.</td></tr>`;
    updateTechBulkDeleteButton();
    return;
  }

  tbody.innerHTML = list.map((i) => {
    const statusColor =
      i.payment_status === 'Paid' ? '#10b981' :
      i.payment_status === 'Partial' ? '#f59e0b' : '#ef4444';

    return `
      <tr data-tech-inv-id="${i.id}">
        <td style="text-align:center">
          <input type="checkbox" class="tech-inv-checkbox" data-id="${i.id}" style="width:auto;cursor:pointer" />
        </td>
        <td>${escapeHtml(i.invoice_number)}</td>
        <td>${escapeHtml(i.technician_name || '-')}</td>
        <td>${escapeHtml(i.customer_name)}</td>
        <td>${escapeHtml(i.service_type || '-')}</td>
        <td>${formatMoney(i.grand_total)}</td>
        <td><span style="color:${statusColor};font-weight:600;font-size:12px">${i.payment_status || 'Pending'}</span></td>
        <td>${formatDate(i.created_at)}</td>
        <td>
          <button class="btn" style="padding:6px 10px;min-height:auto;font-size:12px" 
            onclick="window.location.href='technician-invoice.html?id=${i.id}'">View</button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.tech-inv-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedTechInv.add(cb.dataset.id);
      else selectedTechInv.delete(cb.dataset.id);
      updateTechBulkDeleteButton();
    });
  });

  const selectAll = $('techInvSelectAll');
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    selectAll.onchange = () => {
      const cbs = tbody.querySelectorAll('.tech-inv-checkbox');
      cbs.forEach((cb) => {
        cb.checked = selectAll.checked;
        if (selectAll.checked) selectedTechInv.add(cb.dataset.id);
        else selectedTechInv.delete(cb.dataset.id);
      });
      updateTechBulkDeleteButton();
    };
  }

  updateTechBulkDeleteButton();
}

function updateTechBulkDeleteButton() {
  const btn = $('bulkDeleteTechInvBtn');
  const countEl = $('selectedTechInvCount');
  if (!btn) return;
  const count = selectedTechInv.size;
  if (countEl) countEl.textContent = count;
  btn.disabled = count === 0;
}

async function bulkDeleteTechInvoices() {
  if (selectedTechInv.size === 0) return;
  const count = selectedTechInv.size;

  if (!confirm(`🗑️ ${count} technician invoice${count > 1 ? 's' : ''} delete karni hain?\n\nYe action undo nahi ho sakta!`)) return;

  const btn = $('bulkDeleteTechInvBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Deleting...';

  const ids = Array.from(selectedTechInv);
  const { error } = await supabase.from('technician_invoices').delete().in('id', ids);

  if (error) {
    alert('❌ Delete failed: ' + error.message);
    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }

  selectedTechInv.clear();
  alert(`✅ ${count} invoice${count > 1 ? 's' : ''} delete ho gayi${count > 1 ? 'n' : ''}!`);

  await loadTechnicianInvoices($('techInvSearch')?.value || '');
  await loadOverview();
}

function downloadTechInvoicesCSV() {
  if (!allTechInvCache.length) return alert('❌ Koi invoice nahi hai download karne ke liye');

  const search = $('techInvSearch')?.value || '';
  const filtered = allTechInvCache.filter((i) => {
    if (!search) return true;
    const f = search.toLowerCase();
    return (
      (i.invoice_number || '').toLowerCase().includes(f) ||
      (i.customer_name || '').toLowerCase().includes(f) ||
      (i.technician_name || '').toLowerCase().includes(f) ||
      (i.service_type || '').toLowerCase().includes(f)
    );
  });

  if (!filtered.length) return alert('❌ Filter me koi invoice nahi hai');

  const headers = ['Invoice #', 'Date', 'Technician', 'Customer', 'Phone', 'Address', 'Service Type', 'Service Date', 'Parts Total', 'Labor Charge', 'Travel Expense', 'Other Expense', 'Discount', 'Grand Total', 'Payment Mode', 'Payment Status', 'Amount Received', 'Work Done', 'Problem Found', 'Parts Replaced', 'Parts Added', 'Notes'];

  const rows = filtered.map((i) => [
    i.invoice_number || '',
    formatDate(i.created_at),
    i.technician_name || '',
    i.customer_name || '',
    i.customer_phone || '',
    i.customer_address || '',
    i.service_type || '',
    i.service_date || '',
    Number(i.parts_total || 0).toFixed(2),
    Number(i.labor_charge || 0).toFixed(2),
    Number(i.travel_expense || 0).toFixed(2),
    Number(i.other_expense || 0).toFixed(2),
    Number(i.discount || 0).toFixed(2),
    Number(i.grand_total || 0).toFixed(2),
    i.payment_mode || '',
    i.payment_status || 'Pending',
    Number(i.amount_received || 0).toFixed(2),
    i.work_done || '',
    i.problem_found || '',
    i.parts_replaced || '',
    i.parts_added || '',
    i.notes || ''
  ]);

  const totalAmount = filtered.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  rows.push([]);
  rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', totalAmount.toFixed(2), '', 'TOTAL']);

  const csv = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `technician-invoices_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================
// WORKERS
// ============================================
async function loadWorkers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('role', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Load workers error:', error);
    return;
  }

  const users = data || [];
  const tbody = $('workersTable').querySelector('tbody');

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">Koi users nahi hain.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((u) => {
    const isMe = u.id === me.id;
    const isPending = !u.is_active;

    let roleCell;
    if (isMe) {
      roleCell = `<span style="color:#f59e0b;font-weight:700">👑 Admin (You)</span>`;
    } else if (isPending) {
      roleCell = `<span style="color:#f59e0b;font-weight:600;font-size:12px">⏳ Pending</span>`;
    } else {
      roleCell = `
        <select class="role-select" data-id="${u.id}" 
          style="padding:6px 10px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--text);font-size:13px">
          <option value="worker" ${u.role === 'worker' ? 'selected' : ''}>👤 Worker</option>
          <option value="technician" ${u.role === 'technician' ? 'selected' : ''}>🔧 Technician</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>👑 Admin</option>
        </select>`;
    }

    const rowStyle = isPending ? 'style="background:rgba(245,158,11,0.08);opacity:0.85"' : '';

    return `
      <tr data-user-id="${u.id}" ${rowStyle}>
        <td>
          <strong>${escapeHtml(u.full_name || 'Unknown')}</strong>
          ${isMe ? '<span style="color:#6366f1;font-size:11px;margin-left:4px">(You)</span>' : ''}
        </td>
        <td>${escapeHtml(u.email)}</td>
        <td>${roleCell}</td>
        <td>
          <div class="toggle ${u.can_view_sales ? 'on' : ''}" 
               data-perm="can_view_sales" data-id="${u.id}"
               ${isPending ? 'style="pointer-events:none;opacity:0.5"' : ''}></div>
        </td>
        <td>
          <div class="toggle ${u.can_create_invoice ? 'on' : ''}" 
               data-perm="can_create_invoice" data-id="${u.id}"
               ${isPending ? 'style="pointer-events:none;opacity:0.5"' : ''}></div>
        </td>
        <td>
          ${isPending
            ? `<button class="btn" data-approve="${u.id}" 
                 style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:6px 12px;min-height:auto;font-size:12px">
                 ✅ Approve
               </button>`
            : `<div class="toggle ${u.is_active ? 'on' : ''}" 
                 data-perm="is_active" data-id="${u.id}"></div>`
          }
        </td>
        <td>
          ${!isMe
            ? `<button class="btn danger" style="padding:6px 10px;min-height:auto;font-size:12px" data-del-user="${u.id}">🗑 Delete</button>`
            : ''
          }
        </td>
      </tr>`;
  }).join('');

  // Toggles
  tbody.querySelectorAll('.toggle').forEach((t) => {
    t.addEventListener('click', async () => {
      const id = t.dataset.id;
      const perm = t.dataset.perm;
      const newVal = !t.classList.contains('on');

      const { error } = await supabase.from('profiles').update({ [perm]: newVal }).eq('id', id);
      if (error) return alert('❌ ' + error.message);
      t.classList.toggle('on', newVal);
    });
  });

  // Role change
  tbody.querySelectorAll('.role-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      const newRole = e.target.value;
      const row = tbody.querySelector(`tr[data-user-id="${id}"]`);
      const userName = row.querySelector('strong').textContent;

      if (!confirm(`"${userName}" ka role "${newRole}" kar dein?`)) {
        e.target.value = newRole === 'admin' ? 'worker' : 'admin';
        return;
      }

      if (newRole === 'worker' || newRole === 'technician') {
        const { count } = await supabase
          .from('profiles').select('id', { count: 'exact', head: true })
          .eq('role', 'admin').eq('is_active', true);

        if (count <= 1) {
          alert('⚠️ Kam se kam ek admin hona chahiye!');
          e.target.value = 'admin';
          return;
        }
      }

      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id);
      if (error) {
        alert('❌ ' + error.message);
        e.target.value = newRole === 'admin' ? 'worker' : 'admin';
        return;
      }

      alert(`✅ Role "${newRole}" set ho gaya!`);
      await loadWorkers();
    });
  });

  // Approve
  tbody.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.approve;
      const row = tbody.querySelector(`tr[data-user-id="${id}"]`);
      const userName = row.querySelector('strong').textContent;

      if (!confirm(`"${userName}" ko approve karein?`)) return;
      btn.disabled = true;
      btn.textContent = '⏳...';

      const { error } = await supabase.from('profiles').update({ is_active: true }).eq('id', id);
      if (error) {
        alert('❌ ' + error.message);
        btn.disabled = false;
        btn.textContent = '✅ Approve';
        return;
      }

      alert(`✅ "${userName}" approve ho gaya!`);
      await loadWorkers();
      await loadPending();
      await loadOverview();
    });
  });

  // Delete
  tbody.querySelectorAll('[data-del-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delUser;
      const row = tbody.querySelector(`tr[data-user-id="${id}"]`);
      const userName = row.querySelector('strong').textContent;

      if (!confirm(`"${userName}" ko delete karein?`)) return;
      btn.disabled = true;
      btn.textContent = '⏳...';

      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) {
        alert('❌ ' + error.message);
        btn.disabled = false;
        btn.textContent = '🗑 Delete';
        return;
      }

      alert(`✅ "${userName}" delete ho gaya.`);
      await loadWorkers();
      await loadPending();
      await loadOverview();
    });
  });
}

// ============================================
// CREATE USER LOGIC
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  const createForm = $('createUserForm');
  
  createForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('cuSubmitBtn');
    const msg = $('cuMsg');
    const originalText = btn.textContent;
    
    btn.disabled = true;
    btn.textContent = '⏳ Creating...';
    msg.innerHTML = '';

    const email = $('cuEmail').value.trim();
    const password = $('cuPassword').value;
    const fullName = $('cuName').value.trim();
    const role = $('cuRole').value;

    try {
      // 1) Create user in Supabase Auth (Using standard SignUp)
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { full_name: fullName, role: role }
        }
      });

      if (authError) throw authError;

      // ⚠️ IMPORTANT: SignUp automatically logs in the new user on the client!
      // Hum admin ko logout nahi honay dena chahte. Toh hum session ko restore karenge.
      // Supabase client-side signUp karte waqt session overwrite karta hai.
      
      // Note: Ye client-side limitation hai. Admin ko logout hone se bachane ke liye
      // hum ek second baad admin ka session wapas restore karenge (agar error aaya toh).
      
      // 2) Force profile active (kyunki pehle trigger 'false' set karta tha)
      // Ek choti si delay ke baad profile update karein
      setTimeout(async () => {
        // Trigger ko profile banane ka time dein
        const { data: newProfiles } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .single();

        if (newProfiles) {
          await supabase.from('profiles')
            .update({ is_active: true, role: role })
            .eq('id', newProfiles.id);
        }
        
        showMsg(msg, `✅ Account created successfully for ${fullName}!`, 'success');
        createForm.reset();
        btn.disabled = false;
        btn.textContent = originalText;
        
        // Logout the newly created session and restore admin
        // (Supabase JS client me signUp karte waqt session override ho jata hai)
        await supabase.auth.signInWithPassword({ 
          email: 'shahzad@gmail.com', // 👈 APNA ADMIN EMAIL YAHAN DALEIN
          password: 'YOUR_ADMIN_PASSWORD' // 👈 APNA ADMIN PASSWORD YAHAN DALEIN
        });
        
        setTimeout(() => location.reload(), 1000);

      }, 1500);

    } catch (err) {
      msg.innerHTML = `<div style="color:#ef4444; font-size:13px; padding:10px; background:rgba(239,68,68,0.1); border-radius:8px;">❌ ${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
});

// ============================================
// SETTINGS
// ============================================
async function loadShopSettings() {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', me.id)
      .single();

    if (profile) me = profile;

    $('shopName').value = me.shop_name || 'H.S Computers & CCTV';
    $('shopPhone').value = me.shop_phone || '';
    $('shopEmail').value = me.shop_email || '';
    $('shopGstin').value = me.shop_gstin || '';
    $('shopAddress').value = me.shop_address || '';
    $('whatsappNumber').value = me.whatsapp_number || '';
    $('whatsappApikey').value = me.whatsapp_apikey || '';

    if (me.shop_logo_url) {
      showLogoPreview(me.shop_logo_url);
    }
  } catch (err) {
    console.error('loadShopSettings error:', err);
  }
}

function bindForms() {
  $('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const updates = {
      shop_name: $('shopName').value.trim() || 'H.S Computers & CCTV',
      shop_phone: $('shopPhone').value.trim(),
      shop_email: $('shopEmail').value.trim(),
      shop_gstin: $('shopGstin').value.trim(),
      shop_address: $('shopAddress').value.trim(),
      whatsapp_number: $('whatsappNumber').value.trim(),
      whatsapp_apikey: $('whatsappApikey').value.trim()
    };

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', me.id)
      .select()
      .single();

    if (error) return alert('❌ ' + error.message);

    me = { ...me, ...updates };
    alert('✅ Settings saved!');
  });
}

// ============================================
// LOGO UPLOAD
// ============================================
function showLogoPreview(url) {
  const preview = $('logoPreview');
  const removeBtn = $('logoRemoveBtn');
  if (!preview) return;

  preview.innerHTML = `<img src="${url}" alt="Shop Logo" />`;
  preview.classList.add('has-logo');
  if (removeBtn) removeBtn.style.display = 'inline-flex';
}

function clearLogoPreview() {
  const preview = $('logoPreview');
  const removeBtn = $('logoRemoveBtn');
  if (!preview) return;

  preview.innerHTML = `<span class="logo-placeholder">📷</span>`;
  preview.classList.remove('has-logo');
  if (removeBtn) removeBtn.style.display = 'none';
}

async function uploadLogo(file) {
  if (!file) return;

  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) return alert('❌ Sirf PNG, JPG ya WEBP file allowed hai');
  if (file.size > 2 * 1024 * 1024) return alert('❌ File size 2 MB se kam hona chahiye');

  const preview = $('logoPreview');
  preview?.classList.add('uploading');

  try {
    const ext = file.name.split('.').pop().toLowerCase();
    const fileName = `${me.id}/logo-${Date.now()}.${ext}`;

    if (me.shop_logo_url) {
      try {
        const oldPath = me.shop_logo_url.split('/shop-assets/')[1];
        if (oldPath) await supabase.storage.from('shop-assets').remove([oldPath]);
      } catch (e) {
        console.warn('Old logo delete failed:', e);
      }
    }

    const { error } = await supabase.storage
      .from('shop-assets')
      .upload(fileName, file, { cacheControl: '3600', upsert: true });

    if (error) throw error;

    const { data: urlData } = supabase.storage.from('shop-assets').getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    const { error: dbError } = await supabase
      .from('profiles')
      .update({ shop_logo_url: publicUrl })
      .eq('id', me.id);

    if (dbError) throw dbError;

    me.shop_logo_url = publicUrl;
    showLogoPreview(publicUrl);
    alert('✅ Logo upload ho gaya!');
  } catch (err) {
    console.error('Logo upload error:', err);
    alert('❌ Upload failed: ' + err.message);
  } finally {
    preview?.classList.remove('uploading');
  }
}

async function removeLogo() {
  if (!confirm('Logo remove karna hai?')) return;

  try {
    if (me.shop_logo_url) {
      const oldPath = me.shop_logo_url.split('/shop-assets/')[1];
      if (oldPath) await supabase.storage.from('shop-assets').remove([oldPath]);
    }

    await supabase.from('profiles').update({ shop_logo_url: '' }).eq('id', me.id);
    me.shop_logo_url = '';
    clearLogoPreview();
    alert('✅ Logo removed');
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function setupLogoUpload() {
  const uploadBtn = $('logoUploadBtn');
  const input = $('logoInput');
  const removeBtn = $('logoRemoveBtn');

  uploadBtn?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadLogo(file);
    e.target.value = '';
  });
  removeBtn?.addEventListener('click', removeLogo);
}

// ============================================
// NOTIFICATIONS
// ============================================
async function loadNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', me.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Load notifications error:', error);
    return;
  }

  notificationsCache = data || [];
  unreadCount = notificationsCache.filter((n) => !n.is_read).length;
  updateBellBadge();
  renderNotifications();
}

function updateBellBadge() {
  const badge = $('notifBadge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderNotifications() {
  const list = $('notifList');
  if (!list) return;

  if (!notificationsCache.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px">
        <div style="font-size:32px;margin-bottom:8px;opacity:0.4">🔔</div>
        Koi notification nahi
      </div>`;
    return;
  }

  list.innerHTML = notificationsCache.map((n) => {
    const icon =
      n.type === 'invoice' ? '🧾' :
      n.type === 'success' ? '✅' :
      n.type === 'warning' ? '⚠️' : '🔔';

    const bg = n.is_read ? 'transparent' : 'rgba(99,102,241,0.12)';

    return `
      <div class="notif-item" data-notif-id="${n.id}" data-ref-id="${n.reference_id || ''}" data-ref-type="${n.reference_type || ''}"
        style="padding:12px 14px;border-radius:10px;margin-bottom:2px;cursor:pointer;background:${bg};display:flex;gap:10px;align-items:flex-start">
        <div style="font-size:20px;line-height:1;flex-shrink:0;margin-top:2px">${icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">${escapeHtml(n.title)}</div>
          <div style="font-size:12px;color:var(--text-muted);line-height:1.4;word-break:break-word">${escapeHtml(n.message || '')}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;opacity:0.7">${timeAgo(n.created_at)}</div>
        </div>
        ${!n.is_read ? `<div style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;margin-top:6px"></div>` : ''}
      </div>`;
  }).join('');

  list.querySelectorAll('.notif-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const id = item.dataset.notifId;
      const refId = item.dataset.refId;
      const refType = item.dataset.refType;

      await markNotificationRead(id);

      if (refType === 'invoice' && refId) {
        window.location.href = `invoice.html?id=${refId}`;
      } else if (refType === 'technician_invoice' && refId) {
        window.location.href = `technician-invoice.html?id=${refId}`;
      }
    });
  });
}

async function markNotificationRead(id) {
  const notif = notificationsCache.find((n) => n.id === id);
  if (!notif || notif.is_read) return;

  notif.is_read = true;
  unreadCount = Math.max(0, unreadCount - 1);
  updateBellBadge();

  await supabase.from('notifications').update({ is_read: true }).eq('id', id);
}

async function markAllNotificationsRead() {
  if (unreadCount === 0) return;
  const unreadIds = notificationsCache.filter((n) => !n.is_read).map((n) => n.id);
  const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
  if (error) return alert('❌ ' + error.message);

  notificationsCache.forEach((n) => { n.is_read = true; });
  unreadCount = 0;
  updateBellBadge();
  renderNotifications();
}

function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diff = Math.floor((now - then) / 1000);

  if (diff < 10) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(dateStr);
}

function setupNotificationBell() {
  const bell = $('notifBell');
  const dropdown = $('notifDropdown');
  const markAllBtn = $('markAllReadBtn');

  if (!bell || !dropdown) return;

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== bell) {
      dropdown.style.display = 'none';
    }
  });

  markAllBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    markAllNotificationsRead();
  });
}

function setupRealtimeNotifications() {
  try {
    supabase
      .channel('notifications-channel')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${me.id}`
      }, (payload) => {
        notificationsCache.unshift(payload.new);
        unreadCount += 1;
        updateBellBadge();
        renderNotifications();
        playNotificationSound();
      })
      .subscribe();
  } catch (err) {
    console.warn('Realtime not available:', err);
  }
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}