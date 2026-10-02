import { supabase } from './supabase-config.js';
import { formatMoney, formatDate, requireAuth, escapeHtml } from './utils.js';

const $ = (id) => document.getElementById(id);
let me = null;

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

  // Tabs
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('view-' + b.dataset.view).classList.add('active');
    });
  });

  // New Invoice button
  $('newTechInvoiceBtn').addEventListener('click', () => {
    window.location.href = 'technician-invoice.html';
  });

  await loadMyInvoices();
})();

// ============================================
// LOAD MY INVOICES (sirf apni)
// ============================================
async function loadMyInvoices() {
  const { data, error } = await supabase
    .from('technician_invoices')
    .select('*')
    .eq('technician_id', me.id)         // 👈 SIRF APNI
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Load invoices error:', error);
    return;
  }

  const all = data || [];

  // Stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayCount = all.filter((i) => new Date(i.created_at) >= today).length;
  const totalAmount = all.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const pendingAmount = all
    .filter((i) => i.payment_status === 'Pending' || i.payment_status === 'Partial')
    .reduce((s, i) => s + (Number(i.grand_total || 0) - Number(i.amount_received || 0)), 0);

  $('tToday').textContent = todayCount;
  $('tTotal').textContent = all.length;
  $('tTotalAmount').textContent = formatMoney(totalAmount);
  $('tPending').textContent = formatMoney(pendingAmount);

  // Table
  const tbody = $('techInvoicesTable').querySelector('tbody');

  if (!all.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">
          Koi invoice nahi. "+ New Technician Invoice" dabao.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = all.map((i) => {
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
          <span style="color:${statusColor};font-weight:600;font-size:12px">
            ${i.payment_status || 'Pending'}
          </span>
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
}