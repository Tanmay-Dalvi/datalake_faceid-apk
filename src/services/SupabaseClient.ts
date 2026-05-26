/**
 * SupabaseClient
 * ---------------
 * Centralized Supabase client for cloud sync.
 * 
 * Free tier provides:
 *   - 500 MB PostgreSQL database
 *   - Unlimited API requests
 *   - 1 GB file storage
 *   - Real-time subscriptions
 *
 * Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
 * in your .env file to enable cloud sync.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const IS_SUPABASE_CONFIGURED =
  SUPABASE_URL.length > 0 &&
  SUPABASE_ANON_KEY.length > 0 &&
  SUPABASE_URL.startsWith('https://');

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!IS_SUPABASE_CONFIGURED) return null;

  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }

  return supabase;
}
