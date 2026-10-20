import { supabase } from './supabase-config.js';
import { formatMoney, formatDate, requireAuth, escapeHtml } from './utils.js';

const $ = (id) => document.getElementById(id);
let me = null;
let allInvoices = [];

// ============================================
// INIT
// ============================================
(async () => {
  const ctx = await requireAuth(supabase, 'technician');
  if (!ctx) return;
  me = ctx.profile;

  $('userName').textContent = me.full_name;

  $('logoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('view-' + b.dataset.view).classList.add('active');
    });
  });

  $('newTechInvoiceBtn').addEventListener('click', () => {
    window.location.href = 'technician-invoice.html';
  });

  $('techInvSearch')?.addEventListener('input', renderInvoicesTable);
  $('techInvFilter')?.addEventListener('change', renderInvoicesTable);

  await loadMyInvoices();
})();

// ============================================
// LOAD MY INVOICES
// ============================================
async function loadMyInvoices() {
  const { data, error } = await supabase
    .from('technician_invoices')
    .select('*')
    .eq('technician_id', me.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Load invoices error:', error);
    return;
  }

  allInvoices = data || [];

  // Stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const todayCount = allInvoices.filter((i) => new Date(i.created_at) >= today).length;
  const totalAmount = allInvoices.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const paidAmount = allInvoices
    .filter((i) => i.payment_status === 'Paid')
    .reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const pendingAmount = allInvoices
    .filter((i) => i.payment_status !== 'Paid')
    .reduce((s, i) => s + (Number(i.grand_total || 0) - Number(i.amount_received || 0)), 0);
  const monthAmount = allInvoices
    .filter((i) => new Date(i.created_at) >= monthStart)
    .reduce((s, i) => s + Number(i.grand_total || 0), 0);

  $('tToday').textContent = todayCount;
  $('tTotal').textContent = allInvoices.length;
  $('tTotalAmount').textContent = formatMoney(totalAmount);
  $('tPaid').textContent = formatMoney(paidAmount);
  $('tPending').textContent = formatMoney(pendingAmount);
  $('tMonth').textContent = formatMoney(monthAmount);

  renderInvoicesTable();
}

// ============================================
// RENDER TABLE
// ============================================
function renderInvoicesTable() {
  const search = $('techInvSearch')?.value.toLowerCase() || '';
  const statusFilter = $('techInvFilter')?.value || '';

  const filtered = allInvoices.filter((i) => {
    if (search) {
      const match =
        (i.invoice_number || '').toLowerCase().includes(search) ||
        (i.customer_name || '').toLowerCase().includes(search) ||
        (i.service_type || '').toLowerCase().includes(search);
      if (!match) return false;
    }
    if (statusFilter && i.payment_status !== statusFilter) return false;
    return true;
  });

  const tbody = $('techInvoicesTable').querySelector('tbody');

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">
        Koi invoice nahi. "+ New Technician Invoice" dabao.
      </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((i) => {
    const statusColor =
      i.payment_status === 'Paid' ? '#10b981' :
      i.payment_status === 'Partial' ? '#f59e0b' : '#ef4444';

    return `
      <tr>
        <td>${escapeHtml(i.invoice_number)}</td>
        <td>${escapeHtml(i.customer_name)}</td>
        <td>${escapeHtml(i.service_type || '-')}</td>
        <td>${formatMoney(i.grand_total)}</td>
        <td>
          <select class="status-select" data-id="${i.id}" 
            style="padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;color:${statusColor};background:rgba(255,255,255,0.05);border:1px solid var(--border)">
            <option value="Pending" ${i.payment_status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
            <option value="Partial" ${i.payment_status === 'Partial' ? 'selected' : ''}>🔶 Partial</option>
            <option value="Paid" ${i.payment_status === 'Paid' ? 'selected' : ''}>✅ Paid</option>
          </select>
        </td>
        <td>${formatDate(i.created_at)}</td>
        <td>
          <button class="btn" style="padding:6px 12px;min-height:auto;font-size:12px;background:linear-gradient(135deg,#f59e0b,#dc2626);color:#fff;border:none"
            onclick="window.location.href='technician-invoice.html?id=${i.id}'">
            🖨 View
          </button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      const newStatus = e.target.value;

      const updateData = { payment_status: newStatus };
      if (newStatus === 'Paid') {
        const inv = allInvoices.find((x) => x.id === id);
        if (inv) updateData.amount_received = inv.grand_total;
      }

      const { error } = await supabase
        .from('technician_invoices')
        .update(updateData)
        .eq('id', id);

      if (error) {
        alert('❌ ' + error.message);
        return;
      }

      alert(`✅ Status "${newStatus}" set ho gaya!`);
      await loadMyInvoices();
    });
  });
}