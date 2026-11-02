import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const envPath = path.join(root, '.env.permission-test.local');

if (!fs.existsSync(envPath)) {
  console.error('FALHA: .env.permission-test.local não encontrado.');
  process.exit(2);
}

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const baseUrl = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.VITE_SUPABASE_ANON_KEY || '';

let parsed;
try {
  parsed = new URL(baseUrl);
} catch {
  console.error('FALHA: URL local ausente ou inválida.');
  process.exit(2);
}

if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || parsed.port !== '55321') {
  console.error(`BLOQUEADO: esperado Supabase local na porta 55321; detectado: ${parsed.origin}`);
  process.exit(2);
}

if (!apiKey) {
  console.error('FALHA: chave pública local ausente.');
  process.exit(2);
}

const password = process.env.PERMISSION_SANDBOX_PASSWORD || 'LocalPermissao!2026';

const expectedProfiles = [
  { email: 'admin-permissoes@local.test', role: 'administrador' },
  { email: 'rafael-permissoes@local.test', role: 'apoio' },
  { email: 'producao-permissoes@local.test', role: 'producao' },
  { email: 'visualizador-permissoes@local.test', role: 'visualizador' },
  { email: 'lideranca-permissoes@local.test', role: 'lideranca' },
];

const nonAdminProfiles = expectedProfiles.filter((profile) => profile.role !== 'administrador');
const failures = [];
let passed = 0;

function report(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(name);
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function request(route, { method = 'GET', token = null, body = undefined } = {}) {
  const headers = { apikey: apiKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { response, data, text };
}

function errorText(result) {
  const data = result.data;
  if (typeof data === 'string') return data;
  return [data?.message, data?.details, data?.hint, data?.code]
    .filter(Boolean)
    .join(' | ');
}

async function login(email) {
  const result = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });

  if (!result.response.ok || !result.data?.access_token || !result.data?.user?.id) {
    throw new Error(`login de teste ${email} falhou: HTTP ${result.response.status}; ${errorText(result)}`);
  }

  return { token: result.data.access_token, user: result.data.user };
}

try {
  console.log(`Sandbox alvo: ${parsed.origin}`);
  console.log('Perfis verificados: Administrador, Apoio, Produção, Visualizador e Liderança.');
  console.log('Chamadas de escrita não administrativas usam payloads vazios e devem ser recusadas.');

  const admin = await login('admin-permissoes@local.test');
  report('login do Administrador local', admin.user.email === 'admin-permissoes@local.test');

  const userList = await request('/rest/v1/rpc/permission_test_list_users', {
    method: 'POST',
    token: admin.token,
    body: {},
  });

  if (!userList.response.ok || !Array.isArray(userList.data)) {
    throw new Error(`listagem local de usuários falhou: HTTP ${userList.response.status}; ${errorText(userList)}`);
  }

  const profiles = new Map(userList.data.map((profile) => [profile.email, profile]));

  for (const expected of expectedProfiles) {
    const actual = profiles.get(expected.email);
    report(
      `fixture ${expected.role}`,
      Boolean(actual?.id && actual.role === expected.role),
    );
  }

  const missingProfiles = expectedProfiles.filter((expected) => {
    const actual = profiles.get(expected.email);
    return !actual?.id || actual.role !== expected.role;
  });

  if (missingProfiles.length) {
    throw new Error(`fixtures ausentes ou com perfil divergente: ${missingProfiles.map((item) => item.role).join(', ')}`);
  }

  const matrixResult = await request('/rest/v1/rpc/get_permission_admin_matrix', {
    method: 'POST',
    token: admin.token,
    body: {},
  });

  if (!matrixResult.response.ok || !matrixResult.data?.matrix_status) {
    throw new Error(`matriz administrativa falhou: HTTP ${matrixResult.response.status}; ${errorText(matrixResult)}`);
  }

  const matrix = matrixResult.data;
  const expectedRoles = expectedProfiles.map((profile) => profile.role).sort();
  const actualRoles = [...new Set((matrix.role_permissions || []).map((item) => item.role))].sort();

  const matrixComplete =
    matrix.matrix_status.complete === true &&
    matrix.matrix_status.active_permissions === 29 &&
    matrix.matrix_status.actual_role_permission_rows === 145 &&
    JSON.stringify(actualRoles) === JSON.stringify(expectedRoles);

  report('matriz completa: 29 permissões x 5 perfis', matrixComplete);

  for (const profile of expectedProfiles) {
    const count = (matrix.role_permissions || []).filter((item) => item.role === profile.role).length;
    report(`${profile.role}: 29 linhas de matriz`, count === 29, `linhas=${count}`);
  }

  const leadershipRows = (matrix.role_permissions || []).filter((item) => item.role === 'lideranca');
  report(
    'Liderança possui 29 permissões válidas na matriz',
    leadershipRows.length === 29 &&
      leadershipRows.every((item) => typeof item.allowed === 'boolean'),
  );

  if (!matrixComplete) {
    throw new Error('Matriz incompleta ou divergente. Testes de perfil interrompidos.');
  }

  const adminContextResult = await request('/rest/v1/rpc/get_my_app_context', {
    method: 'POST',
    token: admin.token,
    body: {},
  });

  const adminContext = adminContextResult.data;
  report(
    'contexto do Administrador e acesso administrativo',
    adminContextResult.response.ok &&
      adminContext?.user?.role === 'administrador' &&
      Object.keys(adminContext.permissions || {}).length === 29 &&
      adminContext.permissions['permissions.manage'] === true,
  );

  const permissionKeys = [
    'permissions.manage',
    'reports.export',
    'dashboard.view',
    'stock.search',
  ];

  for (const expected of nonAdminProfiles) {
    const profile = profiles.get(expected.email);
    const session = await login(expected.email);

    report(`login ${expected.role}`, session.user.id === profile.id);

    const contextResult = await request('/rest/v1/rpc/get_my_app_context', {
      method: 'POST',
      token: session.token,
      body: {},
    });

    const context = contextResult.data;
    const contextValid =
      contextResult.response.ok &&
      context?.user?.id === profile.id &&
      context?.user?.role === expected.role &&
      context?.matrix_complete === true &&
      Object.keys(context?.permissions || {}).length === 29;

    report(`${expected.role}: contexto e matriz completos`, contextValid);

    if (!contextValid) {
      continue;
    }

    if (expected.role === 'lideranca') {
      const effectiveLeadershipPermissions = Object.fromEntries(
        leadershipRows.map((item) => {
          const override = (matrix.user_overrides || []).find(
            (entry) =>
              entry.user_id === profile.id &&
              entry.permission_key === item.permission_key,
          );

          const allowed = override?.decision === 'allow' ? true
            : override?.decision === 'deny' ? false
            : Boolean(item.allowed);

          return [item.permission_key, allowed];
        }),
      );

      const contextKeys = Object.keys(context.permissions).sort();
      const expectedKeys = Object.keys(effectiveLeadershipPermissions).sort();

      const leadershipMatchesMatrix =
        JSON.stringify(contextKeys) === JSON.stringify(expectedKeys) &&
        expectedKeys.every(
          (permission) =>
            context.permissions[permission] === effectiveLeadershipPermissions[permission],
        );

      report(
        'Liderança respeita matriz e exceções configuradas',
        leadershipMatchesMatrix,
      );
    }

    for (const permission of permissionKeys) {
      const rpc = await request('/rest/v1/rpc/has_app_permission', {
        method: 'POST',
        token: session.token,
        body: { p_permission_key: permission },
      });

      report(
        `${expected.role}: helper ${permission} coincide com o contexto`,
        rpc.response.ok &&
          typeof rpc.data === 'boolean' &&
          rpc.data === context.permissions[permission],
      );
    }

    const matrixRead = await request('/rest/v1/rpc/get_permission_admin_matrix', {
      method: 'POST',
      token: session.token,
      body: {},
    });

    report(
      `${expected.role}: leitura administrativa bloqueada`,
      !matrixRead.response.ok && errorText(matrixRead).includes('PERMISSION_ADMIN_REQUIRED'),
    );

    const roleWrite = await request('/rest/v1/rpc/save_role_permission_changes', {
      method: 'POST',
      token: session.token,
      body: { p_target_role: 'apoio', p_changes: [] },
    });

    report(
      `${expected.role}: escrita de matriz bloqueada`,
      !roleWrite.response.ok && errorText(roleWrite).includes('PERMISSION_ADMIN_REQUIRED'),
    );

    const overrideWrite = await request('/rest/v1/rpc/save_user_permission_overrides', {
      method: 'POST',
      token: session.token,
      body: { p_target_user_id: profile.id, p_changes: [] },
    });

    report(
      `${expected.role}: escrita de exceções bloqueada`,
      !overrideWrite.response.ok && errorText(overrideWrite).includes('PERMISSION_ADMIN_REQUIRED'),
    );

    const directTable = await request('/rest/v1/role_permissions?select=role&limit=1', {
      token: session.token,
    });

    report(
      `${expected.role}: leitura direta da matriz bloqueada`,
      !directTable.response.ok,
    );
  }

  const unknown = await request('/rest/v1/rpc/has_app_permission', {
    method: 'POST',
    token: (await login('rafael-permissoes@local.test')).token,
    body: { p_permission_key: '__permission_key_unknown__' },
  });

  report('chave de permissão desconhecida falha fechada', unknown.response.ok && unknown.data === false);

  console.log(`\nResumo: ${passed} aprovados; ${failures.length} falhas.`);
  if (failures.length) {
    console.error('Falhas:', failures.join(', '));
    process.exitCode = 1;
  } else {
    console.log('PASS: validação direta dos cinco perfis concluída no sandbox local.');
  }
} catch (error) {
  console.error(`FALHA DE DIAGNÓSTICO: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}