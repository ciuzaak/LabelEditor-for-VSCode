import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// Windows reports these while another process (antivirus, indexer, sync
// client) briefly holds the destination open; the rename usually succeeds a
// moment later.
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * rename(), retried with a short linear backoff on transient Windows locking
 * errors. Other errors, and the last retryable one, are rethrown.
 */
export async function renameWithRetry(
    from: string,
    to: string,
    rename: (a: string, b: string) => Promise<void> = fs.rename,
    retries = 5,
    delayMs = 50
): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(from, to);
            return;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (attempt >= retries || !code || !RETRYABLE_RENAME_CODES.has(code)) throw err;
            await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
        }
    }
}

/**
 * Replace `target` so that readers (and a crash or full disk mid-write) only
 * ever see the old or the new content, never a truncated file: the data goes
 * to a temp file in the same directory, is flushed to disk, then renamed over
 * the target.
 *
 * - A symlinked target is written through to the file it points to, so the
 *   link survives.
 * - An existing file's permission bits are kept.
 * - On failure the temp file is removed and the original is left untouched.
 */
export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
    let dest = target;
    let mode: number | undefined;
    try {
        dest = await fs.realpath(target);
        mode = (await fs.stat(dest)).mode & 0o7777;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const tmp = path.join(
        path.dirname(dest),
        `.${path.basename(dest)}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    try {
        const handle = await fs.open(tmp, 'wx');
        try {
            await handle.writeFile(data, typeof data === 'string' ? 'utf8' : undefined);
            if (mode !== undefined) await handle.chmod(mode);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await renameWithRetry(tmp, dest);
    } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw err;
    }
}
