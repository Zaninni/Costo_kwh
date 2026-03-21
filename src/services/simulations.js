import { supabase, isSupabaseConfigured } from '../lib/supabase';

const TABLE = 'simulations';

function ensureSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase non configurato. Imposta VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.');
  }
}

function mapSimulation(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    formSnapshot: row.input_data,
    results: row.result_data,
    isPublic: row.is_public,
    savedAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'cloud',
  };
}

export async function fetchVisibleSimulations() {
  ensureSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapSimulation);
}

export async function createCloudSimulation({ title, formSnapshot, results, isPublic = false, ownerId }) {
  ensureSupabase();
  const payload = {
    owner_id: ownerId,
    title,
    input_data: formSnapshot,
    result_data: results,
    is_public: isPublic,
  };

  const { data, error } = await supabase.from(TABLE).insert(payload).select().single();
  if (error) throw error;
  return mapSimulation(data);
}

export async function updateCloudSimulation(id, updates) {
  ensureSupabase();
  const payload = {};
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.formSnapshot !== undefined) payload.input_data = updates.formSnapshot;
  if (updates.results !== undefined) payload.result_data = updates.results;
  if (updates.isPublic !== undefined) payload.is_public = updates.isPublic;

  const { data, error } = await supabase.from(TABLE).update(payload).eq('id', id).select().single();
  if (error) throw error;
  return mapSimulation(data);
}

export async function deleteCloudSimulation(id) {
  ensureSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
