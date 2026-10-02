import { supabase } from './supabase-config.js';
import { formatMoney, formatDate, requireAuth, escapeHtml } from './utils.js';

const $ = (id) => document.getElementById(id);
let me = null;

(async () => {
  const ctx = await requireAuth(supabase, 'worker');
  if (!ctx || !ctx.profile) return;;
  me = ctx.profile;

  $('userName').textContent = me.full_name;
  $('logoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  // Permissions
  if (me.can_view_sales) $('salesCard').classList.remove('hidden');
  if (me.can_manage_products) $('navProducts').classList.remove('hidden');

  // Tabs
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('view-' + b.dataset.view).classList.add('active');
    });
  });

  $('newInvoiceBtn').addEventListener('click', () => {
    if (!me.can_create_invoice) return alert('You do not have permission to create invoices.');
    window.location.href = 'invoice.html';
  });

  await loadMyInvoices();

  if (me.can_manage_products) await loadProducts();
})();

async function loadMyInvoices() {
  // Saare invoices fetch karo (apni + admin ki + doosre workers ki)
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Load invoices error:', error);
    return;
  }

  const allInvoices = data || [];

  // ─── Stats ───
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const myInvoices = allInvoices.filter((i) => i.created_by === me.id);
  const myTodayInvoices = myInvoices.filter((i) => new Date(i.created_at) >= today);

  $('wToday').textContent = myTodayInvoices.length;
  $('wTotal').textContent = myInvoices.length;

  if (me.can_view_sales) {
    $('wSales').textContent = formatMoney(
      myInvoices.reduce((s, i) => s + Number(i.grand_total || 0), 0)
    );
  }

  // ─── Table Render ───
  const tbody = $('invoicesTable').querySelector('tbody');

  if (!allInvoices.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Koi invoice nahi hai. "+ Create New Invoice" dabao.</td></tr>`;
    return;
  }

  tbody.innerHTML = allInvoices.map((i) => {
    const isMine = i.created_by === me.id;
    const badge = isMine
      ? `<span style="color:#10b981;font-size:11px;font-weight:700">👤 MY</span>`
      : `<span style="color:#6366f1;font-size:11px;font-weight:700">👑 ADMIN</span>`;

    return `
    <tr>
      <td>${escapeHtml(i.invoice_number)}</td>
      <td>${escapeHtml(i.customer_name)}</td>
      <td>${formatMoney(i.grand_total)}</td>
      <td>${escapeHtml(i.created_by_name || '-')} ${badge}</td>
      <td>${formatDate(i.created_at)}</td>
      <td>
        <button class="btn" style="padding:6px 12px;min-height:auto;font-size:12px" onclick="window.location.href='invoice.html?id=${i.id}'">
          🖨 View
        </button>
      </td>
    </tr>`;
  }).join('');
}