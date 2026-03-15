const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');

const ALLOWED_ROLES = new Set(['admin', 'employee']);
const ALLOWED_STATUSES = new Set(['active', 'inactive', 'on_leave']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function ensureRole(role) {
  if (!ALLOWED_ROLES.has(role)) {
    throw new AppError('role must be admin or employee', 422);
  }
}

function ensureStatus(status) {
  if (!ALLOWED_STATUSES.has(status)) {
    throw new AppError('status must be active, inactive, or on_leave', 422);
  }
}

function buildProfilePayload(id, payload, existingProfile = {}) {
  const status = payload.status || existingProfile.status || 'active';
  const isActive = typeof payload.is_active === 'boolean' ? payload.is_active : status !== 'inactive';

  return {
    id,
    full_name: normalizeText(payload.full_name || existingProfile.full_name),
    email: normalizeEmail(payload.email || existingProfile.email),
    role: payload.role || existingProfile.role || 'employee',
    is_active: isActive,
    employee_code: normalizeOptionalText(payload.employee_code ?? existingProfile.employee_code),
    phone: normalizeOptionalText(payload.phone ?? existingProfile.phone),
    department: normalizeOptionalText(payload.department ?? existingProfile.department),
    position: normalizeOptionalText(payload.position ?? existingProfile.position),
    status,
  };
}

async function findProfileById(id) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data;
}

async function assertUniqueProfileFields({ email, employee_code, excludeId = null }) {
  const supabaseAdmin = getSupabaseAdmin();

  if (email) {
    let query = supabaseAdmin.from('profiles').select('id').eq('email', normalizeEmail(email));
    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      throw new AppError(error.message, 500);
    }
    if (data) {
      throw new AppError('An employee with this email already exists', 409);
    }
  }

  if (employee_code) {
    let query = supabaseAdmin.from('profiles').select('id').eq('employee_code', normalizeText(employee_code));
    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      throw new AppError(error.message, 500);
    }
    if (data) {
      throw new AppError('An employee with this employee code already exists', 409);
    }
  }
}

function mapAdminMetadata(profilePayload) {
  return {
    full_name: profilePayload.full_name,
    role: profilePayload.role,
    employee_code: profilePayload.employee_code,
    phone: profilePayload.phone,
    department: profilePayload.department,
    position: profilePayload.position,
    status: profilePayload.status,
    is_active: profilePayload.is_active,
  };
}

async function createEmployee(payload) {
  const supabaseAdmin = getSupabaseAdmin();
  const email = normalizeEmail(payload.email);
  const role = payload.role || 'employee';
  const status = payload.status || 'active';
  const fullName = normalizeText(payload.full_name);

  ensureRole(role);
  ensureStatus(status);

  if (!fullName) {
    throw new AppError('full_name is required', 422);
  }

  await assertUniqueProfileFields({
    email,
    employee_code: payload.employee_code,
  });

  const baseProfile = buildProfilePayload('00000000-0000-0000-0000-000000000000', {
    ...payload,
    email,
    full_name: fullName,
    role,
    status,
  });

  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: payload.password,
    email_confirm: true,
    user_metadata: mapAdminMetadata(baseProfile),
  });

  if (createError) {
    throw new AppError(createError.message, 400);
  }

  const userId = createdUser?.user?.id;

  if (!userId) {
    throw new AppError('Supabase did not return the created user', 500);
  }

  const profilePayload = buildProfilePayload(userId, {
    ...payload,
    email,
    full_name: fullName,
    role,
    status,
  });

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' });

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    throw new AppError(profileError.message, 400);
  }

  return findProfileById(userId);
}

async function updateEmployee(id, payload, actorProfile) {
  if (actorProfile.id === id && payload.role && payload.role !== 'admin') {
    throw new AppError('You cannot remove your own admin access', 400);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const existingProfile = await findProfileById(id);

  if (!existingProfile) {
    throw new AppError('Employee not found', 404);
  }

  const nextRole = payload.role || existingProfile.role;
  const nextStatus = payload.status || existingProfile.status;
  ensureRole(nextRole);
  ensureStatus(nextStatus);

  const nextEmail = payload.email ? normalizeEmail(payload.email) : existingProfile.email;
  const nextEmployeeCode = payload.employee_code ?? existingProfile.employee_code;

  await assertUniqueProfileFields({
    email: nextEmail,
    employee_code: nextEmployeeCode,
    excludeId: id,
  });

  const profilePayload = buildProfilePayload(id, {
    ...existingProfile,
    ...payload,
    email: nextEmail,
    role: nextRole,
    status: nextStatus,
  }, existingProfile);

  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
    email: profilePayload.email,
    user_metadata: mapAdminMetadata(profilePayload),
  });

  if (authError) {
    throw new AppError(authError.message, 400);
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update(profilePayload)
    .eq('id', id);

  if (profileError) {
    throw new AppError(profileError.message, 400);
  }

  return findProfileById(id);
}

async function resetEmployeePassword(id, password) {
  const supabaseAdmin = getSupabaseAdmin();
  const existingProfile = await findProfileById(id);

  if (!existingProfile) {
    throw new AppError('Employee not found', 404);
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
  if (error) {
    throw new AppError(error.message, 400);
  }

  return existingProfile;
}

async function toggleEmployeeStatus(id, actorProfile) {
  const supabaseAdmin = getSupabaseAdmin();
  const existingProfile = await findProfileById(id);

  if (!existingProfile) {
    throw new AppError('Employee not found', 404);
  }

  if (actorProfile.id === id && existingProfile.is_active) {
    throw new AppError('You cannot deactivate your own account', 400);
  }

  const nextIsActive = !existingProfile.is_active;
  const nextStatus = nextIsActive ? 'active' : 'inactive';

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({
      is_active: nextIsActive,
      status: nextStatus,
    })
    .eq('id', id);

  if (profileError) {
    throw new AppError(profileError.message, 400);
  }

  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
    user_metadata: {
      ...mapAdminMetadata({
        ...existingProfile,
        is_active: nextIsActive,
        status: nextStatus,
      }),
    },
  });

  if (authError) {
    throw new AppError(authError.message, 400);
  }

  return findProfileById(id);
}

async function deleteEmployee(id, actorProfile) {
  const supabaseAdmin = getSupabaseAdmin();
  const existingProfile = await findProfileById(id);

  if (!existingProfile) {
    throw new AppError('Employee not found', 404);
  }

  if (actorProfile.id === id) {
    throw new AppError('You cannot delete your own account', 400);
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    throw new AppError(error.message, 400);
  }
}

module.exports = {
  createEmployee,
  deleteEmployee,
  findProfileById,
  resetEmployeePassword,
  toggleEmployeeStatus,
  updateEmployee,
};

