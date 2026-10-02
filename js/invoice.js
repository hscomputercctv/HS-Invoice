import { supabase } from './supabase-config.js';
import {
  formatMoney, formatDate, requireAuth, escapeHtml,
  generateInvoiceNumber
} from './utils.js';

const $ = (id) => document.getElementById(id);
let me = null;
let items = [];
let existingId = null;

// ============================================
// INIT
// ============================================
(async () => {
  const ctx = await requireAuth(supabase);
  if (!ctx) return;
  me = ctx.profile;

  // Shop header fill karo
  // Logo show karo (agar hai)
  if (me.shop_logo_url) {
    const logoEl = $('shopLogo');
    if (logoEl) {
      logoEl.src = me.shop_logo_url;
      logoEl.classList.remove('hidden');
      logoEl.onerror = () => logoEl.classList.add('hidden'); // fail safe
    }
  }
  $('shopNameDisplay').textContent = me.shop_name || 'H.S Computers & CCTV';
  $('shopAddrDisplay').textContent = me.shop_address || '';
  $('shopPhoneDisplay').textContent = me.shop_phone ? '📞 ' + me.shop_phone : '';
  $('shopEmailDisplay').textContent = me.shop_email ? '✉️ ' + me.shop_email : '';

  const gstinEl = $('shopGstinDisplay');
  if (gstinEl) {
    gstinEl.textContent = me.shop_gstin ? 'GSTIN: ' + me.shop_gstin : '';
    gstinEl.style.display = me.shop_gstin ? 'block' : 'none';
  }

  const params = new URLSearchParams(location.search);
  existingId = params.get('id');

  if (existingId) {
    await loadExisting(existingId);

    // Check karo — ye invoice current user ki hai?
    const { data: inv } = await supabase
      .from('invoices')
      .select('created_by')
      .eq('id', existingId)
      .single();

    const isOwner = inv?.created_by === me.id;
    const isAdminUser = me.role === 'admin';

    // Sirf owner ya admin hi edit kar sakte hain
    if (!isOwner && !isAdminUser) {
      // Worker doosre ki invoice dekh raha hai — sirf print
      const saveBtn = $('saveBtn');
      if (saveBtn) {
        saveBtn.textContent = '👁 View Only';
        saveBtn.disabled = true;
        saveBtn.title = 'Ye invoice admin ki hai — sirf print kar sakte ho';
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
      }
    } else {
      // Owner ya admin — Save button hide karo (view mode)
      $('saveBtn').classList.add('hidden');
    }
  } else {
    $('invNo').textContent = generateInvoiceNumber();
    $('invDate').textContent = formatDate();
    $('invBy').textContent = me.full_name;
    addItem();
  }

  // Event bindings
  $('addItemBtn').addEventListener('click', () => addItem());
  $('discount').addEventListener('input', recalc);
  $('saveBtn').addEventListener('click', saveInvoice);

  $('printBtn').addEventListener('click', () => {
    syncPrintFields();               // 👈 print se pehle sync
    setTimeout(() => window.print(), 100);  // 👈 animation ke liye chhota delay
  });

  // Customer fields → print fields live sync
  ['custName', 'custPhone', 'custAddr', 'custGstin'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', syncPrintFields);
  });

  syncPrintFields();
})();

// ============================================
// PRINT-ONLY FIELDS SYNC
// ============================================
function syncPrintFields() {
  const setText = (id, val) => {
    const el = $(id);
    if (el) el.textContent = val || '';
  };

  setText('custNameP', $('custName')?.value);
  setText('custPhoneP', $('custPhone')?.value);
  setText('custAddrP', $('custAddr')?.value);
  setText('custGstinP', $('custGstin')?.value);

  // Empty field ko hide karo (print me clean dikhe)
  ['custPhoneP', 'custAddrP', 'custGstinP'].forEach((id) => {
    const el = $(id);
    if (el) el.style.display = el.textContent.trim() ? 'block' : 'none';
  });
}

// ============================================
// ITEMS
// ============================================
function addItem(data = { name: '', qty: 1, price: 0, tax: 0 }) {
  items.push({ ...data });
  renderItems();
}

function renderItems() {
  const body = $('itemsBody');
  body.innerHTML = items.map((it, idx) => `
    <tr style="animation: fadeInUp 0.3s ease ${idx * 0.05}s backwards">
      <td>${idx + 1}</td>
      <td><input data-idx="${idx}" data-k="name" value="${escapeHtml(it.name)}" placeholder="Item name" /></td>
      <td><input data-idx="${idx}" data-k="qty" type="number" min="0" step="0.01" value="${it.qty}" /></td>
      <td><input data-idx="${idx}" data-k="price" type="number" min="0" step="0.01" value="${it.price}" /></td>
      <td><input data-idx="${idx}" data-k="tax" type="number" min="0" step="0.01" value="${it.tax}" /></td>
      <td class="line-total">${formatMoney(lineTotal(it))}</td>
      <td class="no-print"><button class="btn danger" data-rm="${idx}" style="padding:6px 10px;min-height:auto">×</button></td>
    </tr>`).join('');

  body.querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.idx;
      const k = e.target.dataset.k;
      items[i][k] = k === 'name' ? e.target.value : (parseFloat(e.target.value) || 0);
      recalc();
    })
  );

  body.querySelectorAll('[data-rm]').forEach((b) =>
    b.addEventListener('click', () => {
      items.splice(+b.dataset.rm, 1);
      if (!items.length) items.push({ name: '', qty: 1, price: 0, tax: 0 });
      renderItems();
      recalc();
    })
  );

  recalc();
}

function lineTotal(it) {
  const base = (Number(it.qty) || 0) * (Number(it.price) || 0);
  const tax = base * (Number(it.tax) || 0) / 100;
  return base + tax;
}

// ============================================
// TOTALS CALC
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
}

// ============================================
// SAVE INVOICE — FIXED (UPDATE vs INSERT)
// ============================================
async function saveInvoice() {
  const custName = $('custName').value.trim();
  if (!custName) return alert('⚠️ Customer name required');

  const validItems = items.filter((i) => i.name.trim() && i.qty > 0);
  if (!validItems.length) return alert('⚠️ Add at least 1 item');

  const btn = $('saveBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';

  const subtotal = validItems.reduce((s, i) => s + i.qty * i.price, 0);
  const taxTotal = validItems.reduce((s, i) => s + (i.qty * i.price * i.tax / 100), 0);
  const disc = parseFloat($('discount').value) || 0;
  const grand = Math.max(0, subtotal + taxTotal - disc);

  const payload = {
    customer_name: custName,
    customer_phone: $('custPhone').value,
    customer_address: $('custAddr').value,
    customer_gstin: $('custGstin').value,
    subtotal,
    tax_total: taxTotal,
    discount: disc,
    grand_total: grand,
    payment_mode: $('paymentMode').value,
    notes: $('notes').value,
    created_by: me.id,
    created_by_name: me.full_name
  };

  let invoiceId;

  // ─────────────────────────────────────────
  // CASE A: EXISTING INVOICE → UPDATE
  // ─────────────────────────────────────────
  if (existingId) {
    const { error } = await supabase
      .from('invoices')
      .update(payload)
      .eq('id', existingId);

    if (error) {
      btn.disabled = false;
      btn.textContent = '💾 Save Invoice';
      return alert('❌ Update failed: ' + error.message);
    }
    invoiceId = existingId;

    // Purane items delete karo (naye items insert honge)
    await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId);
  }

  // ─────────────────────────────────────────
  // CASE B: NEW INVOICE → INSERT with unique number
  // ─────────────────────────────────────────
  else {
    // Try karo 5 baar — agar collision ho to naya number generate karo
    let inserted = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const newNumber = generateInvoiceNumber();
      payload.invoice_number = newNumber;

      const { data, error } = await supabase
        .from('invoices')
        .insert(payload)
        .select()
        .single();

      if (!error) {
        invoiceId = data.id;
        inserted = true;
        break;
      }

      // Agar duplicate error hai to retry karo
      if (error.code === '23505' || error.message.includes('duplicate')) {
        console.warn('Invoice number collision, retrying...', newNumber);
        continue;
      }

      // Koi aur error — fail kar do
      btn.disabled = false;
      btn.textContent = '💾 Save Invoice';
      return alert('❌ ' + error.message);
    }

    if (!inserted) {
      btn.disabled = false;
      btn.textContent = '💾 Save Invoice';
      return alert('❌ Could not generate unique invoice number. Try again.');
    }
  }

  // ─────────────────────────────────────────
  // INSERT ITEMS (dono cases ke liye)
  // ─────────────────────────────────────────
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
    btn.textContent = '💾 Save Invoice';
    return alert('❌ Items failed: ' + e2.message);
  }

  btn.textContent = '✅ Saved!';
  setTimeout(() => {
    window.location.href = me.role === 'admin' ? 'admin.html' : 'worker.html';
  }, 600);
}
// ============================================
// LOAD EXISTING INVOICE (View/Print mode)
// ============================================
async function loadExisting(id) {
  const { data: inv } = await supabase.from('invoices').select('*').eq('id', id).single();
  if (!inv) return alert('Invoice not found');

  $('invNo').textContent = inv.invoice_number;
  $('invDate').textContent = formatDate(inv.created_at);
  $('invBy').textContent = inv.created_by_name;
  $('custName').value = inv.customer_name || '';
  $('custPhone').value = inv.customer_phone || '';
  $('custAddr').value = inv.customer_address || '';
  $('custGstin').value = inv.customer_gstin || '';
  $('discount').value = inv.discount || 0;
  $('paymentMode').value = inv.payment_mode || 'Cash';
  $('notes').value = inv.notes || '';

  const { data: rows } = await supabase.from('invoice_items').select('*').eq('invoice_id', id);
  items = (rows || []).map((r) => ({
    name: r.product_name, qty: r.qty, price: r.price, tax: r.tax_percent
  }));
  if (!items.length) items.push({ name: '', qty: 1, price: 0, tax: 0 });

  renderItems();
  syncPrintFields();
}


