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
  // 1) Auth check — admin ya technician allowed
  const ctx = await requireAuth(supabase);
  if (!ctx) return;
  me = ctx.profile;

  if (!['admin', 'technician'].includes(me.role)) {
    alert('⚠️ Aapko is page ka access nahi hai.');
    window.location.href = 'worker.html';
    return;
  }

  isAdminUser = me.role === 'admin';

  // 2) Shop header fill karo
  $('shopNameDisplay').textContent = me.shop_name || 'H.S Computers & CCTV';
  $('shopAddrDisplay').textContent = me.shop_address || '';
  $('shopPhoneDisplay').textContent = me.shop_phone ? '📞 ' + me.shop_phone : '';
  $('shopEmailDisplay').textContent = me.shop_email ? '✉️ ' + me.shop_email : '';

  // 3) Logo load
  if (me.shop_logo_url) {
    const logoEl = $('shopLogo');
    if (logoEl) {
      logoEl.src = me.shop_logo_url;
      logoEl.classList.remove('hidden');
      logoEl.onerror = () => logoEl.classList.add('hidden');
    }
  }

  // 4) URL check — existing ya naya?
  const params = new URLSearchParams(location.search);
  existingId = params.get('id');

  if (existingId) {
    await loadExisting(existingId);
  } else {
    // Naya invoice — sirf technician bana sakta hai
    if (me.role !== 'technician') {
      alert('⚠️ Sirf technician naya invoice bana sakta hai.');
      window.location.href = 'admin.html';
      return;
    }
    setupNewInvoice();
  }

  // 5) Event bindings
  bindEvents();

  // 6) Initial sync
  syncPrintFields();
})();

// ============================================
// NAYA INVOICE SETUP
// ============================================
function setupNewInvoice() {
  $('invNo').textContent = 'TECH-' + generateInvoiceNumber().replace('INV-', '');
  $('invDate').textContent = formatDate(new Date());
  $('invBy').textContent = me.full_name;

  const today = new Date().toISOString().split('T')[0];
  const serviceDateEl = $('serviceDate');
  if (serviceDateEl) serviceDateEl.value = today;

  addItem();
}

// ============================================
// EXISTING INVOICE LOAD
// ============================================
async function loadExisting(id) {
  const { data: inv, error } = await supabase
    .from('technician_invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !inv) {
    alert('❌ Invoice nahi mili ya access nahi hai.');
    redirectBack();
    return;
  }

  isOwner = inv.technician_id === me.id;

  // Access check — owner ya admin
  if (!isOwner && !isAdminUser) {
    alert('⚠️ Aap sirf apni invoices dekh sakte hain.');
    window.location.href = 'technician.html';
    return;
  }

  // Fill header
  $('invNo').textContent = inv.invoice_number;
  $('invDate').textContent = formatDate(inv.created_at);
  $('invBy').textContent = inv.technician_name || '-';

  // Fill customer info
  $('custName').value = inv.customer_name || '';
  $('custPhone').value = inv.customer_phone || '';
  $('custAddr').value = inv.customer_address || '';
  $('serviceType').value = inv.service_type || '';

  const serviceDateEl = $('serviceDate');
  if (serviceDateEl && inv.service_date) {
    serviceDateEl.value = inv.service_date;
  }

  // Charges
  $('laborCharge').value = inv.labor_charge || 0;
  $('travelExpense').value = inv.travel_expense || 0;
  $('otherExpense').value = inv.other_expense || 0;
  $('otherExpenseNote').value = inv.other_expense_note || '';
  $('discount').value = inv.discount || 0;
  $('paymentMode').value = inv.payment_mode || 'Cash';
  $('paymentStatus').value = inv.payment_status || 'Pending';
  $('amountReceived').value = inv.amount_received || 0;
  $('notes').value = inv.notes || '';

  // Load items
  const { data: rows } = await supabase
    .from('technician_invoice_items')
    .select('*')
    .eq('invoice_id', id);

  items = (rows || []).map((r) => ({
    name: r.item_name,
    qty: r.qty,
    price: r.price
  }));

  if (!items.length) items.push({ name: '', qty: 1, price: 0 });

  renderItems();

  // ─── Button visibility based on role ───
  const saveBtn = $('saveBtn');
  const addItemBtn = $('addItemBtn');

  if (isOwner) {
    // Owner apni invoice dekh raha hai — Save hide (already saved)
    if (saveBtn) saveBtn.classList.add('hidden');
  } else if (isAdminUser) {
    // Admin dekh raha hai — sirf View Only
    if (saveBtn) {
      saveBtn.textContent = '👁 View Only';
      saveBtn.disabled = true;
      saveBtn.title = 'Admin sirf print kar sakta hai';
      saveBtn.style.opacity = '0.5';
      saveBtn.style.cursor = 'not-allowed';
    }
    // Edit disable
    disableAllEditing();
  }
}

// ============================================
// DISABLE EDITING (Admin View Mode)
// ============================================
function disableAllEditing() {
  // Sab inputs disabled
  const inputs = document.querySelectorAll('.invoice-page input, .invoice-page textarea, .invoice-page select');
  inputs.forEach((el) => {
    if (!el.classList.contains('no-print')) return;
    el.disabled = true;
    el.style.opacity = '0.7';
    el.style.cursor = 'not-allowed';
  });

  // Add item button hide
  const addBtn = $('addItemBtn');
  if (addBtn) addBtn.style.display = 'none';

  // Remove item buttons hide
  document.querySelectorAll('[data-rm]').forEach((b) => b.style.display = 'none');

  // Discount input disabled
  const disc = $('discount');
  if (disc) disc.disabled = true;
}

// ============================================
// EVENT BINDINGS
// ============================================
function bindEvents() {
  // Add item
  $('addItemBtn')?.addEventListener('click', () => addItem());

  // Recalc triggers
  ['discount', 'laborCharge', 'travelExpense', 'otherExpense'].forEach((id) => {
    $(id)?.addEventListener('input', recalc);
  });

  // Print sync triggers
  ['otherExpenseNote', 'serviceDate', 'custName', 'custPhone', 'custAddr', 'serviceType'].forEach((id) => {
    $(id)?.addEventListener('input', syncPrintFields);
  });

  // Save
  $('saveBtn')?.addEventListener('click', saveInvoice);

  // Print
  $('printBtn')?.addEventListener('click', () => {
    syncPrintFields();
    setTimeout(() => window.print(), 100);
  });
}

// ============================================
// ITEMS MANAGEMENT
// ============================================
function addItem(data = { name: '', qty: 1, price: 0 }) {
  items.push({ ...data });
  renderItems();
}

function renderItems() {
  const body = $('itemsBody');
  if (!body) return;

  body.innerHTML = items.map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>
        <input data-idx="${idx}" data-k="name" 
          value="${escapeHtml(it.name)}" 
          placeholder="Part / Item name" />
      </td>
      <td>
        <input data-idx="${idx}" data-k="qty" type="number" 
          min="0" step="0.01" value="${it.qty}" />
      </td>
      <td>
        <input data-idx="${idx}" data-k="price" type="number" 
          min="0" step="0.01" value="${it.price}" />
      </td>
      <td class="line-total">${formatMoney(lineTotal(it))}</td>
      <td class="no-print">
        <button class="btn danger" data-rm="${idx}" 
          style="padding:6px 10px;min-height:auto">×</button>
      </td>
    </tr>
  `).join('');

  // Input listeners
  body.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.idx;
      const k = e.target.dataset.k;
      items[i][k] = k === 'name' ? e.target.value : (parseFloat(e.target.value) || 0);
      recalc();
    });
  });

  // Remove buttons
  body.querySelectorAll('[data-rm]').forEach((b) => {
    b.addEventListener('click', () => {
      items.splice(+b.dataset.rm, 1);
      if (!items.length) items.push({ name: '', qty: 1, price: 0 });
      renderItems();
      recalc();
    });
  });

  recalc();
}

function lineTotal(it) {
  return (Number(it.qty) || 0) * (Number(it.price) || 0);
}

// ============================================
// RECALCULATE TOTALS
// ============================================
function recalc() {
  const body = $('itemsBody');
  let partsTotal = 0;

  items.forEach((it, idx) => {
    const line = lineTotal(it);
    partsTotal += line;
    const cell = body?.querySelector(`tr:nth-child(${idx + 1}) .line-total`);
    if (cell) cell.textContent = formatMoney(line);
  });

  const labor = parseFloat($('laborCharge')?.value) || 0;
  const travel = parseFloat($('travelExpense')?.value) || 0;
  const other = parseFloat($('otherExpense')?.value) || 0;
  const disc = parseFloat($('discount')?.value) || 0;

  const grand = Math.max(0, partsTotal + labor + travel + other - disc);

  setText('partsTotal', formatMoney(partsTotal));
  setText('laborTotal', formatMoney(labor));
  setText('travelTotal', formatMoney(travel));
  setText('otherTotal', formatMoney(other));
  setText('discountP', formatMoney(disc));
  setText('grandTotal', formatMoney(grand));

  syncPrintFields();
}

// ============================================
// SYNC PRINT-ONLY FIELDS
// ============================================
function syncPrintFields() {
  setText('custNameP', $('custName')?.value);
  setText('custPhoneP', $('custPhone')?.value);
  setText('custAddrP', $('custAddr')?.value);
  setText('serviceTypeP', $('serviceType')?.value);

  const serviceDateVal = $('serviceDate')?.value;
  setText('serviceDateP', serviceDateVal ? formatDate(serviceDateVal) : '');

  setText('laborChargeP', formatMoney($('laborCharge')?.value || 0));
  setText('travelExpenseP', formatMoney($('travelExpense')?.value || 0));
  setText('otherExpenseP', formatMoney($('otherExpense')?.value || 0));
  setText('otherExpenseNoteP', $('otherExpenseNote')?.value || '');
  setText('paymentModeP', $('paymentMode')?.value || '');
  setText('paymentStatusP', $('paymentStatus')?.value || '');

  // Hide empty print fields
  ['custPhoneP', 'custAddrP', 'serviceTypeP', 'serviceDateP', 'otherExpenseNoteP'].forEach((id) => {
    const el = $(id);
    if (el) el.style.display = el.textContent.trim() ? 'block' : 'none';
  });
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val || '';
}

// ============================================
// SAVE INVOICE
// ============================================
async function saveInvoice() {
  // Owner only (admin view mode me disabled hai)
  if (isAdminUser && !isOwner) {
    return alert('⚠️ Admin sirf view/print kar sakta hai.');
  }

  const custName = $('custName')?.value.trim();
  if (!custName) {
    alert('⚠️ Customer name required');
    $('custName')?.focus();
    return;
  }

  const validItems = items.filter((i) => i.name.trim() && i.qty > 0);

  const partsTotal = validItems.reduce((s, i) => s + i.qty * i.price, 0);
  const labor = parseFloat($('laborCharge').value) || 0;
  const travel = parseFloat($('travelExpense').value) || 0;
  const other = parseFloat($('otherExpense').value) || 0;
  const disc = parseFloat($('discount').value) || 0;
  const grand = Math.max(0, partsTotal + labor + travel + other - disc);

  const btn = $('saveBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';

  const payload = {
    customer_name: custName,
    customer_phone: $('custPhone').value,
    customer_address: $('custAddr').value,
    service_type: $('serviceType').value,
    service_date: $('serviceDate').value || new Date().toISOString().split('T')[0],
    parts_total: partsTotal,
    labor_charge: labor,
    travel_expense: travel,
    other_expense: other,
    other_expense_note: $('otherExpenseNote').value,
    discount: disc,
    grand_total: grand,
    payment_mode: $('paymentMode').value,
    payment_status: $('paymentStatus').value,
    amount_received: parseFloat($('amountReceived').value) || 0,
    notes: $('notes').value,
    technician_id: me.id,
    technician_name: me.full_name
  };

  let invoiceId;

  // ─── Update (existing) ───
  if (existingId && isOwner) {
    const { error } = await supabase
      .from('technician_invoices')
      .update(payload)
      .eq('id', existingId);

    if (error) {
      btn.disabled = false;
      btn.textContent = originalText;
      return alert('❌ Update failed: ' + error.message);
    }

    invoiceId = existingId;
    await supabase.from('technician_invoice_items').delete().eq('invoice_id', invoiceId);
  }
  // ─── Insert (new) ───
  else {
    let inserted = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      payload.invoice_number = 'TECH-' + generateInvoiceNumber().replace('INV-', '');

      const { data, error } = await supabase
        .from('technician_invoices')
        .insert(payload)
        .select()
        .single();

      if (!error) {
        invoiceId = data.id;
        inserted = true;
        break;
      }

      if (error.code === '23505') {
        console.warn('Duplicate invoice number, retrying...');
        continue;
      }

      btn.disabled = false;
      btn.textContent = originalText;
      return alert('❌ ' + error.message);
    }

    if (!inserted) {
      btn.disabled = false;
      btn.textContent = originalText;
      return alert('❌ Unique invoice number nahi ban paya. Try again.');
    }
  }

  // ─── Insert items ───
  if (validItems.length) {
    const itemRows = validItems.map((i) => ({
      invoice_id: invoiceId,
      item_name: i.name,
      qty: i.qty,
      price: i.price,
      line_total: i.qty * i.price
    }));

    const { error: e2 } = await supabase
      .from('technician_invoice_items')
      .insert(itemRows);

    if (e2) {
      btn.disabled = false;
      btn.textContent = originalText;
      return alert('❌ Items save failed: ' + e2.message);
    }
  }

  btn.textContent = '✅ Saved!';

  setTimeout(() => {
    redirectBack();
  }, 800);
}

// ============================================
// REDIRECT BACK
// ============================================
function redirectBack() {
  if (me.role === 'admin') {
    window.location.href = 'admin.html';
  } else {
    window.location.href = 'technician.html';
  }
}