import { supabase } from './supabase-config.js';
import { showMsg } from './utils.js';

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = $('loginForm');

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('authMsg');
    const btn = $('loginBtn');
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
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    if (pErr || !profile) {
      showMsg(msg, 'Profile not found. Contact admin.', 'error');
      await supabase.auth.signOut();
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    // 3) Active check
    if (profile.is_active === false) {
      showMsg(msg, 'Account inactive. Contact admin.', 'error');
      await supabase.auth.signOut();
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    // 4) Redirect based on role
    showMsg(msg, '✅ Login success! Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = profile.role === 'admin' ? 'admin.html' : (profile.role === 'technician' ? 'technician.html' : 'worker.html');
    }, 500);
  });
});