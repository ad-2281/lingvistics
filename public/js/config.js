// public/js/config.js
// Configuration for Supabase URL and Anon Key.
// In CI/CD (GitHub Pages), this file is automatically written with repository secrets.
// In local development, you can override window.__ENV__ or update the fallback values below.

export const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || "https://xyzcompany.supabase.co";
export const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_anon_key";
