// File persistence helpers shared by the workflow store and the service stores.
// A save stays atomic: the new content is written to a temporary file, and one rename replaces the saved
// file. The saved file is never deleted or truncated to make a rename succeed, and a failure is always thrown.

import { rename as renameFile, appendFile, mkdir } from 'node:fs/promises';
import { win32, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// On Windows another program (a sync client, an indexer, a virus scanner) can hold a file open for a moment.
// A rename then fails although nothing is wrong with the data. Measured on a OneDrive folder: about one
// rename in a hundred returned EPERM, and no other step of a save failed. Only these codes are retried,
// only on Windows, and only for about one second in total.
export const transientFileCodes = ['EPERM', 'EBUSY', 'EACCES'];
export const renameRetryDelays = [15, 30, 60, 120, 240, 480];

export function isTransientFileLock(error, platform = process.platform) {
  return platform === 'win32' && transientFileCodes.includes(error?.code);
}

/**
 * Replaces destination with temporary in one rename.
 * A transient lock error is retried a bounded number of times. Any other error, or a lock that outlasts the
 * retries, is thrown as it was received; the destination then still holds its previous content, and the
 * temporary file is left in place for the next save to overwrite.
 * A save that had to wait is recorded, so an operator can see that another program is watching the folder.
 */
export async function replaceFile(temporary, destination, { rename = renameFile, delays = renameRetryDelays, wait = delay, platform = process.platform, report = reportFailure } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, destination);
      if (attempt > 0) await report({ at: new Date().toISOString(), event: 'rename-retried', file: fileName(destination), retries: attempt });
      return { retries: attempt };
    } catch (error) {
      if (!isTransientFileLock(error, platform) || attempt >= delays.length) {
        if (error && typeof error === 'object') error.renameAttempts = attempt + 1;
        throw error;
      }
      await wait(delays[attempt]);
    }
  }
}

const short = value => (typeof value === 'string' && value ? value.slice(0, 300) : undefined);
// Diagnostics may carry a path from another OS. Windows basename recognizes both separator styles.
const fileName = value => (typeof value === 'string' && value ? win32.basename(value) : undefined);

/**
 * What an operator needs to know about an unexpected failure. It never holds a request body, a header,
 * a query string or a token. File errors give the code, the system call and the file name only, because
 * their message carries the full local path.
 */
export function failureRecord(error, { service, method, path, requestId } = {}) {
  const fileError = Boolean(error?.code && error?.syscall);
  const frame = fileError ? undefined : String(error?.stack ?? '').split('\n').map(line => line.trim()).find(line => line.startsWith('at '));
  return {
    at: new Date().toISOString(), service: short(service), requestId: short(requestId), method: short(method), path: short(path),
    name: short(error?.name), code: short(error?.code), syscall: short(error?.syscall),
    file: fileName(error?.path), target: fileName(error?.dest),
    renameAttempts: Number.isSafeInteger(error?.renameAttempts) ? error.renameAttempts : undefined,
    message: fileError ? undefined : short(error?.message),
    // The innermost frame, with folders removed so no local path is recorded.
    where: frame ? short(frame.replace(/(?:file:\/\/\/)?[^\s()]*[\\/]/g, '')) : undefined,
  };
}

/**
 * Writes a diagnostic record to the error stream and, when PLATFORM_DIAGNOSTICS_FILE names a file, appends it there.
 * Reporting can fail without consequence: the caller still answers its request with the original failure.
 */
export async function reportFailure(record, { file = process.env.PLATFORM_DIAGNOSTICS_FILE, log = console.error } = {}) {
  const line = JSON.stringify(record);
  try { log(`[diagnostic] ${line}`); } catch { /* the original failure is still returned to the caller */ }
  if (!file) return;
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${line}\n`);
  } catch { /* the original failure is still returned to the caller */ }
}
