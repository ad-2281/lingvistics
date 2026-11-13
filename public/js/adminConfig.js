// public/js/adminConfig.js
// Admin-only global configurations: registration validation gate & role assignment.

import { supabase } from './supabaseClient.js';

/**
 * Fetches the current app config from public.app_config
 */
export async function getAppConfigData() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('app_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    console.error("Error fetching app config:", error);
    return null;
  }
  return data;
}

/**
 * Updates the require_admin_validation flag in app_config
 */
export async function updateRequireAdminValidation(requiresValidation) {
  if (!supabase) throw new Error("Supabase client not initialized");
  const { data, error } = await supabase
    .from('app_config')
    .update({ 
      require_admin_validation: requiresValidation,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Updates a user's role (Admin-only privilege enforced by DB trigger)
 */
export async function updateUserRole(userId, newRole) {
  if (!supabase) throw new Error("Supabase client not initialized");
  const { data, error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Updates a user's account status ('approved' or 'rejected')
 */
export async function updateUserStatus(userId, newStatus) {
  if (!supabase) throw new Error("Supabase client not initialized");
  const { data, error } = await supabase
    .from('profiles')
    .update({ status: newStatus })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
