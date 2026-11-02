import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(resolve(projectRoot, 'src/App.tsx'), 'utf8');
const adminUsersSource = readFileSync(
  resolve(projectRoot, 'src/components/AdminUsersManagement.tsx'),
  'utf8',
);
const catalogMigration = readFileSync(
  resolve(projectRoot, 'docs/sql/migrations/20261031170000_permission_stock_details_description_alignment.sql'),
  'utf8',
);
const catalogApplyScript = readFileSync(
  resolve(projectRoot, 'scripts/Apply-Audit03CatalogMetadata-LocalIntegration.ps1'),
  'utf8',
);

test('admin user loading runs after the auth-session generation reset', () => {
  const resetIndex = appSource.indexOf('sessionDataGenerationRef.current += 1;');
  const loadIndex = appSource.indexOf('void loadUsersFromSupabase();');

  assert.notEqual(resetIndex, -1, 'session reset must remain present');
  assert.notEqual(loadIndex, -1, 'admin user load effect must remain present');
  assert.ok(
    resetIndex < loadIndex,
    'admin user loading must run after the session reset so its result is not invalidated',
  );

  const loadEffect = appSource.slice(loadIndex - 500, loadIndex + 180);
  assert.match(loadEffect, /\[authUserId,\s*currentUser\]/);
  assert.doesNotMatch(
    appSource.slice(0, resetIndex),
    /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,500}?loadUsersFromSupabase\(\);[\s\S]{0,160}?\},\s*\[currentUser\]\)/,
    'the old currentUser-only loader must not run before the auth reset',
  );
});

test('admin user list distinguishes loading and request failure from an empty result', () => {
  assert.match(appSource, /usersLoadError/);
  assert.match(appSource, /Não foi possível carregar a lista de usuários/);
  assert.match(adminUsersSource, /Carregando usuários\.\.\./);
  assert.match(adminUsersSource, /Não foi possível confirmar a lista de usuários/);
  assert.match(adminUsersSource, /Nenhum usuário cadastrado neste ambiente\./);
  assert.match(adminUsersSource, /onReloadUsers/);
});


test('catalog migration changes only the known legacy description and fails closed otherwise', () => {
  assert.match(catalogMigration, /WHERE permission_key = 'stock\.details\.view'/);
  assert.match(catalogMigration, /v_current_description = v_old_description/);
  assert.match(catalogMigration, /v_current_description = v_target_description/);
  assert.match(catalogMigration, /AUDIT03_CATALOG_UNEXPECTED_DESCRIPTION/);
  assert.doesNotMatch(catalogMigration, /DROP\s+(TABLE|POLICY|FUNCTION)/i);
  assert.doesNotMatch(catalogMigration, /GRANT\s+|REVOKE\s+/i);
});


test('local catalog applier is pinned to the integration database and rejects other targets', () => {
  assert.match(catalogApplyScript, /supabase_db_enderecamento-integracao-local/);
  assert.match(catalogApplyScript, /docker inspect/);
  assert.match(catalogApplyScript, /supabase_edge_runtime_enderecamento-integracao-local/);
  assert.match(catalogApplyScript, /sharedNetworks\.Count -eq 0/);
  assert.match(catalogApplyScript, /State\.Status -ne "running"/);
  assert.doesNotMatch(catalogApplyScript, /supabase\.co|supabase db push|vercel --prod/i);
});
