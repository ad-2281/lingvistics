// public/js/supabaseClient.js
// Singleton Supabase Client instance initialized with URL and Anon Key.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;

try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (err) {
  console.error("Failed to initialize Supabase client:", err);
}

export const supabase = client;
