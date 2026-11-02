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
try { parsed = new URL(baseUrl); } catch {
  console.error('FALHA: URL local ausente ou inválida.');
  process.exit(2);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || parsed.port !== '55321') {
  console.error(`BLOQUEADO: esperado Supabase local em porta 55321; URL detectada: ${parsed.origin}`);
  process.exit(2);
}
if (!apiKey) {
  console.error('FALHA: chave pública local ausente.');
  process.exit(2);
}

const password = process.env.PERMISSION_SANDBOX_PASSWORD || 'LocalPermissao!2026';
const failures = [];
let passed = 0;
const report = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(name);
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

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
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data, text };
}

async function login(email) {
  const result = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  if (!result.response.ok || !result.data?.access_token || !result.data?.user?.id) {
    const code = result.data?.error_code || result.data?.code || 'sem código';
    const message = result.data?.msg || result.data?.message || result.data?.error_description || 'sem detalhe';
    throw new Error(`login de teste ${email} falhou: HTTP ${result.response.status}; ${code}; ${message}`);
  }
  return { token: result.data.access_token, user: result.data.user };
}

function errorText(result) {
  const data = result.data;
  if (typeof data === 'string') return data;
  return [data?.message, data?.details, data?.hint, data?.code].filter(Boolean).join(' | ');
}

try {
  console.log(`Sandbox alvo: ${parsed.origin}`);
  console.log('Nenhum token será exibido; chamadas de escrita usarão payloads vazios e devem ser recusadas antes de gravar.');

  const admin = await login('admin-permissoes@local.test');
  report('login do Administrador local', admin.user.email === 'admin-permissoes@local.test');

  const userList = await request('/rest/v1/rpc/permission_test_list_users', {
    method: 'POST', token: admin.token, body: {},
  });
  if (!userList.response.ok || !Array.isArray(userList.data)) {
    throw new Error(`listagem local de usuários falhou: HTTP ${userList.response.status}; ${errorText(userList)}`);
  }
  const rafael = userList.data.find((u) => u.email === 'rafael-permissoes@local.test');
  report('Rafael existe no sandbox e tem perfil Apoio', Boolean(rafael?.id && rafael.role === 'apoio'));
  if (!rafael?.id) throw new Error('Rafael Teste não encontrado; não serão feitas mais chamadas.');

  const matrixResult = await request('/rest/v1/rpc/get_permission_admin_matrix', {
    method: 'POST', token: admin.token, body: {},
  });
  if (!matrixResult.response.ok || !matrixResult.data?.matrix_status) {
    throw new Error(`matriz não carregou: HTTP ${matrixResult.response.status}; ${errorText(matrixResult)}`);
  }
  const matrix = matrixResult.data;
  report('matriz-base completa (29 chaves x 5 perfis)',
    matrix.matrix_status.complete === true &&
    matrix.matrix_status.active_permissions === 29 &&
    matrix.matrix_status.actual_role_permission_rows === 145);

  const exportBase = matrix.role_permissions.find((x) => x.role === 'apoio' && x.permission_key === 'reports.export');
  const exportOverride = matrix.user_overrides.find((x) => x.user_id === rafael.id && x.permission_key === 'reports.export');
  const expectedExport = exportOverride?.decision === 'allow' ? true
    : exportOverride?.decision === 'deny' ? false
    : Boolean(exportBase?.allowed);

  const rafaelSession = await login('rafael-permissoes@local.test');
  report('login do Rafael local', rafaelSession.user.id === rafael.id);

  const contextResult = await request('/rest/v1/rpc/get_my_app_context', {
    method: 'POST', token: rafaelSession.token, body: {},
  });
  if (!contextResult.response.ok || !contextResult.data?.permissions || !contextResult.data?.user) {
    throw new Error(`contexto do Rafael falhou: HTTP ${contextResult.response.status}; ${errorText(contextResult)}`);
  }
  const context = contextResult.data;
  report('contexto identifica Rafael como Apoio', context.user.id === rafael.id && context.user.role === 'apoio');
  report('backend confirma matriz completa', context.matrix_complete === true && Object.keys(context.permissions).length === 29);
  report('reports.export efetivo corresponde à configuração persistida',
    context.permissions['reports.export'] === expectedExport,
    `base=${Boolean(exportBase?.allowed)}; exceção=${exportOverride?.decision || 'inherit'}; efetivo=${Boolean(context.permissions['reports.export'])}`);

  for (const permission of ['reports.export', 'dashboard.view', 'stock.search']) {
    const rpc = await request('/rest/v1/rpc/has_app_permission', {
      method: 'POST', token: rafaelSession.token, body: { p_permission_key: permission },
    });
    const rpcValue = rpc.response.ok ? rpc.data : Symbol('error');
    report(`has_app_permission('${permission}') concorda com o contexto`,
      rpc.response.ok && typeof rpcValue === 'boolean' && rpcValue === context.permissions[permission],
      `efetiva=${String(context.permissions[permission])}`);
  }

  const unknown = await request('/rest/v1/rpc/has_app_permission', {
    method: 'POST', token: rafaelSession.token, body: { p_permission_key: '__permission_key_unknown__' },
  });
  report('chave desconhecida falha fechada', unknown.response.ok && unknown.data === false);

  const adminMatrixAsRafael = await request('/rest/v1/rpc/get_permission_admin_matrix', {
    method: 'POST', token: rafaelSession.token, body: {},
  });
  report('Rafael não consegue ler a matriz administrativa completa',
    !adminMatrixAsRafael.response.ok && errorText(adminMatrixAsRafael).includes('PERMISSION_ADMIN_REQUIRED'),
    `HTTP ${adminMatrixAsRafael.response.status}`);

  const roleWriteAsRafael = await request('/rest/v1/rpc/save_role_permission_changes', {
    method: 'POST', token: rafaelSession.token,
    body: { p_target_role: 'apoio', p_changes: [] },
  });
  report('Rafael não consegue chamar RPC de escrita da matriz',
    !roleWriteAsRafael.response.ok && errorText(roleWriteAsRafael).includes('PERMISSION_ADMIN_REQUIRED'),
    `HTTP ${roleWriteAsRafael.response.status}; payload vazio, sem alteração possível`);

  const overrideWriteAsRafael = await request('/rest/v1/rpc/save_user_permission_overrides', {
    method: 'POST', token: rafaelSession.token,
    body: { p_target_user_id: rafael.id, p_changes: [] },
  });
  report('Rafael não consegue chamar RPC de escrita de exceções',
    !overrideWriteAsRafael.response.ok && errorText(overrideWriteAsRafael).includes('PERMISSION_ADMIN_REQUIRED'),
    `HTTP ${overrideWriteAsRafael.response.status}; payload vazio, sem alteração possível`);

  const directTable = await request('/rest/v1/role_permissions?select=role&limit=1', { token: rafaelSession.token });
  report('Rafael não pode ler diretamente a tabela interna da matriz', !directTable.response.ok,
    `HTTP ${directTable.response.status}`);

  console.log(`\nResumo: ${passed} aprovados; ${failures.length} falhas.`);
  if (failures.length) {
    console.error('Falhas:', failures.join(', '));
    process.exitCode = 1;
  } else {
    console.log('PASS: validação do helper backend concluída. Isso ainda não prova que a exportação do app principal foi ligada à permissão.');
  }
} catch (error) {
  console.error(`FALHA DE DIAGNÓSTICO: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
