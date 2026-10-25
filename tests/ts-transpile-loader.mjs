/**
 * Minimal portable loader for running the existing TypeScript-backed Node tests.
 * It uses the project's installed TypeScript package and does not alter source files.
 * Use with: node --experimental-loader ./tests/ts-transpile-loader.mjs --test ...
 */
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
    const parentPath = context.parentURL?.startsWith('file:')
      ? path.dirname(fileURLToPath(context.parentURL))
      : process.cwd();

    for (const extension of ['.ts', '.tsx', '.js', '.mjs']) {
      const candidate = path.resolve(parentPath, `${specifier}${extension}`);
      try {
        await access(candidate);
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      } catch {
        // Try the next supported extension.
      }
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && /\.tsx?$/i.test(fileURLToPath(url))) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;

    return { format: 'module', source: output, shortCircuit: true };
  }

  return nextLoad(url, context);
}
