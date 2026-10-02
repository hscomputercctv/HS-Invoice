import { supabase } from './supabase-config.js';
import { formatMoney, formatDate, requireAuth, escapeHtml, showMsg } from './utils.js';

const $ = (id) => document.getElementById(id);

let me = null;

// ---------- INIT ----------
(async () => {
  const ctx = await requireAuth(supabase, 'admin');
  if (!ctx) return;
  me = ctx.profile;

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

  $('newInvoiceBtn').addEventListener('click', () => (window.location.href = 'invoice.html'));

  await loadShopSettings();
  await loadOverview();
  await loadInvoices();
  await loadProducts();
  await loadWorkers();
  bindForms();
  setupLogoUpload();

})();

// ---------- OVERVIEW ----------
async function loadOverview() {
  const { data: invoices } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });

  const all = invoices || [];
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const sales = all.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const todayCount = all.filter((i) => new Date(i.created_at) >= today).length;

  $('statSales').textContent = formatMoney(sales);
  $('statToday').textContent = todayCount;
  $('statTotal').textContent = all.length;

  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'worker')
    .eq('is_active', true);
  $('statWorkers').textContent = count || 0;

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

// ---------- INVOICES ----------
async function loadInvoices(filter = '') {
  const { data } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
  const list = (data || []).filter((i) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return i.invoice_number.toLowerCase().includes(f) || i.customer_name.toLowerCase().includes(f);
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
      await loadInvoices(); await loadOverview();
    })
  );
}

$('invSearch')?.addEventListener('input', (e) => loadInvoices(e.target.value));

// ---------- PRODUCTS ----------
async function loadProducts() {
  const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false });
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

// ---------- WORKERS ----------
async function loadWorkers() {
  const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
  const tbody = $('workersTable').querySelector('tbody');

  tbody.innerHTML = (data || []).map((u) => `
    <tr>
      <td>${escapeHtml(u.full_name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${u.role}</td>
      <td><div class="toggle ${u.can_view_sales ? 'on' : ''}" data-perm="can_view_sales" data-id="${u.id}"></div></td>
      <td><div class="toggle ${u.can_create_invoice ? 'on' : ''}" data-perm="can_create_invoice" data-id="${u.id}"></div></td>
      <td><div class="toggle ${u.can_manage_products ? 'on' : ''}" data-perm="can_manage_products" data-id="${u.id}"></div></td>
      <td><div class="toggle ${u.is_active ? 'on' : ''}" data-perm="is_active" data-id="${u.id}"></div></td>
      <td>${u.id === me.id ? '(you)' : ''}</td>
    </tr>`).join('');

  tbody.querySelectorAll('.toggle').forEach((t) => {
    t.addEventListener('click', async () => {
      const id = t.dataset.id, perm = t.dataset.perm;
      const val = !t.classList.contains('on');
      const { error } = await supabase.from('profiles').update({ [perm]: val }).eq('id', id);
      if (error) return alert(error.message);
      t.classList.toggle('on', val);
    });
  });
}

// ---------- SETTINGS ----------
async function loadShopSettings() {
  $('shopName').value = me.shop_name || '';
  $('shopPhone').value = me.shop_phone || '';
  $('shopEmail').value = me.shop_email || '';
  $('shopGstin').value = me.shop_gstin || '';
  $('shopAddress').value = me.shop_address || '';

  // Logo load karo
  if (me.shop_logo_url) {
    showLogoPreview(me.shop_logo_url);
  }
}

function bindForms() {
  $('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('profiles').update({
      shop_name: $('shopName').value,
      shop_phone: $('shopPhone').value,
      shop_email: $('shopEmail').value,
      shop_gstin: $('shopGstin').value,
      shop_address: $('shopAddress').value
    }).eq('id', me.id);

    if (error) return alert(error.message);
    alert('Settings saved ✔');
  });
}


// ============================================
// LOGO UPLOAD
// ============================================
function showLogoPreview(url) {
  const preview = $('logoPreview');
  const removeBtn = $('logoRemoveBtn');

  preview.innerHTML = `<img src="${url}" alt="Shop Logo" />`;
  preview.classList.add('has-logo');
  if (removeBtn) removeBtn.style.display = 'inline-flex';
}

function clearLogoPreview() {
  const preview = $('logoPreview');
  const removeBtn = $('logoRemoveBtn');

  preview.innerHTML = `<span class="logo-placeholder">📷</span>`;
  preview.classList.remove('has-logo');
  if (removeBtn) removeBtn.style.display = 'none';
}

async function uploadLogo(file) {
  // Validate
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
  preview.classList.add('uploading');

  try {
    // File path banao (user ID + timestamp for uniqueness)
    const ext = file.name.split('.').pop().toLowerCase();
    const fileName = `${me.id}/logo-${Date.now()}.${ext}`;

    // Purana logo delete karo (agar hai)
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

    // Naya upload karo
    const { data, error } = await supabase.storage
      .from('shop-assets')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) throw error;

    // Public URL lo
    const { data: urlData } = supabase.storage
      .from('shop-assets')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // Database me save karo
    const { error: dbError } = await supabase
      .from('profiles')
      .update({ shop_logo_url: publicUrl })
      .eq('id', me.id);

    if (dbError) throw dbError;

    // Update local state
    me.shop_logo_url = publicUrl;

    // Show preview
    showLogoPreview(publicUrl);

    alert('✅ Logo upload ho gaya!');

  } catch (err) {
    console.error('Logo upload error:', err);
    alert('❌ Upload failed: ' + err.message);
  } finally {
    preview.classList.remove('uploading');
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

// Event bindings — jab page load ho
function setupLogoUpload() {
  const uploadBtn = $('logoUploadBtn');
  const input = $('logoInput');
  const removeBtn = $('logoRemoveBtn');

  uploadBtn?.addEventListener('click', () => input?.click());

  input?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadLogo(file);
    e.target.value = ''; // reset so same file dobara select ho sake
  });

  removeBtn?.addEventListener('click', removeLogo);
}