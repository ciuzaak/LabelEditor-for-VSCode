import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFileAtomic, renameWithRetry } from '../src/atomicWrite';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'labeleditor-atomic-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const entries = () => fs.readdir(dir);

describe('writeFileAtomic', () => {
    it('creates a new file', async () => {
        const p = path.join(dir, 'a.json');
        await writeFileAtomic(p, '{"中文":1}');
        assert.equal(await fs.readFile(p, 'utf8'), '{"中文":1}');
        assert.deepEqual(await entries(), ['a.json']);
    });

    it('replaces an existing file and leaves no temp files behind', async () => {
        const p = path.join(dir, 'a.txt');
        await fs.writeFile(p, 'old content that is longer');
        await writeFileAtomic(p, 'new');
        assert.equal(await fs.readFile(p, 'utf8'), 'new');
        assert.deepEqual(await entries(), ['a.txt']);
    });

    it('writes binary data', async () => {
        const p = path.join(dir, 'b.bin');
        await writeFileAtomic(p, new Uint8Array([0, 255, 10]));
        assert.deepEqual([...await fs.readFile(p)], [0, 255, 10]);
    });

    it('keeps the permission bits of an existing file', { skip: process.platform === 'win32' }, async () => {
        const p = path.join(dir, 'a.txt');
        await fs.writeFile(p, 'x');
        await fs.chmod(p, 0o640);
        await writeFileAtomic(p, 'y');
        assert.equal((await fs.stat(p)).mode & 0o777, 0o640);
    });

    it('writes through a symlink instead of replacing it', { skip: process.platform === 'win32' }, async () => {
        const real = path.join(dir, 'real.json');
        const link = path.join(dir, 'link.json');
        await fs.writeFile(real, 'old');
        await fs.symlink(real, link);
        await writeFileAtomic(link, 'new');
        assert.ok((await fs.lstat(link)).isSymbolicLink());
        assert.equal(await fs.readFile(real, 'utf8'), 'new');
    });

    it('fails without touching anything when the directory is missing', async () => {
        await assert.rejects(writeFileAtomic(path.join(dir, 'missing', 'a.json'), 'x'), { code: 'ENOENT' });
        assert.deepEqual(await entries(), []);
    });

    it('leaves the original intact and cleans up when the rename fails', async () => {
        // A directory at the destination makes rename fail after the temp file
        // has been fully written.
        const p = path.join(dir, 'target');
        await fs.mkdir(p);
        await fs.writeFile(path.join(p, 'keep'), 'k');
        await assert.rejects(writeFileAtomic(p, 'x'));
        assert.deepEqual(await entries(), ['target']);
        assert.equal(await fs.readFile(path.join(p, 'keep'), 'utf8'), 'k');
    });
});

describe('renameWithRetry', () => {
    const err = (code: string) => Object.assign(new Error(code), { code });

    it('retries transient locking errors, then succeeds', async () => {
        let calls = 0;
        await renameWithRetry('a', 'b', async () => { if (++calls < 3) throw err('EBUSY'); }, 5, 1);
        assert.equal(calls, 3);
    });

    it('gives up after the retry budget', async () => {
        let calls = 0;
        await assert.rejects(
            renameWithRetry('a', 'b', async () => { calls++; throw err('EPERM'); }, 2, 1),
            { code: 'EPERM' }
        );
        assert.equal(calls, 3);
    });

    it('does not retry other errors', async () => {
        let calls = 0;
        await assert.rejects(
            renameWithRetry('a', 'b', async () => { calls++; throw err('ENOENT'); }, 5, 1),
            { code: 'ENOENT' }
        );
        assert.equal(calls, 1);
    });
});
