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

  // Click outside to close modals
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

  // Bulk actions
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

  const { data: payments } = await supabase
    .from('credit_payments')
    .select('*')
    .order('payment_date', { ascending: false });

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
// CUSTOMER CARD (Header se number removed)
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
// 🚀 GENERATE PDF (Header me number nahi aayega)
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

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');

  // 1. HEADER
  if (shopLogo) {
    try {
      doc.addImage(shopLogo, 'PNG', 14, 15, 20, 20);
    } catch (e) {
      console.warn('Logo load error in PDF:', e);
    }
  }

  doc.setFontSize(22);
  doc.setTextColor(99, 102, 241);
  doc.setFont('helvetica', 'bold');
  doc.text(shopName, shopLogo ? 38 : 14, 22);

  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.setFont('helvetica', 'normal');
  
  let headerY = 28;
  if (shopAddress) { doc.text(shopAddress, shopLogo ? 38 : 14, headerY); headerY += 5; }
  if (shopPhone) { doc.text(`Phone: ${shopPhone}`, shopLogo ? 38 : 14, headerY); headerY += 5; }
  if (shopEmail) { doc.text(`Email: ${shopEmail}`, shopLogo ? 38 : 14, headerY); headerY += 5; }

  doc.setFontSize(18);
  doc.setTextColor(245, 158, 11);
  doc.setFont('helvetica', 'bold');
  doc.text('CREDIT KHATA', 196, 22, { align: 'right' });

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, 196, 28, { align: 'right' });

  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(14, Math.max(headerY, 38), 196, Math.max(headerY, 38));

  // 2. CUSTOMER DETAILS (👈 Yahan se number remove kar diya gaya hai)
  let currentY = Math.max(headerY, 38) + 12;
  
  doc.setFillColor(243, 244, 246);
  doc.rect(14, currentY, 182, 18, 'F');
  doc.setFillColor(99, 102, 241);
  doc.rect(14, currentY, 3, 18, 'F');

  doc.setFontSize(10);
  doc.setTextColor(99, 102, 241);
  doc.setFont('helvetica', 'bold');
  doc.text('CUSTOMER DETAILS', 20, currentY + 6);

  doc.setFontSize(12);
  doc.setTextColor(31, 41, 55);
  doc.text(`Name: ${name}`, 20, currentY + 13);
  
  // 👇 Phone number ka code hata diya gaya hai yahan se
  // if (phone) {
  //   doc.setFontSize(10);
  //   doc.setTextColor(75, 85, 99);
  //   doc.text(`Phone: ${phone}`, 120, currentY + 13);
  // }

  currentY += 30;

  // 3. ENTRIES TABLE
  doc.setFontSize(11);
  doc.setTextColor(99, 102, 241);
  doc.setFont('helvetica', 'bold');
  doc.text(`CREDIT ENTRIES (${entries.length})`, 14, currentY);
  
  currentY += 4;

  const tableColumn = ["#", "Date", "Description", "Phone", "Amount", "Paid", "Balance"];
  const tableRows = [];

  entries.forEach((e, index) => {
    const amt = Number(e.amount || 0);
    const paid = Number(e.paid_amount || 0);
    const bal = amt - paid;
    
    tableRows.push([
      index + 1,
      formatDate(e.entry_date),
      e.description + (e.service_type ? `\n(${e.service_type})` : ''),
      e.customer_phone || '-',
      amt > 0 ? amt.toFixed(2) : '-',
      paid > 0 ? paid.toFixed(2) : '-',
      bal > 0 ? bal.toFixed(2) : '✓'
    ]);
  });

  doc.autoTable({
    startY: currentY,
    head: [tableColumn],
    body: tableRows,
    theme: 'grid',
    styles: { 
      fontSize: 9,
      cellPadding: 3,
      valign: 'middle'
    },
    headStyles: { 
      fillColor: [99, 102, 241], 
      textColor: 255,
      fontStyle: 'bold'
    },
    alternateRowStyles: { 
      fillColor: [249, 250, 251] 
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 22 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 28 },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 24, halign: 'right', fontStyle: 'bold' }
    },
    didParseCell: function(data) {
      if (data.section === 'body' && data.column.index === 6) {
        data.cell.styles.textColor = [239, 68, 68];
      }
      if (data.section === 'body' && data.column.index === 5) {
        data.cell.styles.textColor = [16, 185, 129];
      }
      if (data.section === 'body' && data.column.index === 3) {
        data.cell.styles.textColor = [37, 211, 102];
      }
    }
  });

  let finalY = doc.lastAutoTable.finalY + 15;

  if (finalY > 250) {
    doc.addPage();
    finalY = 20;
  }

  // 4. TOTALS BLOCK
  const boxWidth = 90;
  const boxX = 196 - boxWidth;
  const boxHeight = 35;

  doc.setFillColor(243, 244, 246);
  doc.rect(boxX, finalY, boxWidth, boxHeight, 'F');
  doc.setDrawColor(229, 231, 235);
  doc.rect(boxX, finalY, boxWidth, boxHeight, 'S');

  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.setFont('helvetica', 'normal');
  
  doc.text('Total Amount:', boxX + 5, finalY + 8);
  doc.setTextColor(99, 102, 241);
  doc.setFont('helvetica', 'bold');
  doc.text(`PKR ${total.toFixed(2)}`, boxX + boxWidth - 5, finalY + 8, { align: 'right' });

  doc.setTextColor(75, 85, 99);
  doc.setFont('helvetica', 'normal');
  doc.text('Total Paid:', boxX + 5, finalY + 16);
  doc.setTextColor(16, 185, 129);
  doc.setFont('helvetica', 'bold');
  doc.text(`PKR ${totalPaid.toFixed(2)}`, boxX + boxWidth - 5, finalY + 16, { align: 'right' });

  doc.setDrawColor(99, 102, 241);
  doc.setLineWidth(0.5);
  doc.line(boxX + 5, finalY + 20, boxX + boxWidth - 5, finalY + 20);

  doc.setTextColor(31, 41, 55);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('BALANCE:', boxX + 5, finalY + 28);
  doc.setTextColor(239, 68, 68);
  doc.setFontSize(14);
  doc.text(`PKR ${totalBalance.toFixed(2)}`, boxX + boxWidth - 5, finalY + 28, { align: 'right' });

  // 5. FOOTER
  const pageHeight = doc.internal.pageSize.height;
  doc.setDrawColor(209, 213, 219);
  doc.setLineWidth(0.3);
  doc.setLineDash([2, 2], 0);
  doc.line(14, pageHeight - 25, 196, pageHeight - 25);

  doc.setFontSize(10);
  doc.setTextColor(99, 102, 241);
  doc.setFont('helvetica', 'bold');
  doc.text('Shukriya! Aapke business ke liye shukriya.', 105, pageHeight - 18, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.setFont('helvetica', 'normal');
  doc.text(`${shopName} — ${shopPhone}`, 105, pageHeight - 13, { align: 'center' });
  doc.text('This is a computer-generated document.', 105, pageHeight - 9, { align: 'center' });

  const filename = `Credit-Khata_${name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const blob = doc.output('blob');

  return { blob, filename, customerName: name, total, totalPaid, totalBalance };
}

// ============================================
// 📥 DOWNLOAD PDF
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