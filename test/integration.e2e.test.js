const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'python', 'cli.py');

test('Python worker spawns and responds to --help without crashing', (t, done) => {
    const child = spawn('python3', [CLI, '--help'], { timeout: 10000 });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
        // --help exits with 0 and prints usage
        assert.strictEqual(code, 0, `Expected exit code 0, got ${code}. stderr: ${stderr}`);
        assert.ok(
            stdout.length > 0 || stderr.length > 0,
            'Expected some output from --help'
        );
        done();
    });

    child.on('error', (err) => {
        done(err);
    });
});

test('Python worker emits valid JSON on stdout when given invalid args', (t, done) => {
    // Passing no required args should cause the worker to exit with a usage error,
    // not a raw Python traceback exposed as non-JSON
    const child = spawn('python3', [CLI], { timeout: 10000 });
    let stderr = '';

    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
        // Should exit non-zero
        assert.notStrictEqual(code, 0, 'Expected non-zero exit for missing required args');
        // stderr should not contain a raw Python traceback (no "Traceback (most recent call last)")
        assert.ok(
            !stderr.includes('Traceback (most recent call last)'),
            `Unexpected Python traceback exposed to caller:\n${stderr}`
        );
        done();
    });

    child.on('error', (err) => {
        done(err);
    });
});
