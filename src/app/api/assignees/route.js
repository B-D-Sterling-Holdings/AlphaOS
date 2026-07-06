import { getDb } from '@/lib/db';
import { apiBadRequest, apiError, apiJson, withApiError } from '@/lib/apiResponses';

const TABLE = 'app_settings';

function getKey(boardId) {
  return boardId && boardId !== 'default' ? `assignees_${boardId}` : 'assignees';
}

// GET - load saved assignees [{name, color}] for a board
export async function GET(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const boardId = searchParams.get('board_id') || 'default';
  const key = getKey(boardId);

  return withApiError(async () => {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('key', key)
      .single();

    if (error && error.code === 'PGRST116') {
      return apiJson({ assignees: [] });
    }
    if (error) {
      return apiError(error);
    }

    let assignees = [];
    try {
      assignees = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    } catch {
      assignees = [];
    }

    return apiJson({ assignees: Array.isArray(assignees) ? assignees : [] });
  });
}

// PUT - save assignees list for a board
export async function PUT(req) {
  const supabase = await getDb();
  return withApiError(async () => {
    const { assignees, board_id } = await req.json();
    const key = getKey(board_id || 'default');

    if (!Array.isArray(assignees)) {
      return apiBadRequest('assignees must be an array');
    }

    const row = {
      key,
      value: JSON.stringify(assignees),
    };

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: 'tenant_id,key' })
      .select()
      .single();

    if (error) {
      return apiError(error);
    }

    let saved = [];
    try {
      saved = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    } catch {
      saved = assignees;
    }

    return apiJson({ assignees: saved });
  });
}
