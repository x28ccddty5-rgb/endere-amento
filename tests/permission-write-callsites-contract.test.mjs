import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../scripts/Export-PermissionWriteCallsites.ps1', import.meta.url), 'utf8');

test('source inventory only scans src, Supabase functions and optional server.ts', () => {
  assert.match(script, /Join-Path \$root 'src'/);
  assert.match(script, /Join-Path \$root 'supabase\\functions'/);
  assert.match(script, /server\.ts/);
});

test('source inventory never launches psql, Docker, Supabase CLI or network requests', () => {
  for (const forbidden of [
    /docker\s+(?:exec|run|start|stop|rm)/i,
    /supabase\s+(?:db|start|stop|link|push|migration)/i,
    /\bpsql(?:\.exe)?\b/i,
    /Invoke-RestMethod|Invoke-WebRequest|curl\.exe/i,
  ]) {
    assert.doesNotMatch(script, forbidden);
  }
});

test('inventory records static RPC names and direct table write methods', () => {
  assert.match(script, /rpcPattern/);
  assert.match(script, /fromPattern/);
  assert.match(script, /insert\|upsert\|update\|delete/);
  assert.match(script, /DIRECT_DML_CALLSITE/);
  assert.match(script, /RPC_CALLSITE/);
});

test('inventory does not read env files and writes one report under docs/seguranca', () => {
  assert.match(script, /docs\\seguranca/);
  assert.match(script, /permission-write-callsite-inventory\.txt/);
  assert.doesNotMatch(script, /Get-Content[^\r\n]*\.env/i);
  assert.match(script, /Nao foram lidos arquivos \.env/);
});
