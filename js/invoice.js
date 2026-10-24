import { supabase } from './supabase-config.js';
import {
  formatMoney,
  formatDate,
  requireAuth,
  escapeHtml,
  generateInvoiceNumber
} from './utils.js';

const $ = (id) => document.getElementById(id);
let me = null;
let items = [];
let existingId = null;
let isOwner = false;
let isAdminUser = false;

// ============================================
// INIT
// ============================================
(async () => {
  const ctx = await requireAuth(supabase);
  if (!ctx) return;
  me = ctx.profile;

  if (!['admin', 'worker'].includes(me.role)) {
    alert('⚠️ Aapko is page ka access nahi hai.');
    window.location.href = 'index.html';
    return;
  }

  isAdminUser = me.role === 'admin';

  // Shop header fill karo
  $('shopNameDisplay').textContent = me.shop_name || 'H.S Computers & CCTV';
  $('shopAddrDisplay').textContent = me.shop_address || '';
  $('shopPhoneDisplay').textContent = me.shop_phone ? '📞 ' + me.shop_phone : '';
  $('shopEmailDisplay').textContent = me.shop_email ? '✉️ ' + me.shop_email : '';

  // Logo
  if (me.shop_logo_url) {
    const logoEl = $('shopLogo');
    if (logoEl) {
      logoEl.src = me.shop_logo_url;
      logoEl.classList.remove('hidden');
      logoEl.onerror = () => logoEl.classList.add('hidden');
    }
  }

  // URL check
  const params = new URLSearchParams(location.search);
  existingId = params.get('id');

  if (existingId) {
    await loadExisting(existingId);
  } else {
    $('invNo').textContent = generateInvoiceNumber();
    $('invDate').textContent = formatDate();
    $('invBy').textContent = me.full_name;
    addItem();
  }

  bindEvents();
  syncPrintFields();
})();

// ============================================
// EVENT BINDINGS
// ============================================
function bindEvents() {
  $('addItemBtn')?.addEventListener('click', () => addItem());

  ['discount', 'amountReceived'].forEach((id) => {
    $(id)?.addEventListener('input', recalc);
  });

  $('paymentStatus')?.addEventListener('change', (e) => {
    // Sirf tab amount auto-fill karo jab user khud 'Paid' select kare
    if (e.target.value === 'Paid') {
      const grand = parseFloat($('grandTotal').textContent.replace(/[^0-9.-]+/g, "")) || 0;
      $('amountReceived').value = grand.toFixed(2);
    } else if (e.target.value === 'Pending') {
      $('amountReceived').value = 0;
    }
    // Partial me user khud amount likhega
    recalc();
  });

  ['custName', 'paymentMode', 'paymentStatus'].forEach((id) => {
    $(id)?.addEventListener('input', syncPrintFields);
    $(id)?.addEventListener('change', syncPrintFields);
  });

  $('saveBtn')?.addEventListener('click', saveInvoice);

  $('printBtn')?.addEventListener('click', () => {
    syncPrintFields();
    setTimeout(() => window.print(), 100);
  });
}

// ============================================
// ITEMS MANAGEMENT
// ============================================
function addItem(data = { name: '', qty: 1, price: 0, tax: 0 }) {
  items.push({ ...data });
  renderItems();
}

function renderItems() {
  const body = $('itemsBody');
  if (!body) return;

  body.innerHTML = items.map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><input data-idx="${idx}" data-k="name" value="${escapeHtml(it.name)}" placeholder="Item name" /></td>
      <td><input data-idx="${idx}" data-k="qty" type="number" min="0" step="0.01" value="${it.qty}" /></td>
      <td><input data-idx="${idx}" data-k="price" type="number" min="0" step="0.01" value="${it.price}" /></td>
      <td><input data-idx="${idx}" data-k="tax" type="number" min="0" step="0.01" value="${it.tax}" /></td>
      <td class="line-total">${formatMoney(lineTotal(it))}</td>
      <td class="no-print"><button class="btn danger" data-rm="${idx}" style="padding:6px 10px;min-height:auto">×</button></td>
    </tr>
  `).join('');

  body.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.idx;
      const k = e.target.dataset.k;
      items[i][k] = k === 'name' ? e.target.value : (parseFloat(e.target.value) || 0);
      recalc();
    });
  });

  body.querySelectorAll('[data-rm]').forEach((b) => {
    b.addEventListener('click', () => {
      items.splice(+b.dataset.rm, 1);
      if (!items.length) items.push({ name: '', qty: 1, price: 0, tax: 0 });
      renderItems();
      recalc();
    });
  });

  recalc();
}

function lineTotal(it) {
  const base = (Number(it.qty) || 0) * (Number(it.price) || 0);
  const tax = base * (Number(it.tax) || 0) / 100;
  return base + tax;
}

// ============================================
// RECALCULATE TOTALS
// ============================================
function recalc() {
  const body = $('itemsBody');
  let subtotal = 0, taxTotal = 0, grand = 0;

  items.forEach((it, idx) => {
    const base = (Number(it.qty) || 0) * (Number(it.price) || 0);
    const tax = base * (Number(it.tax) || 0) / 100;
    subtotal += base;
    taxTotal += tax;
    grand += base + tax;
    const cell = body.querySelector(`tr:nth-child(${idx + 1}) .line-total`);
    if (cell) cell.textContent = formatMoney(base + tax);
  });

  const disc = parseFloat($('discount').value) || 0;
  const finalTotal = Math.max(0, grand - disc);

  $('subtotal').textContent = formatMoney(subtotal);
  $('taxTotal').textContent = formatMoney(taxTotal);
  $('grandTotal').textContent = formatMoney(finalTotal);

  const dP = $('discountP');
  if (dP) dP.textContent = formatMoney(disc);

  // 👇 Balance Calculation
  const received = parseFloat($('amountReceived')?.value) || 0;
  const balance = Math.max(0, finalTotal - received);

  const balEl = $('balanceDisplay');
  if (balEl) {
    balEl.textContent = formatMoney(balance);
    balEl.style.color = balance > 0 ? '#ef4444' : '#10b981';
    balEl.style.background = balance > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)';
  }

  syncPrintFields();
}

// ============================================
// SYNC PRINT FIELDS
// ============================================
function syncPrintFields() {
  const setText = (id, val) => {
    const el = $(id);
    if (el) el.textContent = val || '';
  };

  setText('custNameP', $('custName')?.value);
  setText('paymentModeP', $('paymentMode')?.value || '');
  setText('paymentStatusP', $('paymentStatus')?.value || '');

  const received = parseFloat($('amountReceived')?.value) || 0;
  setText('amountReceivedP', formatMoney(received));
}

// ============================================
// SAVE INVOICE
// ============================================
async function saveInvoice() {
  if (!isAdminUser && existingId && !isOwner) {
    return alert('⚠️ Aap sirf apni invoices edit kar sakte hain.');
  }

  const custName = $('custName')?.value.trim();
  if (!custName) {
    alert('⚠️ Customer name required');
    $('custName')?.focus();
    return;
  }

  const validItems = items.filter((i) => i.name.trim() && i.qty > 0);
  if (!validItems.length) return alert('⚠️ Add at least 1 item');

  const btn = $('saveBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';

  const subtotal = validItems.reduce((s, i) => s + i.qty * i.price, 0);
  const taxTotal = validItems.reduce((s, i) => s + (i.qty * i.price * i.tax / 100), 0);
  const disc = parseFloat($('discount').value) || 0;
  const grand = Math.max(0, subtotal + taxTotal - disc);

  const received = parseFloat($('amountReceived')?.value) || 0;

  // 👇 AB STATUS WAHI SAVE HOGA JO DROPDOWN ME SELECT HAI (Auto nahi badlega)
  const status = $('paymentStatus')?.value || 'Pending';
  const balance = Math.max(0, grand - received);

  const payload = {
    customer_name: custName,
    customer_phone: $('custPhone')?.value || '',
    subtotal, tax_total: taxTotal, discount: disc, grand_total: grand,
    payment_mode: $('paymentMode').value,
    payment_status: status,           // Fixed Status
    amount_received: received,
    balance: balance,
    notes: $('notes').value,
    created_by: me.id,
    created_by_name: me.full_name
  };

  let result;

  if (existingId) {
    result = await supabase.from('invoices').update(payload).eq('id', existingId).select().single();
  } else {
    payload.invoice_number = $('invNo').textContent;
    let inserted = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await supabase.from('invoices').insert(payload).select().single();
      if (!res.error) {
        result = res;
        inserted = true;
        break;
      }
      if (res.error.code === '23505') {
        payload.invoice_number = generateInvoiceNumber();
        continue;
      }
      result = res;
      break;
    }
    if (!inserted && result?.error) {
      btn.disabled = false;
      btn.textContent = originalText;
      return alert('❌ ' + result.error.message);
    }
  }

  if (result.error) {
    btn.disabled = false;
    btn.textContent = originalText;
    return alert('❌ ' + result.error.message);
  }

  const invoiceId = result.data.id;

  if (existingId) {
    await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId);
  }

  const itemRows = validItems.map((i) => ({
    invoice_id: invoiceId,
    product_name: i.name,
    qty: i.qty,
    price: i.price,
    tax_percent: i.tax,
    line_total: i.qty * i.price * (1 + i.tax / 100)
  }));

  const { error: e2 } = await supabase.from('invoice_items').insert(itemRows);
  if (e2) {
    btn.disabled = false;
    btn.textContent = originalText;
    return alert('❌ Items save failed: ' + e2.message);
  }

  btn.textContent = '✅ Saved!';

  setTimeout(() => {
    window.location.href = me.role === 'admin' ? 'admin.html' : 'worker.html';
  }, 800);
}

// ============================================
// LOAD EXISTING INVOICE
// ============================================
async function loadExisting(id) {
  const { data: inv } = await supabase.from('invoices').select('*').eq('id', id).single();
  if (!inv) return alert('Invoice not found');

  isOwner = inv.created_by === me.id;

  if (!isOwner && !isAdminUser) {
    alert('⚠️ Aap sirf apni invoices edit kar sakte hain.');
    window.location.href = 'worker.html';
    return;
  }

  $('invNo').textContent = inv.invoice_number;
  $('invDate').textContent = formatDate(inv.created_at);
  $('invBy').textContent = inv.created_by_name;
  $('custName').value = inv.customer_name || '';
  $('discount').value = inv.discount || 0;

  // Payment fields load karo
  $('paymentMode').value = inv.payment_mode || 'Cash';
  $('paymentStatus').value = inv.payment_status || 'Paid';
  $('amountReceived').value = inv.amount_received || inv.grand_total || 0;
  $('notes').value = inv.notes || '';

  const { data: rows } = await supabase.from('invoice_items').select('*').eq('invoice_id', id);
  items = (rows || []).map((r) => ({
    name: r.product_name, qty: r.qty, price: r.price, tax: r.tax_percent
  }));
  if (!items.length) items.push({ name: '', qty: 1, price: 0, tax: 0 });

  renderItems();

  const saveBtn = $('saveBtn');
  if (saveBtn) {
    saveBtn.classList.remove('hidden');
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Update Invoice';
    saveBtn.style.opacity = '1';
    saveBtn.style.cursor = 'pointer';
  }
}