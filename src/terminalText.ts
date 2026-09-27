/**
 * Pure text helpers for showing a child process's output in a VS Code
 * pseudoterminal. No `vscode` import so they stay unit-testable.
 */

/**
 * A pseudoterminal is a raw xterm: a bare `\n` moves down without returning
 * to column 0. Normalise line endings to CRLF, leaving lone `\r` (progress
 * bars such as tqdm redraw their line with it) untouched.
 */
export function toTerminalText(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}

/**
 * Human-readable echo of the command being run, printed at the top of the
 * terminal. Display only — the process is spawned with an argv array, never
 * through a shell.
 */
export function formatCommandLine(exe: string, args: string[]): string {
    return [exe, ...args]
        .map(a => (a === '' || /[\s"']/.test(a)) ? `"${a.replace(/"/g, '\\"')}"` : a)
        .join(' ');
}

/** Final status line printed when the process ends. */
export function formatExitLine(code: number | null, signal: string | null, error?: string): string {
    if (error) return `[Failed to start: ${error}]`;
    if (signal) return `[Process terminated by ${signal}]`;
    return `[Process exited with code ${code}]`;
}
