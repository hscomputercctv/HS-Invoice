import { supabase } from './supabase-config.js';
import { 
  formatMoney, 
  formatDate, 
  requireAuth, 
  escapeHtml 
} from './utils.js';

const $ = (id) => document.getElementById(id);
let me = null;

// ============================================
// INIT
// ============================================
(async () => {
  const ctx = await requireAuth(supabase, 'worker');
  if (!ctx) return;
  me = ctx.profile;

  // ─── Greeting ───
  $('userName').textContent = me.full_name;

  // ─── Logout ───
  $('logoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  // ─── Permission-based UI ───
  if (me.can_view_sales) {
    $('salesCard').classList.remove('hidden');
  }
  if (me.can_manage_products) {
    $('navProducts').classList.remove('hidden');
  }

  // ─── Tabs ───
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('view-' + b.dataset.view).classList.add('active');
    });
  });

  // ─── New Invoice Button ───
  $('newInvoiceBtn').addEventListener('click', () => {
    if (!me.can_create_invoice) {
      return alert('⚠️ Aapko invoice banane ki permission nahi hai. Admin se contact karein.');
    }
    window.location.href = 'invoice.html';
  });

  // ─── Load Data ───
  await loadInvoices();

  if (me.can_manage_products) {
    await loadProducts();
  }
})();

// ============================================
// LOAD INVOICES — FIX 4 APPLIED
// ============================================
async function loadInvoices() {
  // Sab invoices fetch karo — RLS policy "select_all" ki wajah se
  // Worker apni + admin ki + doosre workers ki sab dekh sakta hai
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
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="muted" style="text-align:center;padding:20px">
          Koi invoice nahi hai. "+ Create New Invoice" dabao.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = allInvoices.map((i) => {
    const isMine = i.created_by === me.id;
    const badge = isMine
      ? `<span style="color:#10b981;font-size:10px;font-weight:700;margin-left:4px">👤 YOU</span>`
      : `<span style="color:#6366f1;font-size:10px;font-weight:700;margin-left:4px">👑 ADMIN</span>`;

    return `
      <tr>
        <td>${escapeHtml(i.invoice_number)}</td>
        <td>${escapeHtml(i.customer_name)}</td>
        <td>${formatMoney(i.grand_total)}</td>
        <td>${escapeHtml(i.created_by_name || '-')}${badge}</td>
        <td>${formatDate(i.created_at)}</td>
        <td>
          <button class="btn" 
            style="padding:6px 12px;min-height:auto;font-size:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none"
            onclick="window.location.href='invoice.html?id=${i.id}'">
            🖨 View
          </button>
        </td>
      </tr>`;
  }).join('');
}

// ============================================
// LOAD PRODUCTS — FIX 4 (only active)
// ============================================
async function loadProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)            // 👈 Sirf active products
    .order('name', { ascending: true });

  if (error) {
    console.error('Load products error:', error);
    return;
  }

  const tbody = $('productsTable').querySelector('tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="muted" style="text-align:center;padding:20px">
          Koi products nahi hain. Admin se contact karein.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = data.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${formatMoney(p.price)}</td>
      <td>${p.tax_percent}%</td>
      <td>${p.stock}</td>
    </tr>
  `).join('');
}