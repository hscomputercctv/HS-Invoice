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
  const { data } = await supabase
    .from('invoices').select('*')
    .eq('created_by', me.id)
    .order('created_at', { ascending: false });

  const list = data || [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayCount = list.filter((i) => new Date(i.created_at) >= today).length;

  $('wToday').textContent = todayCount;
  $('wTotal').textContent = list.length;
  if (me.can_view_sales) {
    $('wSales').textContent = formatMoney(list.reduce((s, i) => s + Number(i.grand_total || 0), 0));
  }

  const tbody = $('invoicesTable').querySelector('tbody');
  tbody.innerHTML = list.map((i) => `
    <tr>
      <td>${escapeHtml(i.invoice_number)}</td>
      <td>${escapeHtml(i.customer_name)}</td>
      <td>${formatMoney(i.grand_total)}</td>
      <td>${formatDate(i.created_at)}</td>
      <td><button class="btn" onclick="window.location.href='invoice.html?id=${i.id}'">View</button></td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted">No invoices yet</td></tr>`;
}

async function loadProducts() {
  const { data } = await supabase.from('products').select('*').eq('is_active', true);
  const tbody = $('productsTable').querySelector('tbody');
  tbody.innerHTML = (data || []).map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${formatMoney(p.price)}</td>
      <td>${p.tax_percent}%</td>
      <td>${p.stock}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;
}