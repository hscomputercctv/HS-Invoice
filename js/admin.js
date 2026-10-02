import { supabase } from './supabase-config.js';
import { formatMoney, formatDate, requireAuth, escapeHtml, showMsg } from './utils.js';

const $ = (id) => document.getElementById(id);

let me = null;

// ============================================
// INIT
// ============================================
(async () => {
  const ctx = await requireAuth(supabase, 'admin');
  if (!ctx) return;
  me = ctx.profile;

  // ─── Logout ───
  $('logoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  // ─── Tabs ───
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('view-' + b.dataset.view).classList.add('active');
    });
  });

  // ─── New Invoice ───
  $('newInvoiceBtn').addEventListener('click', () => {
    window.location.href = 'invoice.html';
  });

  // ─── Load Everything ───
  await loadShopSettings();
  await loadOverview();
  await loadInvoices();
  await loadProducts();
  await loadWorkers();
  await loadPending();
  bindForms();
  setupLogoUpload();
})();

// ============================================
// OVERVIEW
// ============================================
async function loadOverview() {
  const { data: invoices } = await supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false });

  const all = invoices || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sales = all.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const todayCount = all.filter((i) => new Date(i.created_at) >= today).length;

  $('statSales').textContent = formatMoney(sales);
  $('statToday').textContent = todayCount;
  $('statTotal').textContent = all.length;

  // Active workers count
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'worker')
    .eq('is_active', true);
  $('statWorkers').textContent = count || 0;

  // Pending count (card)
  const { count: pendingCount } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', false);

  const pendingCard = $('pendingCard');
  if (pendingCard) {
    if (pendingCount > 0) {
      pendingCard.style.display = 'block';
      $('statPending').textContent = pendingCount;
    } else {
      pendingCard.style.display = 'none';
    }
  }

  // Recent invoices
  const tbody = $('recentTable').querySelector('tbody');
  tbody.innerHTML = all.slice(0, 8).map((i) => `
    <tr>
      <td>${escapeHtml(i.invoice_number)}</td>
      <td>${escapeHtml(i.customer_name)}</td>
      <td>${formatMoney(i.grand_total)}</td>
      <td>${escapeHtml(i.created_by_name || '-')}</td>
      <td>${formatDate(i.created_at)}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted">No invoices yet</td></tr>`;
}

// ============================================
// INVOICES
// ============================================
async function loadInvoices(filter = '') {
  const { data } = await supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false });

  const list = (data || []).filter((i) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (i.invoice_number || '').toLowerCase().includes(f) ||
           (i.customer_name || '').toLowerCase().includes(f);
  });

  const tbody = $('invoicesTable').querySelector('tbody');
  tbody.innerHTML = list.map((i) => `
    <tr>
      <td>${escapeHtml(i.invoice_number)}</td>
      <td>${escapeHtml(i.customer_name)}</td>
      <td>${formatMoney(i.grand_total)}</td>
      <td>${escapeHtml(i.created_by_name || '-')}</td>
      <td>${formatDate(i.created_at)}</td>
      <td>
        <button class="btn" onclick="window.location.href='invoice.html?id=${i.id}'">View</button>
        <button class="btn danger" data-del="${i.id}">Del</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">No invoices</td></tr>`;

  tbody.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this invoice?')) return;
      await supabase.from('invoices').delete().eq('id', b.dataset.del);
      await loadInvoices();
      await loadOverview();
    })
  );
}

$('invSearch')?.addEventListener('input', (e) => loadInvoices(e.target.value));

// ============================================
// PRODUCTS
// ============================================
async function loadProducts() {
  const { data } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  const tbody = $('productsTable').querySelector('tbody');
  tbody.innerHTML = (data || []).map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${formatMoney(p.price)}</td>
      <td>${p.tax_percent}%</td>
      <td>${p.stock}</td>
      <td><button class="btn danger" data-del="${p.id}">Delete</button></td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted">No products</td></tr>`;

  tbody.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete product?')) return;
      await supabase.from('products').delete().eq('id', b.dataset.del);
      loadProducts();
    })
  );
}

$('productForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: $('pName').value.trim(),
    price: parseFloat($('pPrice').value) || 0,
    tax_percent: parseFloat($('pTax').value) || 0,
    stock: parseInt($('pStock').value) || 0,
    created_by: me.id
  };
  const { error } = await supabase.from('products').insert(payload);
  if (error) return alert(error.message);
  e.target.reset();
  loadProducts();
});

// ============================================
// WORKERS (All users — active + pending)
// ============================================
async function loadWorkers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('role', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Load workers error:', error);
    return;
  }

  const users = data || [];
  const tbody = $('workersTable').querySelector('tbody');

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted)">
          Koi users nahi hain.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = users.map((u) => {
    const isMe = u.id === me.id;
    const isPending = !u.is_active;

    // Role cell
    let roleCell;
    if (isMe) {
      roleCell = `<span style="color:#f59e0b;font-weight:700">👑 Admin (You)</span>`;
    } else if (isPending) {
      roleCell = `<span style="color:#f59e0b;font-weight:600;font-size:12px">⏳ Pending</span>`;
    } else {
      roleCell = `
        <select class="role-select" data-id="${u.id}" 
          style="padding:6px 10px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--text);font-size:13px">
          <option value="worker" ${u.role === 'worker' ? 'selected' : ''}>👤 Worker</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>👑 Admin</option>
        </select>`;
    }

    const rowStyle = isPending
      ? 'style="background:rgba(245,158,11,0.08);opacity:0.85"'
      : '';

    return `
      <tr data-user-id="${u.id}" ${rowStyle}>
        <td>
          <strong>${escapeHtml(u.full_name || 'Unknown')}</strong>
          ${isMe ? '<span style="color:#6366f1;font-size:11px;margin-left:4px">(You)</span>' : ''}
        </td>
        <td>${escapeHtml(u.email)}</td>
        <td>${roleCell}</td>
        <td>
          <div class="toggle ${u.can_view_sales ? 'on' : ''}" 
               data-perm="can_view_sales" data-id="${u.id}"
               ${isPending ? 'style="pointer-events:none;opacity:0.5"' : ''}></div>
        </td>
        <td>
          <div class="toggle ${u.can_create_invoice ? 'on' : ''}" 
               data-perm="can_create_invoice" data-id="${u.id}"
               ${isPending ? 'style="pointer-events:none;opacity:0.5"' : ''}></div>
        </td>
        <td>
          <div class="toggle ${u.can_manage_products ? 'on' : ''}" 
               data-perm="can_manage_products" data-id="${u.id}"
               ${isPending ? 'style="pointer-events:none;opacity:0.5"' : ''}></div>
        </td>
        <td>
          ${isPending
            ? `<button class="btn" data-approve="${u.id}" 
                 style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:6px 12px;min-height:auto;font-size:12px">
                 ✅ Approve
               </button>`
            : `<div class="toggle ${u.is_active ? 'on' : ''}" 
                 data-perm="is_active" data-id="${u.id}"></div>`
          }
        </td>
        <td>
          ${!isMe
            ? `<button class="btn danger" 
                 style="padding:6px 10px;min-height:auto;font-size:12px" 
                 data-del-user="${u.id}">
                 🗑 Delete
               </button>`
            : ''
          }
        </td>
      </tr>`;
  }).join('');

  // ─── Permission Toggles ───
  tbody.querySelectorAll('.toggle').forEach((t) => {
    t.addEventListener('click', async () => {
      const id = t.dataset.id;
      const perm = t.dataset.perm;
      const newVal = !t.classList.contains('on');

      const { error } = await supabase
        .from('profiles')
        .update({ [perm]: newVal })
        .eq('id', id);

      if (error) {
        alert('❌ ' + error.message);
        return;
      }
      t.classList.toggle('on', newVal);
    });
  });

  // ─── Role Change Dropdown ───
  tbody.querySelectorAll('.role-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      const newRole = e.target.value;
      const row = tbody.querySelector(`tr[data-user-id="${id}"]`);
      const userName = row.querySelector('strong').textContent;

      if (!confirm(`"${userName}" ka role "${newRole}" kar dein?`)) {
        e.target.value = newRole === 'admin' ? 'worker' : 'admin';
        return;
      }

      // Last admin check
      if (newRole === 'worker') {
        const { count } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('is_active', true);

        if (count <= 1) {
          alert('⚠️ Kam se kam ek admin hona chahiye!');
          e.target.value = 'admin';
          return;
        }
      }

      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', id);

      if (error) {
        alert('❌ ' + error.message);
        e.target.value = newRole === 'admin' ? 'worker' : 'admin';
        return;
      }

      alert(`✅ Role "${newRole}" set ho gaya!`);
      await loadWorkers();
    });
  });

  // ─── Approve Button ───
  tbody.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.approve;
      const row = tbody.querySelector(`tr[data-user-id="${id}"]`);
      const userName = row.querySelector('strong').textContent;

      if (!confirm(`"${userName}" ko approve karein?\n\nAb wo login kar sake ga.`)) return;

      btn.disabled = true;
      btn.textContent = '⏳...';

      const { error } = await supabase
        .from('profiles')
        .update({ is_active: true })
        .eq('id', id);

      if (error) {
        alert('❌ ' + error.message);
        btn.disabled = false;
        btn.textContent = '✅ Approve';
        return;
      }

      alert(`✅ "${userName}" approve ho gaya!`);
      await loadWorkers();
      await loadPending();
      await loadOverview();
    });
  });

  // ─── Delete User ───
  tbody.querySelectorAll('[data-del-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delUser;
      const row = tbody.querySelector(`tr[data-user-id="${id}"]`);
      const userName = row.querySelector('strong').textContent;

      if (!confirm(`"${userName}" ko delete karein?\n\nNote: Ye sirf profile delete karega. Auth user ko Supabase Dashboard se delete karna padega.`)) return;

      btn.disabled = true;
      btn.textContent = '⏳...';

      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', id);

      if (error) {
        alert('❌ ' + error.message);
        btn.disabled = false;
        btn.textContent = '🗑 Delete';
        return;
      }

      alert(`✅ "${userName}" delete ho gaya.`);
      await loadWorkers();
      await loadPending();
      await loadOverview();
    });
  });
}

// ============================================
// SETTINGS
// ============================================
async function loadShopSettings() {
  $('shopName').value = me.shop_name || 'H.S Computers & CCTV';
  $('shopPhone').value = me.shop_phone || '';
  $('shopEmail').value = me.shop_email || '';
  $('shopGstin').value = me.shop_gstin || '';
  $('shopAddress').value = me.shop_address || '';

  if (me.shop_logo_url) {
    showLogoPreview(me.shop_logo_url);
  }
}

function bindForms() {
  $('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await supabase
      .from('profiles')
      .update({
        shop_name: $('shopName').value,
        shop_phone: $('shopPhone').value,
        shop_email: $('shopEmail').value,
        shop_gstin: $('shopGstin').value,
        shop_address: $('shopAddress').value
      })
      .eq('id', me.id);

    if (error) return alert(error.message);
    alert('✅ Settings saved');
  });
}

// ============================================
// LOGO UPLOAD
// ============================================
function showLogoPreview(url) {
  const preview = $('logoPreview');
  const removeBtn = $('logoRemoveBtn');
  if (!preview) return;

  preview.innerHTML = `<img src="${url}" alt="Shop Logo" />`;
  preview.classList.add('has-logo');
  if (removeBtn) removeBtn.style.display = 'inline-flex';
}

function clearLogoPreview() {
  const preview = $('logoPreview');
  const removeBtn = $('logoRemoveBtn');
  if (!preview) return;

  preview.innerHTML = `<span class="logo-placeholder">📷</span>`;
  preview.classList.remove('has-logo');
  if (removeBtn) removeBtn.style.display = 'none';
}

async function uploadLogo(file) {
  if (!file) return;

  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    alert('❌ Sirf PNG, JPG ya WEBP file allowed hai');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    alert('❌ File size 2 MB se kam hona chahiye');
    return;
  }

  const preview = $('logoPreview');
  preview?.classList.add('uploading');

  try {
    const ext = file.name.split('.').pop().toLowerCase();
    const fileName = `${me.id}/logo-${Date.now()}.${ext}`;

    // Purana delete
    if (me.shop_logo_url) {
      try {
        const oldPath = me.shop_logo_url.split('/shop-assets/')[1];
        if (oldPath) {
          await supabase.storage.from('shop-assets').remove([oldPath]);
        }
      } catch (e) {
        console.warn('Old logo delete failed:', e);
      }
    }

    // Naya upload
    const { error } = await supabase.storage
      .from('shop-assets')
      .upload(fileName, file, { cacheControl: '3600', upsert: true });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from('shop-assets')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    const { error: dbError } = await supabase
      .from('profiles')
      .update({ shop_logo_url: publicUrl })
      .eq('id', me.id);

    if (dbError) throw dbError;

    me.shop_logo_url = publicUrl;
    showLogoPreview(publicUrl);
    alert('✅ Logo upload ho gaya!');
  } catch (err) {
    console.error('Logo upload error:', err);
    alert('❌ Upload failed: ' + err.message);
  } finally {
    preview?.classList.remove('uploading');
  }
}

async function removeLogo() {
  if (!confirm('Logo remove karna hai?')) return;

  try {
    if (me.shop_logo_url) {
      const oldPath = me.shop_logo_url.split('/shop-assets/')[1];
      if (oldPath) {
        await supabase.storage.from('shop-assets').remove([oldPath]);
      }
    }

    await supabase
      .from('profiles')
      .update({ shop_logo_url: '' })
      .eq('id', me.id);

    me.shop_logo_url = '';
    clearLogoPreview();
    alert('✅ Logo removed');
  } catch (err) {
    console.error(err);
    alert('❌ ' + err.message);
  }
}

function setupLogoUpload() {
  const uploadBtn = $('logoUploadBtn');
  const input = $('logoInput');
  const removeBtn = $('logoRemoveBtn');

  uploadBtn?.addEventListener('click', () => input?.click());

  input?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadLogo(file);
    e.target.value = '';
  });

  removeBtn?.addEventListener('click', removeLogo);
}

// ============================================
// PENDING APPROVALS
// ============================================
async function loadPending() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_active', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Load pending error:', error);
    return;
  }

  const pending = data || [];
  const tbody = $('pendingTable')?.querySelector('tbody');
  const countBadge = $('pendingCount');
  const pendingTab = $('pendingTab');

  if (!tbody) return;

  // Badge update
  if (pending.length > 0) {
    if (countBadge) {
      countBadge.textContent = pending.length;
      countBadge.style.display = 'inline-block';
    }
    if (pendingTab) pendingTab.style.color = '#f59e0b';
  } else {
    if (countBadge) countBadge.style.display = 'none';
    if (pendingTab) pendingTab.style.color = '';
  }

  if (pending.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted)">
          ✨ Koi pending approval nahi hai. Sab users active hain.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = pending.map((u) => `
    <tr data-user-id="${u.id}">
      <td><strong>${escapeHtml(u.full_name || 'Unknown')}</strong></td>
      <td>${escapeHtml(u.email)}</td>
      <td>${formatDate(u.created_at)}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-approve="${u.id}" 
          style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:8px 14px;min-height:auto;font-size:13px">
          ✅ Approve
        </button>
        <button class="btn danger" data-reject="${u.id}"
          style="padding:8px 14px;min-height:auto;font-size:13px">
          ❌ Reject
        </button>
      </td>
    </tr>
  `).join('');

  // Approve handlers
  tbody.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.approve;
      const row = tbody.querySelector(`tr[data-user-id="${id}"]`);
      const userName = row.querySelector('strong').textContent;

      if (!confirm(`"${userName}" ko approve karein?\n\nIske baad wo login kar sakta hai.`)) return;

      btn.disabled = true;
      btn.textContent = '⏳ Approving...';

      const { error } = await supabase
        .from('profiles')
        .update({ is_active: true })
        .eq('id', id);

      if (error) {
        alert('❌ ' + error.message);
        btn.disabled = false;
        btn.textContent = '✅ Approve';
        return;
      }

      alert(`✅ "${userName}" approve ho gaya!`);
      await loadPending();
      await loadWorkers();
      await loadOverview();
    });
  });

  // Reject handlers
  tbody.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.reject;
      const row = tbody.querySelector(`tr[data-user-id="${id}"]`);
      const userName = row.querySelector('strong').textContent;

      if (!confirm(`"${userName}" ko reject karein?\n\nProfile delete ho jayegi. Auth user Supabase Dashboard se delete karna padega.`)) return;

      btn.disabled = true;
      btn.textContent = '⏳ Rejecting...';

      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', id);

      if (error) {
        alert('❌ ' + error.message);
        btn.disabled = false;
        btn.textContent = '❌ Reject';
        return;
      }

      alert(`❌ "${userName}" reject ho gaya.`);
      await loadPending();
      await loadWorkers();
    });
  });
}