export const formatMoney = (n) =>
  'RS ' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const formatDate = (d) => {
  const dt = d ? new Date(d) : new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};

export const showMsg = (el, text, type = 'error') => {
  el.textContent = text;
  el.className = 'msg ' + type;
  if (type === 'success') setTimeout(() => (el.className = 'msg'), 2500);
};

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const generateInvoiceNumber = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const r = Math.floor(1000 + Math.random() * 9000);
  return `INV-${y}${m}${d}-${r}`;
};

export const requireAuth = async (supabase, expectedRole = null) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (!profile) { await supabase.auth.signOut(); window.location.href = 'index.html'; return null; }

  if (expectedRole && profile.role !== expectedRole) {
    window.location.href = profile.role === 'admin' ? 'admin.html' : 'worker.html';
    return null;
  }
  return { session, profile };
};