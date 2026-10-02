// ⚠️ YAHAN apna Supabase URL aur anon key daalein
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://pjipxxengfoumuloflwr.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqaXB4eGVuZ2ZvdW11bG9mbHdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NjMzMjEsImV4cCI6MjEwNjMzOTMyMX0.DP1-gYhMZfT2wm9rw0Wv4vD_tyIW55PqrP1eZ4Rt1T4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'invoice-app-auth'
  }
});