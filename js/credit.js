import { supabase } from './supabase-config.js';
import { formatMoney, formatDate, requireAuth, escapeHtml } from './utils.js';

const $ = (id) => document.getElementById(id);

let me = null;
let allEntries = [];
let selectedEntries = new Set();
let editingEntryId = null;
let payingEntryId = null;
let currentWhatsappCustomer = null;

// ============================================
// INIT
// ============================================
(async () => {
  console.log('🚀 Credit module starting...');

  try {
    const ctx = await requireAuth(supabase, 'admin');
    if (!ctx) return;
    me = ctx.profile;
    console.log('✅ Logged in:', me.email);
  } catch (err) {
    console.error('❌ Init error:', err);
    return;
  }

  $('logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  // Credit Modal
  $('newCreditBtn')?.addEventListener('click', () => openCreditModal());
  $('modalCloseBtn')?.addEventListener('click', closeCreditModal);
  $('modalCancelBtn')?.addEventListener('click', closeCreditModal);
  $('creditForm')?.addEventListener('submit', saveCreditEntry);

  // Payment Modal
  $('paymentCloseBtn')?.addEventListener('click', closePaymentModal);
  $('paymentCancelBtn')?.addEventListener('click', closePaymentModal);
  $('paymentForm')?.addEventListener('submit', savePayment);

  // WhatsApp Modal
  $('whatsappCloseBtn')?.addEventListener('click', closeWhatsappModal);
  $('whatsappCancelBtn')?.addEventListener('click', closeWhatsappModal);
  $('whatsappForm')?.addEventListener('submit', sendWhatsAppWithPDF);

  // Click outside
  ['creditModal', 'paymentModal', 'whatsappModal'].forEach((id) => {
    $(id)?.addEventListener('click', (e) => {
      if (e.target === $(id)) {
        if (id === 'creditModal') closeCreditModal();
        if (id === 'paymentModal') closePaymentModal();
        if (id === 'whatsappModal') closeWhatsappModal();
      }
    });
  });

  // Filters
  $('creditSearch')?.addEventListener('input', renderCreditList);
  $('creditStatusFilter')?.addEventListener('change', renderCreditList);
  $('creditSortFilter')?.addEventListener('change', renderCreditList);

  // Bulk
  $('downloadCSVBtn')?.addEventListener('click', downloadCSV);
  $('bulkDeleteBtn')?.addEventListener('click', bulkDelete);

  await loadCreditEntries();
})();

// ============================================
// LOAD
// ============================================
async function loadCreditEntries() {
  const { data: entries, error } = await supabase
    .from('credit_entries')
    .select('*')
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Load error:', error);
    return alert('❌ Load failed: ' + error.message);
  }

  // Payments fetch karo
  const { data: payments } = await supabase
    .from('credit_payments')
    .select('*')
    .order('payment_date', { ascending: false });

  // Attach payments to entries
  allEntries = (entries || []).map((e) => {
    e.payments = (payments || []).filter((p) => p.credit_entry_id === e.id);
    return e;
  });

  updateStats();
  renderCreditList();
}

// ============================================
// STATS
// ============================================
function updateStats() {
  const total = allEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const pending = allEntries
    .filter((e) => e.status === 'Pending')
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const partial = allEntries
    .filter((e) => e.status === 'Partial')
    .reduce((s, e) => s + Number((e.amount || 0) - (e.paid_amount || 0)), 0);
  const paid = allEntries.reduce((s, e) => s + Number(e.paid_amount || 0), 0);

  if ($('statTotal')) $('statTotal').textContent = formatMoney(total);
  if ($('statPending')) $('statPending').textContent = formatMoney(pending);
  if ($('statPartial')) $('statPartial').textContent = formatMoney(partial);
  if ($('statPaid')) $('statPaid').textContent = formatMoney(paid);
}

// ============================================
// RENDER LIST
// ============================================
function renderCreditList() {
  const search = ($('creditSearch')?.value || '').toLowerCase();
  const statusFilter = $('creditStatusFilter')?.value || '';
  const sortBy = $('creditSortFilter')?.value || 'recent';

  const filtered = allEntries.filter((e) => {
    if (search) {
      const match =
        (e.customer_name || '').toLowerCase().includes(search) ||
        (e.description || '').toLowerCase().includes(search) ||
        (e.service_type || '').toLowerCase().includes(search);
      if (!match) return false;
    }
    if (statusFilter && e.status !== statusFilter) return false;
    return true;
  });

  const customersMap = new Map();
  filtered.forEach((e) => {
    const key = (e.customer_name || '').trim().toLowerCase();
    if (!customersMap.has(key)) {
      customersMap.set(key, {
        name: e.customer_name,
        phone: e.customer_phone || '',
        entries: [],
        total: 0,
        paid: 0,
        balance: 0
      });
    }
    const cust = customersMap.get(key);
    cust.entries.push(e);
    cust.total += Number(e.amount || 0);
    cust.paid += Number(e.paid_amount || 0);
    cust.balance += Number((e.amount || 0) - (e.paid_amount || 0));
    if (e.customer_phone) cust.phone = e.customer_phone;
  });

  let customers = Array.from(customersMap.values());

  if (sortBy === 'amount') customers.sort((a, b) => b.total - a.total);
  else if (sortBy === 'name') customers.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === 'balance') customers.sort((a, b) => b.balance - a.balance);
  else {
    customers.sort((a, b) => {
      const aDate = new Date(a.entries[0]?.entry_date || 0);
      const bDate = new Date(b.entries[0]?.entry_date || 0);
      return bDate - aDate;
    });
  }

  if ($('totalEntriesCount')) {
    $('totalEntriesCount').textContent =
      `${customers.length} customer${customers.length !== 1 ? 's' : ''} • ${filtered.length} entries`;
  }

  const list = $('creditList');
  if (!list) return;

  if (!customers.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
        <div style="font-size:48px;margin-bottom:12px;opacity:0.3">💳</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:6px">Koi credit entry nahi</div>
        <div style="font-size:13px">"+ New Credit Entry" dabao</div>
      </div>`;
    updateBulkDeleteButton();
    return;
  }

  list.innerHTML = customers.map((cust) => renderCustomerCard(cust)).join('');
  bindCardEvents();
  updateBulkDeleteButton();
}

// ============================================
// CUSTOMER CARD
// ============================================
function renderCustomerCard(cust) {
  const total = cust.total;
  const paid = cust.paid;
  const balance = cust.balance;
  const percent = total > 0 ? Math.min(100, (paid / total) * 100) : 0;

  let status = 'Pending';
  if (total > 0 && paid >= total) status = 'Paid';
  else if (paid > 0) status = 'Partial';

  const statusIcon = status === 'Paid' ? '✅' : status === 'Partial' ? '🔶' : '⏳';
  const entryIds = cust.entries.map((e) => e.id);
  const allSelected = entryIds.every((id) => selectedEntries.has(id));
  const customerKey = escapeHtml(cust.name.toLowerCase());

  return `
    <div class="credit-card" data-status="${status}" data-customer-key="${customerKey}">
      <div class="credit-card-header">
        <div>
          <div class="customer-name">
            <input type="checkbox" class="card-checkbox" 
              data-customer-checkbox="${customerKey}" 
              ${allSelected ? 'checked' : ''} />
            👤 ${escapeHtml(cust.name)}
            <span class="customer-entries-count">${cust.entries.length} entr${cust.entries.length !== 1 ? 'ies' : 'y'}</span>
          </div>
          ${cust.phone ? `<div style="font-size:13px;color:var(--text-muted);margin-top:4px">📞 ${escapeHtml(cust.phone)}</div>` : ''}
        </div>
        <span class="status-badge ${status}">${statusIcon} ${status}</span>
      </div>

      <div class="credit-summary">
        <div class="summary-box total">
          <div class="label">Total</div>
          <div class="value">${formatMoney(total)}</div>
        </div>
        <div class="summary-box paid">
          <div class="label">Paid</div>
          <div class="value">${formatMoney(paid)}</div>
        </div>
        <div class="summary-box balance">
          <div class="label">Balance</div>
          <div class="value">${formatMoney(balance)}</div>
        </div>
      </div>

      <div class="progress-bar">
        <div class="progress-bar-fill" style="width:${percent}%"></div>
      </div>

      <div class="credit-entries">
        ${cust.entries.map((e) => renderEntryRow(e)).join('')}
      </div>

      <div class="card-actions">
        <button class="action-btn pay" 
          data-add-entry="${escapeHtml(cust.name)}" 
          data-add-phone="${escapeHtml(cust.phone)}"
          style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff">
          ➕ Add Entry
        </button>
        
        <button class="action-btn" 
          data-send-whatsapp="${customerKey}"
          style="background:linear-gradient(135deg,#25D366,#128C7E);color:#fff">
          📱 WhatsApp Bhejo
        </button>
        
        <button class="action-btn" 
          data-download-pdf="${customerKey}"
          style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff">
          📥 Download PDF
        </button>
      </div>
    </div>
  `;
}

// ============================================
// ENTRY ROW
// ============================================
function renderEntryRow(e) {
  const amount = Number(e.amount || 0);
  const paid = Number(e.paid_amount || 0);
  const balance = amount - paid;
  const isPaid = e.status === 'Paid';
  const isPartial = e.status === 'Partial';
  const statusIcon = isPaid ? '✅' : isPartial ? '🔶' : '⏳';

  // Payment history
  let paymentHistory = '';
  if (e.payments && e.payments.length > 0) {
    paymentHistory = `
      <div class="payment-history">
        <div class="payment-history-title">💰 Payment History (${e.payments.length})</div>
        ${e.payments.map((p) => `
          <div class="payment-history-row">
            <span>📅 ${formatDate(p.payment_date)} — ${escapeHtml(p.payment_mode || 'Cash')}</span>
            <strong>+PKR ${Number(p.amount_paid || 0).toFixed(2)}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  return `
    <div class="entry-row" data-entry-id="${e.id}">
      <input type="checkbox" class="card-checkbox entry-checkbox" 
        data-entry-checkbox="${e.id}" 
        ${selectedEntries.has(e.id) ? 'checked' : ''} />
      <div class="entry-info">
        <div class="entry-desc">${escapeHtml(e.description)}</div>
        <div class="entry-meta">
          <span>📅 ${formatDate(e.entry_date)}</span>
          ${e.customer_phone ? `<span style="color:#25D366;font-weight:600">📞 ${escapeHtml(e.customer_phone)}</span>` : '<span style="color:var(--text-muted);font-size:11px">📞 No number</span>'}
          ${e.service_type ? `<span>🔧 ${escapeHtml(e.service_type)}</span>` : ''}
          ${e.due_date ? `<span>⏰ Due: ${formatDate(e.due_date)}</span>` : ''}
          <span>${statusIcon} ${e.status}</span>
        </div>
        ${isPartial ? `
          <div class="partial-badge">
            💰 Paid: ${formatMoney(paid)} | Balance: ${formatMoney(balance)}
          </div>
        ` : ''}
        ${isPaid ? `
          <div class="paid-badge">
            ✅ Fully Paid: ${formatMoney(amount)}
          </div>
        ` : ''}
        ${paymentHistory}
      </div>
      <div class="entry-amount ${isPaid ? 'paid' : ''}">
        ${amount > 0 ? formatMoney(amount) : '<span style="color:var(--text-muted);font-size:13px">No amount</span>'}
        ${isPartial ? `<div style="font-size:11px;color:#f59e0b;margin-top:2px">Bal: ${formatMoney(balance)}</div>` : ''}
      </div>
      <div class="entry-actions">
        ${!isPaid && amount > 0 ? `<button class="action-btn pay" data-pay="${e.id}">💰 Pay</button>` : ''}
        <button class="action-btn edit" data-edit="${e.id}">✏️</button>
        <button class="action-btn delete" data-delete="${e.id}">🗑</button>
      </div>
    </div>
  `;
}

// ============================================
// BIND EVENTS
// ============================================
function bindCardEvents() {
  document.querySelectorAll('[data-entry-checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.entryCheckbox;
      if (cb.checked) selectedEntries.add(id);
      else selectedEntries.delete(id);
      updateBulkDeleteButton();
    });
  });

  document.querySelectorAll('[data-customer-checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const customerKey = cb.dataset.customerCheckbox;
      const card = document.querySelector(`.credit-card[data-customer-key="${customerKey}"]`);
      if (!card) return;

      card.querySelectorAll('[data-entry-checkbox]').forEach((entryCb) => {
        entryCb.checked = cb.checked;
        const id = entryCb.dataset.entryCheckbox;
        if (cb.checked) selectedEntries.add(id);
        else selectedEntries.delete(id);
      });
      updateBulkDeleteButton();
    });
  });

  document.querySelectorAll('[data-pay]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPaymentModal(btn.dataset.pay);
    });
  });

  document.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCreditModal(btn.dataset.edit);
    });
  });

  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteEntry(btn.dataset.delete);
    });
  });

  document.querySelectorAll('[data-add-entry]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCreditModal(null, btn.dataset.addEntry, btn.dataset.addPhone);
    });
  });

  document.querySelectorAll('[data-send-whatsapp]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openWhatsappModal(btn.dataset.sendWhatsapp);
    });
  });

  document.querySelectorAll('[data-download-pdf]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadPdfDirect(btn.dataset.downloadPdf);
    });
  });
}

function updateBulkDeleteButton() {
  const btn = $('bulkDeleteBtn');
  const countEl = $('selectedCount');
  if (!btn) return;
  const count = selectedEntries.size;
  if (countEl) countEl.textContent = count;
  btn.disabled = count === 0;
}

// ============================================
// CREDIT MODAL
// ============================================
function openCreditModal(entryId = null, prefilledCustomer = '', prefilledPhone = '') {
  editingEntryId = entryId;
  const modal = $('creditModal');
  const title = $('modalTitle');
  const form = $('creditForm');

  if (!modal || !form) return;
  form.reset();

  if (entryId) {
    const entry = allEntries.find((e) => e.id === entryId);
    if (!entry) return alert('Entry nahi mili');
    title.textContent = '✏️ Edit Credit Entry';
    $('cName').value = entry.customer_name || '';
    $('cPhone').value = entry.customer_phone || '';
    $('cDescription').value = entry.description || '';
    $('cServiceType').value = entry.service_type || '';
    $('cAmount').value = entry.amount > 0 ? entry.amount : '';
    $('cDate').value = entry.entry_date || '';
    $('cDueDate').value = entry.due_date || '';
    $('cNotes').value = entry.notes || '';
  } else {
    title.textContent = '➕ New Credit Entry';
    const today = new Date().toISOString().split('T')[0];
    $('cDate').value = today;
    if (prefilledCustomer) $('cName').value = prefilledCustomer;
    if (prefilledPhone) $('cPhone').value = prefilledPhone;
  }

  modal.classList.add('active');
  setTimeout(() => $('cName')?.focus(), 100);
}

function closeCreditModal() {
  $('creditModal')?.classList.remove('active');
  editingEntryId = null;
}

// ============================================
// SAVE CREDIT ENTRY
// ============================================
async function saveCreditEntry(e) {
  e.preventDefault();

  const btn = $('modalSubmitBtn');
  const originalText = btn?.textContent || 'Save';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }

  const amountRaw = ($('cAmount')?.value || '').trim();
  const amount = amountRaw === '' ? 0 : (parseFloat(amountRaw) || 0);

  const payload = {
    customer_name: ($('cName')?.value || '').trim(),
    customer_phone: ($('cPhone')?.value || '').trim(),
    description: ($('cDescription')?.value || '').trim(),
    service_type: $('cServiceType')?.value || '',
    amount: amount,
    entry_date: $('cDate')?.value || new Date().toISOString().split('T')[0],
    due_date: $('cDueDate')?.value || null,
    notes: ($('cNotes')?.value || '').trim(),
    created_by: me.id,
    created_by_name: me.full_name || me.email || 'Admin'
  };

  if (!payload.customer_name) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    return alert('⚠️ Customer name required');
  }
  if (!payload.description) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    return alert('⚠️ Description required');
  }

  let result;
  if (editingEntryId) {
    result = await supabase.from('credit_entries').update(payload).eq('id', editingEntryId).select().single();
  } else {
    result = await supabase.from('credit_entries').insert(payload).select().single();
  }

  const { error } = result;

  if (error) {
    console.error('Save error:', error);
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    return alert('❌ ' + error.message);
  }

  if (btn) btn.textContent = '✅ Saved!';
  closeCreditModal();
  await loadCreditEntries();

  setTimeout(() => {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }, 500);
}

async function deleteEntry(id) {
  if (!confirm('⚠️ Ye entry delete karni hai?')) return;
  const { error } = await supabase.from('credit_entries').delete().eq('id', id);
  if (error) return alert('❌ ' + error.message);
  await loadCreditEntries();
}

// ============================================
// PAYMENT MODAL
// ============================================
function openPaymentModal(entryId) {
  const entry = allEntries.find((e) => e.id === entryId);
  if (!entry) return;

  payingEntryId = entryId;
  const balance = Number(entry.amount || 0) - Number(entry.paid_amount || 0);

  $('payCustomerName').textContent = entry.customer_name;
  $('payEntryDesc').textContent = entry.description;
  $('payTotal').textContent = formatMoney(entry.amount);
  $('payBalance').textContent = formatMoney(balance);

  $('payAmount').value = balance.toFixed(2);
  $('payDate').value = new Date().toISOString().split('T')[0];
  $('payMode').value = 'Cash';
  $('payNotes').value = '';

  $('paymentModal')?.classList.add('active');
  setTimeout(() => $('payAmount')?.focus(), 100);
}

function closePaymentModal() {
  $('paymentModal')?.classList.remove('active');
  payingEntryId = null;
}

async function savePayment(e) {
  e.preventDefault();
  if (!payingEntryId) return;

  const entry = allEntries.find((e) => e.id === payingEntryId);
  if (!entry) return;

  const balance = Number(entry.amount || 0) - Number(entry.paid_amount || 0);
  const amountPaid = parseFloat($('payAmount')?.value) || 0;

  if (amountPaid <= 0) return alert('⚠️ Amount 0 se zyada hona chahiye');
  if (amountPaid > balance + 0.01) return alert(`⚠️ Balance se zyada nahi.\nMax: PKR ${balance.toFixed(2)}`);

  const btn = $('paymentSubmitBtn');
  const originalText = btn?.textContent || 'Save';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }

  const payload = {
    credit_entry_id: payingEntryId,
    amount_paid: amountPaid,
    payment_mode: $('payMode')?.value || 'Cash',
    payment_date: $('payDate')?.value || new Date().toISOString().split('T')[0],
    notes: ($('payNotes')?.value || '').trim(),
    recorded_by: me.id,
    recorded_by_name: me.full_name || 'Admin'
  };

  const { error } = await supabase.from('credit_payments').insert(payload);

  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    return alert('❌ ' + error.message);
  }

  if (btn) btn.textContent = '✅ Saved!';
  closePaymentModal();
  await loadCreditEntries();

  setTimeout(() => {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }, 500);
}

// ============================================
// HELPER
// ============================================
function getCustomerData(customerKey) {
  const entries = allEntries.filter(
    (e) => (e.customer_name || '').toLowerCase().trim() === customerKey
  );
  if (!entries.length) return null;

  entries.sort((a, b) => {
    const aDate = new Date(a.entry_date || 0);
    const bDate = new Date(b.entry_date || 0);
    return aDate - bDate;
  });

  const name = entries[0].customer_name;
  const phone = entries[0].customer_phone || '';
  const total = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalPaid = entries.reduce((s, e) => s + Number(e.paid_amount || 0), 0);
  const totalBalance = total - totalPaid;

  return { entries, name, phone, total, totalPaid, totalBalance };
}

// ============================================
// WHATSAPP MODAL
// ============================================
function openWhatsappModal(customerKey) {
  const cust = getCustomerData(customerKey);
  if (!cust) return alert('Customer nahi mila');

  currentWhatsappCustomer = { customerKey, ...cust };

  $('whatsappCustomerName').textContent = cust.name;
  $('whatsappTotal').textContent = formatMoney(cust.total);
  $('whatsappBalance').textContent = formatMoney(cust.totalBalance);

  $('whatsappNumber').value = cust.phone || '';

  const shopName = me.shop_name || 'H.S Computers & CCTV';
  $('whatsappMessage').value =
    `Assalam-o-Alaikum ${cust.name},\n\n` +
    `Aapka credit khata PDF me attach kiya gaya hai.\n\n` +
    `*Total:* PKR ${cust.total.toFixed(2)}\n` +
    `*Paid:* PKR ${cust.totalPaid.toFixed(2)}\n` +
    `*Balance:* PKR ${cust.totalBalance.toFixed(2)}\n\n` +
    `Shukriya!\n` +
    `${shopName}`;

  $('whatsappModal').classList.add('active');
  setTimeout(() => $('whatsappNumber')?.focus(), 100);
}

function closeWhatsappModal() {
  $('whatsappModal')?.classList.remove('active');
  currentWhatsappCustomer = null;
}

// ============================================
// GENERATE PDF
// ============================================
async function generatePdfBlob(customerKey) {
  const cust = getCustomerData(customerKey);
  if (!cust) throw new Error('Customer not found');

  const { entries, name, phone, total, totalPaid, totalBalance } = cust;

  const shopName = me.shop_name || 'H.S Computers & CCTV';
  const shopAddress = me.shop_address || '';
  const shopPhone = me.shop_phone || '';
  const shopEmail = me.shop_email || '';
  const shopLogo = me.shop_logo_url || '';

  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:40px;font-family:Inter,Arial,sans-serif;color:#1f2937;';
  
  container.innerHTML = `
    <div style="font-family:'Inter',Arial,sans-serif;color:#1f2937;background:#fff">

      <!-- HEADER -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:4px solid #6366f1;gap:20px">
        <div style="display:flex;gap:16px;align-items:flex-start;flex:1">
          ${shopLogo ? `<img src="${shopLogo}" alt="Logo" style="width:80px;height:80px;object-fit:contain;border-radius:12px;background:#fff;padding:6px;border:1px solid #e5e7eb;flex-shrink:0" crossorigin="anonymous" />` : ''}
          <div>
            <h1 style="font-size:26px;font-weight:800;color:#6366f1;margin:0 0 8px 0">${escapeHtml(shopName)}</h1>
            ${shopAddress ? `<p style="margin:3px 0;font-size:13px;color:#4b5563">📍 ${escapeHtml(shopAddress)}</p>` : ''}
            ${shopPhone ? `<p style="margin:3px 0;font-size:13px;color:#4b5563">📞 ${escapeHtml(shopPhone)}</p>` : ''}
            ${shopEmail ? `<p style="margin:3px 0;font-size:13px;color:#4b5563">✉️ ${escapeHtml(shopEmail)}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right;min-width:200px">
          <h2 style="font-size:24px;font-weight:900;color:#f59e0b;margin:0;letter-spacing:3px">CREDIT KHATA</h2>
          <p style="margin:8px 0 0 0;font-size:12px;color:#6b7280"><strong>Generated:</strong> ${new Date().toLocaleString('en-GB')}</p>
        </div>
      </div>

      <!-- CUSTOMER -->
      <div style="background:#f3f4f6;padding:16px;border-left:5px solid #6366f1;margin:22px 0;border-radius:8px">
        <div style="font-size:11px;font-weight:800;color:#6366f1;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px">Customer Details</div>
        <p style="margin:5px 0;font-size:16px;font-weight:700;color:#1f2937">👤 ${escapeHtml(name)}</p>
        ${phone ? `<p style="margin:5px 0;font-size:14px;color:#4b5563">📞 ${escapeHtml(phone)}</p>` : ''}
      </div>

      <!-- TABLE -->
      <div style="font-size:12px;font-weight:800;color:#6366f1;text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 12px 0">Credit Entries (${entries.length})</div>
      
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
        <thead>
          <tr style="background:#6366f1;color:#fff">
            <th style="padding:10px 6px;text-align:left;font-size:11px;font-weight:700;border:1px solid #4f46e5;width:35px">#</th>
            <th style="padding:10px 6px;text-align:left;font-size:11px;font-weight:700;border:1px solid #4f46e5;width:85px">Date</th>
            <th style="padding:10px 6px;text-align:left;font-size:11px;font-weight:700;border:1px solid #4f46e5">Description</th>
            <th style="padding:10px 6px;text-align:left;font-size:11px;font-weight:700;border:1px solid #4f46e5;width:105px">Phone</th>
            <th style="padding:10px 6px;text-align:right;font-size:11px;font-weight:700;border:1px solid #4f46e5;width:80px">Amount</th>
            <th style="padding:10px 6px;text-align:right;font-size:11px;font-weight:700;border:1px solid #4f46e5;width:75px">Paid</th>
            <th style="padding:10px 6px;text-align:right;font-size:11px;font-weight:700;border:1px solid #4f46e5;width:85px">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((e, i) => {
            const amt = Number(e.amount || 0);
            const paid = Number(e.paid_amount || 0);
            const bal = amt - paid;
            const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
            return `
              <tr style="background:${bg}">
                <td style="padding:9px 6px;font-size:12px;border:1px solid #e5e7eb;text-align:center;font-weight:600;color:#6b7280">${i + 1}</td>
                <td style="padding:9px 6px;font-size:12px;border:1px solid #e5e7eb;color:#4b5563">${formatDate(e.entry_date)}</td>
                <td style="padding:9px 6px;font-size:12px;border:1px solid #e5e7eb;color:#1f2937;font-weight:500">
                  ${escapeHtml(e.description)}
                  ${e.service_type ? `<div style="font-size:10px;color:#6b7280;margin-top:2px">🔧 ${escapeHtml(e.service_type)}</div>` : ''}
                </td>
                <td style="padding:9px 6px;font-size:12px;border:1px solid #e5e7eb;color:#25D366;font-weight:600;white-space:nowrap">
                  ${e.customer_phone ? escapeHtml(e.customer_phone) : '<span style="color:#9ca3af;font-weight:400">—</span>'}
                </td>
                <td style="padding:9px 6px;font-size:12px;border:1px solid #e5e7eb;text-align:right;color:#6366f1;font-weight:600;white-space:nowrap">${amt > 0 ? amt.toFixed(2) : '—'}</td>
                <td style="padding:9px 6px;font-size:12px;border:1px solid #e5e7eb;text-align:right;color:#10b981;font-weight:600;white-space:nowrap">${paid > 0 ? paid.toFixed(2) : '—'}</td>
                <td style="padding:9px 6px;font-size:12px;border:1px solid #e5e7eb;text-align:right;color:#ef4444;font-weight:700;white-space:nowrap">${bal > 0 ? bal.toFixed(2) : '✓'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <!-- TOTALS -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:30px">
        <div style="min-width:340px;background:#f3f4f6;padding:18px;border-radius:10px;border:1px solid #e5e7eb">
          <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;border-bottom:1px dashed #d1d5db">
            <span style="color:#4b5563">Total Amount:</span>
            <strong style="color:#6366f1">PKR ${total.toFixed(2)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;border-bottom:1px dashed #d1d5db">
            <span style="color:#4b5563">Total Paid:</span>
            <strong style="color:#10b981">PKR ${totalPaid.toFixed(2)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:12px 0 4px 0;font-size:18px;border-top:3px solid #6366f1;margin-top:8px">
            <span style="font-weight:800">BALANCE:</span>
            <strong style="color:#ef4444;font-size:22px">PKR ${totalBalance.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      <!-- FOOTER -->
      <div style="border-top:2px dashed #d1d5db;padding-top:18px;text-align:center;font-size:12px;color:#6b7280">
        <p style="margin:6px 0;font-size:14px;color:#6366f1;font-weight:700">شكريه! Aapke business ke liye shukriya 🙏</p>
        <p style="margin:4px 0"><strong>${escapeHtml(shopName)}</strong>${shopPhone ? ' — ' + escapeHtml(shopPhone) : ''}</p>
        <p style="margin:4px 0;font-size:11px;color:#9ca3af">This is a computer-generated document.</p>
      </div>
    </div>
  `;

  document.body.appendChild(container);
  await new Promise((r) => setTimeout(r, 400));

  const canvas = await html2canvas(container, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    width: 794,
    windowWidth: 794
  });

  document.body.removeChild(container);

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pdfWidth - 20;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.95);

  let heightLeft = imgHeight;
  let position = 10;
  pdf.addImage(imgData, 'JPEG', 10, position, imgWidth, imgHeight);
  heightLeft -= (pdfHeight - 20);

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + 10;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 10, position, imgWidth, imgHeight);
    heightLeft -= (pdfHeight - 20);
  }

  const filename = `Credit-Khata_${name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const blob = pdf.output('blob');

  return { blob, filename, customerName: name, total, totalPaid, totalBalance };
}

// ============================================
// 📥 DOWNLOAD PDF DIRECTLY
// ============================================
async function downloadPdfDirect(customerKey) {
  const btn = document.querySelector(`[data-download-pdf="${customerKey}"]`);
  const originalText = btn?.textContent || '📥 Download PDF';
  const originalBg = btn?.style.background || '';

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Generating...';
  }

  try {
    const pdfData = await generatePdfBlob(customerKey);

    const url = URL.createObjectURL(pdfData.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfData.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (btn) {
      btn.textContent = '✅ Downloaded!';
      btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';

      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.background = originalBg || 'linear-gradient(135deg,#3b82f6,#1d4ed8)';
      }, 2000);
    }
  } catch (err) {
    console.error('❌ PDF download error:', err);
    alert('❌ PDF generate nahi hui:\n\n' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

// ============================================
// 📱 SEND WHATSAPP
// ============================================
async function sendWhatsAppWithPDF(e) {
  e.preventDefault();
  if (!currentWhatsappCustomer) return;

  let phone = ($('whatsappNumber')?.value || '').trim();
  const message = ($('whatsappMessage')?.value || '').trim();

  if (!phone) return alert('⚠️ WhatsApp number required');
  if (!message) return alert('⚠️ Message required');

  phone = phone.replace(/\D/g, '');
  if (phone.length === 10) phone = '92' + phone;
  else if (phone.startsWith('0') && phone.length === 11) phone = '92' + phone.substring(1);

  const btn = $('whatsappSubmitBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Generating PDF...';

  try {
    const pdfData = await generatePdfBlob(currentWhatsappCustomer.customerKey);

    const url = URL.createObjectURL(pdfData.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfData.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    btn.textContent = '📱 Opening WhatsApp...';
    closeWhatsappModal();

    await new Promise((r) => setTimeout(r, 1000));

    const waURL = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(waURL, '_blank');

    setTimeout(() => {
      alert(
        `✅ PDF downloaded: ${pdfData.filename}\n\n` +
        `📱 WhatsApp opened for +${phone}\n\n` +
        `Ab PDF attach karo (📎 icon) aur Send dabao.`
      );
    }, 600);

  } catch (err) {
    console.error('❌ WhatsApp error:', err);
    alert('❌ Error:\n\n' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ============================================
// DOWNLOAD CSV
// ============================================
function downloadCSV() {
  const search = ($('creditSearch')?.value || '').toLowerCase();
  const statusFilter = $('creditStatusFilter')?.value || '';

  const filtered = allEntries.filter((e) => {
    if (search) {
      const match =
        (e.customer_name || '').toLowerCase().includes(search) ||
        (e.description || '').toLowerCase().includes(search) ||
        (e.service_type || '').toLowerCase().includes(search);
      if (!match) return false;
    }
    if (statusFilter && e.status !== statusFilter) return false;
    return true;
  });

  if (!filtered.length) return alert('❌ Koi entry nahi hai');

  const headers = [
    'Customer Name', 'Phone', 'Description', 'Service Type',
    'Amount', 'Paid', 'Balance', 'Entry Date', 'Due Date',
    'Status', 'Notes', 'Created By'
  ];

  const rows = filtered.map((e) => [
    e.customer_name || '',
    e.customer_phone || '',
    e.description || '',
    e.service_type || '',
    Number(e.amount || 0).toFixed(2),
    Number(e.paid_amount || 0).toFixed(2),
    Number((e.amount || 0) - (e.paid_amount || 0)).toFixed(2),
    formatDate(e.entry_date),
    e.due_date ? formatDate(e.due_date) : '',
    e.status || 'Pending',
    e.notes || '',
    e.created_by_name || ''
  ]);

  const totalAmount = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalPaid = filtered.reduce((s, e) => s + Number(e.paid_amount || 0), 0);
  const totalBalance = totalAmount - totalPaid;

  rows.push([]);
  rows.push(['', '', '', 'TOTAL', totalAmount.toFixed(2), totalPaid.toFixed(2), totalBalance.toFixed(2)]);

  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `credit-khata_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================
// BULK DELETE
// ============================================
async function bulkDelete() {
  if (selectedEntries.size === 0) return;

  const count = selectedEntries.size;
  if (!confirm(`🗑️ ${count} entr${count > 1 ? 'ies' : 'y'} delete karni hai?\n\nUndo nahi ho sakta!`)) return;

  const btn = $('bulkDeleteBtn');
  const originalText = btn?.textContent || 'Delete';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Deleting...'; }

  const ids = Array.from(selectedEntries);
  const { error } = await supabase.from('credit_entries').delete().in('id', ids);

  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    return alert('❌ ' + error.message);
  }

  selectedEntries.clear();
  alert(`✅ ${count} entr${count > 1 ? 'ies' : 'y'} delete ho gayi!`);

  if (btn) btn.textContent = originalText;
  await loadCreditEntries();
}