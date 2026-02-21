const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('main.js guards dotenv startup loading', () => {
    const mainPath = path.join(__dirname, '..', 'main.js');
    const source = fs.readFileSync(mainPath, 'utf8');

    const guardedDotenvPattern = /try\s*{\s*require\(['"]dotenv['"]\)\.config\(\);\s*}\s*catch\s*\([^)]*\)\s*{/s;
    const guardedBlock = source.match(guardedDotenvPattern);
    assert.ok(guardedBlock, 'Expected dotenv require to be guarded by try/catch');

    const sourceWithoutGuard = source.replace(guardedBlock[0], '');
    const unguardedMatches = sourceWithoutGuard.match(/require\(['"]dotenv['"]\)\.config\(\)/g) || [];
    assert.equal(unguardedMatches.length, 0, 'Found unguarded dotenv require in main.js');
});
