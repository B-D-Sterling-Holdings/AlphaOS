import { getDb } from '@/lib/db';
import { apiBadRequest, apiError, apiJson, apiOk, withApiError } from '@/lib/apiResponses';

// Key/value row in app_settings (RLS-scoped to the caller's tenant via getDb).
const STORAGE_KEY = 'fund-accounting-state';

// GET -> { value: string | null }  (value is the JSON-stringified accounting state)
export async function GET() {
  const supabase = await getDb();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', STORAGE_KEY)
    .single();

  // PostgREST returns an error when .single() finds no row — treat that as empty.
  if (error && error.code !== 'PGRST116') {
    return apiError(error);
  }
  return apiJson({ value: data?.value ?? null });
}

// PUT { value: string } -> upsert
export async function PUT(request) {
  return withApiError(async () => {
    const { value } = await request.json();
    if (typeof value !== 'string') {
      return apiBadRequest('value (string) is required');
    }

    const supabase = await getDb();
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: STORAGE_KEY, value }, { onConflict: 'tenant_id,key' });

    if (error) throw new Error(error.message);
    return apiOk();
  });
}
