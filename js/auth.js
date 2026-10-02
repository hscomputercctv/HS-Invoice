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
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('authMsg');
  const btn = e.target.querySelector('button');
  btn.disabled = true;

  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;

  // 1) Login attempt
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error('LOGIN ERROR:', error);
    showMsg(msg, error.message, 'error');
    btn.disabled = false;
    return;
  }

  // 2) Profile fetch
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('role,is_active,full_name')
    .eq('id', data.user.id)
    .maybeSingle();  // 👈 single() ki jagah maybeSingle()

  console.log('Profile fetch:', { profile, pErr });

  if (pErr) {
    console.error('PROFILE ERROR:', pErr);
    showMsg(msg, 'Profile read error: ' + pErr.message, 'error');
    await supabase.auth.signOut();
    btn.disabled = false;
    return;
  }

  if (!profile) {
    showMsg(msg, 'Profile not found. Please contact admin.', 'error');
    await supabase.auth.signOut();
    btn.disabled = false;
    return;
  }

  // 3) Active check
// Sirf tab block karo jab explicitly false ho
if (profile.is_active === false) {
  showMsg(msg, 'Account inactive. Contact admin.', 'error');
  await supabase.auth.signOut();
  btn.disabled = false;
  return;
}

  // 4) Redirect by role
  const dest = profile.role === 'admin' ? 'admin.html' : 'worker.html';
  console.log('Redirecting to:', dest);
  window.location.href = dest;
});

// Signup
$('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('authMsg');
  const btn = e.target.querySelector('button');
  btn.disabled = true;

  const { data, error } = await supabase.auth.signUp({
    email: $('signupEmail').value.trim(),
    password: $('signupPassword').value,
    options: {
      data: {
        full_name: $('signupName').value.trim(),
        role: $('signupRole').value
      }
    }
  });

  if (error) {
    showMsg(msg, error.message, 'error');
    btn.disabled = false;
    return;
  }

  // Auto sign in if session available (email confirm disabled)
  if (data.session) {
    await redirectByRole(data.user.id);
  } else {
    showMsg(msg, 'Account created! Check email to confirm.', 'success');
    btn.disabled = false;
  }
});

async function redirectByRole(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id', userId)
    .single();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    showMsg($('authMsg'), 'Account inactive. Contact admin.', 'error');
    return;
  }
  window.location.href = profile.role === 'admin' ? 'admin.html' : 'worker.html';
}

// Auto-redirect if already logged in
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await redirectByRole(session.user.id);
})();