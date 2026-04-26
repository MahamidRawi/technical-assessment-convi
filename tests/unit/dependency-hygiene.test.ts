import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('package dependencies do not include unused blocked packages', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const blocked = ['mongoose'];

  for (const name of blocked) {
    assert.equal(deps[name], undefined, `${name} should not be installed without a caller`);
  }
});
