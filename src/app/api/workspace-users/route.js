import { getDb, getSession } from '@/lib/db';
import { getWorkspaceUsers } from '@/lib/users';
import { colorForName, COLOR_PALETTE } from '@/lib/taskBoard';
import { apiBadRequest, apiError, apiJson } from '@/lib/apiResponses';

/*
  The people in the CURRENT workspace, for the assign / notify pickers. This
  replaced the old free-text roster (/api/assignees) and address book
  (/api/saved-emails): everywhere you assign or notify a person, the options are
  now the workspace's real logins.

  Returned shape is a drop-in for the old assignee roster ({ name, color }) so
  the existing tag styling (getAssigneeInlineStyle) keeps working, plus the bits
  the pickers need to source email:

    { users: [{ id, name, email, hasEmail, color }] }

  `email`/`hasEmail` come from users.email (migration 039); before it is applied
  every user reads as hasEmail:false, so notify reports "email is not set up".

  Colours: each person gets a stable default colour hashed from their name, but a
  user can recolour anyone by clicking the swatch in the picker — those overrides
  are stored per-tenant in app_settings key `assignee_colors` ({ name: hex }).
*/

const COLORS_KEY = 'assignee_colors';

// Load the per-tenant colour overrides map ({ lowercased name: hex }). Missing /
// malformed rows just yield {} so colours fall back to the hashed default.
async function loadColorOverrides(supabase) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', COLORS_KEY)
    .single();
  if (error || !data) return {};
  const v = typeof data.value === 'string' ? safeParse(data.value) : data.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return apiError('Not authenticated', 401);
  }

  try {
    const supabase = await getDb();
    const [people, overrides] = await Promise.all([
      getWorkspaceUsers(session.tenantId),
      loadColorOverrides(supabase),
    ]);
    const users = people.map((u) => ({
      id: u.id,
      name: u.username,
      email: u.email || null,
      hasEmail: !!u.email,
      color: overrides[u.username.toLowerCase()] || colorForName(u.username),
    }));
    return apiJson({ users });
  } catch (e) {
    return apiError(e);
  }
}

// PUT — recolour one person. Body: { name, color }. Stored per-tenant so the tag
// colour is consistent everywhere that person is shown.
export async function PUT(req) {
  const session = await getSession();
  if (!session?.tenantId) {
    return apiError('Not authenticated', 401);
  }

  try {
    const { name, color } = await req.json();
    const person = String(name || '').trim();
    if (!person) return apiBadRequest('name is required');
    if (!COLOR_PALETTE.includes(color)) return apiBadRequest('color must be one of the palette values');

    const supabase = await getDb();
    const overrides = await loadColorOverrides(supabase);
    overrides[person.toLowerCase()] = color;

    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: COLORS_KEY, value: overrides }, { onConflict: 'tenant_id,key' });
    if (error) return apiError(error);

    return apiJson({ ok: true, name: person, color });
  } catch (e) {
    return apiError(e);
  }
}
