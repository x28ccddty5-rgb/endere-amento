import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('desktop redirects away from a tab denied to the newly authenticated profile', async () => {
  const app = await readFile(resolve('src/App.tsx'), 'utf8');
  assert.match(app, /After a profile switch, the previous tab may not belong to the new role/);
  assert.match(app, /if \(canAccessTab\(activeTab\)\) return;/);
  assert.match(app, /const fallbackTab = fallbackTabs\.find\(\(tab\) => canAccessTab\(tab\)\)/);
  assert.match(app, /if \(fallbackTab\) setActiveTab\(fallbackTab\)/);
});


test('desktop permission fallback hook runs before the unauthenticated login return', async () => {
  const app = await readFile(resolve('src/App.tsx'), 'utf8');
  const loginGuardIndex = app.indexOf('// --- LOCK SCREEN CONDITIONAL RENDERING ON NOT LOGGED IN ---');
  const tabResolverIndex = app.indexOf('const canAccessTab = (tab: string): boolean => {');
  const fallbackHookIndex = app.indexOf('useEffect(() => {\n    if (!currentUser) return;\n    if (permissionEnforcementEnabled && permissionContextStatus !== "ready") return;');

  assert.notEqual(loginGuardIndex, -1, 'login guard must exist');
  assert.notEqual(tabResolverIndex, -1, 'tab permission resolver must exist');
  assert.notEqual(fallbackHookIndex, -1, 'permission fallback hook must exist');
  assert.ok(tabResolverIndex < fallbackHookIndex, 'tab resolver must be defined before the fallback hook');
  assert.ok(fallbackHookIndex < loginGuardIndex, 'all hooks must run before the conditional login return');
  assert.doesNotMatch(
    app.slice(loginGuardIndex),
    /\buse(?:State|Effect|Memo|Ref)\s*\(/,
    'no React hook may appear after the unauthenticated early return',
  );
});
