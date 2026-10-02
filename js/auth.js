import { supabase } from './supabase-config.js';
import { showMsg } from './utils.js';

const $ = (id) => document.getElementById(id);

// Tabs
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const target = t.dataset.tab;
    $('loginForm').classList.toggle('hidden', target !== 'login');
    $('signupForm').classList.toggle('hidden', target !== 'signup');
  });
});

// Login
// Login
loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('authMsg');
  const btn = loginForm.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Signing in...';

  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;

  // 1) Supabase login
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    showMsg(msg, error.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }

  // 2) Profile fetch
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profile) {
    showMsg(msg, 'Profile nahi mila. Admin se contact karein.', 'error');
    await supabase.auth.signOut();
    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }

  // 3) ⭐ APPROVAL CHECK
  if (!profile.is_active) {
    showMsg(
      msg,
      '⏳ Aapka account approval ka intezaar kar raha hai. Admin approve karne ke baad aap login kar sakte hain.',
      'error'
    );
    await supabase.auth.signOut();
    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }

  // 4) Success → redirect based on role
  showMsg(msg, '✅ Login success!', 'success');

  setTimeout(() => {
    window.location.href = profile.role === 'admin' ? 'admin.html' :
      profile.role === 'technician' ? 'technician.html' :
        'worker.html';;
  }, 500);
});

// Signup
signupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('authMsg');
  const btn = signupForm.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Creating account...';

  const fullName = $('signupName').value.trim();
  const email = $('signupEmail').value.trim();
  const password = $('signupPassword').value;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: 'worker'        // Hamesha worker
      }
    }
  });

  if (error) {
    showMsg(msg, error.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }

  // Signup success — ab login NAHI karna, approval ka wait
  showMsg(
    msg,
    '✅ Account banaya gaya! Admin approval ke baad aap login kar sakte hain. Aapko WhatsApp/call pe bataya jayega.',
    'success'
  );

  // Sign out (auto-login nahi karna)
  await supabase.auth.signOut();

  btn.disabled = false;
  btn.textContent = originalText;

  // 3 sec baad login tab pe switch karo
  setTimeout(() => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab[data-tab="login"]')?.classList.add('active');
    $('loginForm')?.classList.remove('hidden');
    $('signupForm')?.classList.add('hidden');
  }, 2500);
});

// Auto-redirect if logged in
(async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', session.user.id)
      .maybeSingle();

    if (!profile) {
      await supabase.auth.signOut();
      return;
    }

    // ⭐ Inactive user ko logout karo
    if (!profile.is_active) {
      await supabase.auth.signOut();
      return;
    }

    window.location.href =     profile.role === 'admin' ? 'admin.html' :
    profile.role === 'technician' ? 'technician.html' :
    'worker.html';
  } catch (err) {
    console.error('Auto-redirect error:', err);
  }
})();