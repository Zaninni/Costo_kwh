import { mapDbRowToEntry } from '../lib/calculations';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const TABLE = 'tariffs';

function ensureSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase non configurato. Imposta VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.');
  }
}

export async function fetchOwnerTariffs(ownerId) {
  ensureSupabase();
  const { data, error } = await supabase.from(TABLE).select('*').eq('owner_id', ownerId).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => mapDbRowToEntry(row, 'cloud'));
}

export async function upsertCloudTariff(entry, ownerId) {
  ensureSupabase();
  const payload = {
    id: entry.id,
    owner_id: ownerId,
    saved_at: entry.savedAt,
    title: entry.title,
    reference_period: entry.referencePeriod,
    form_snapshot: entry.formSnapshot,
    results: entry.results,
  };

  const { data, error } = await supabase.from(TABLE).upsert(payload, { onConflict: 'id' }).select().single();
  if (error) throw error;
  return mapDbRowToEntry(data, 'cloud');
}

export async function deleteCloudTariff(id, ownerId) {
  ensureSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', id).eq('owner_id', ownerId);
  if (error) throw error;
}
