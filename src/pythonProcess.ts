import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { toTerminalText, formatCommandLine, formatExitLine } from './terminalText';

export interface PythonExit {
    code: number | null;
    signal: NodeJS.Signals | null;
    /** Set when the process could not be started (e.g. interpreter not found). */
    error?: string;
}

export interface PythonRun {
    readonly terminal: vscode.Terminal;
    /** Resolves once the process has exited (or failed to start). Never rejects. */
    readonly exited: Promise<PythonExit>;
    /** Stop the process if it is still running. */
    kill(): void;
}

// Every process started here, so deactivate() can stop them all.
const running = new Set<ChildProcess>();

/**
 * Run a bundled Python script as a child process and mirror its output in a
 * dedicated terminal. Compared with typing a command into a shell terminal,
 * the extension learns when and how the process ends, the arguments never pass
 * through a shell (no quoting or injection concerns), and the process can be
 * stopped — by closing the terminal, pressing Ctrl+C in it, or kill().
 *
 * The process starts when the terminal opens, so no early output is lost.
 * The terminal stays open after exit so the output can be read.
 */
export function runPythonInTerminal(options: {
    name: string;
    python: string;
    args: string[];
    env?: Record<string, string>;
}): PythonRun {
    const writeEmitter = new vscode.EventEmitter<string>();
    let child: ChildProcess | undefined;
    let finished = false;
    let killRequested = false;
    let resolveExit!: (e: PythonExit) => void;
    const exited = new Promise<PythonExit>(resolve => { resolveExit = resolve; });

    const write = (text: string) => writeEmitter.fire(toTerminalText(text));
    const finish = (result: PythonExit) => {
        if (finished) return;
        finished = true;
        if (child) running.delete(child);
        write(`\n${formatExitLine(result.code, result.signal, result.error)}\n`);
        resolveExit(result);
    };
    const kill = (signal: NodeJS.Signals = 'SIGTERM') => {
        killRequested = true;
        if (child && !finished) child.kill(signal);
    };

    const start = (cols?: number) => {
        // kill() before the terminal opened: never start.
        if (killRequested) {
            finish({ code: null, signal: 'SIGTERM' });
            return;
        }
        write(`> ${formatCommandLine(options.python, options.args)}\n\n`);
        try {
            child = spawn(options.python, options.args, {
                env: {
                    ...process.env,
                    // Output is piped, not a TTY: without this Python block-buffers
                    // stdout and progress only shows up at exit.
                    PYTHONUNBUFFERED: '1',
                    PYTHONIOENCODING: 'utf-8',
                    ...(cols ? { COLUMNS: String(cols) } : {}),
                    ...options.env
                },
                windowsHide: true
            });
        } catch (err) {
            finish({ code: null, signal: null, error: (err as Error).message });
            return;
        }
        running.add(child);
        for (const stream of [child.stdout, child.stderr]) {
            const decoder = new StringDecoder('utf8');
            stream?.on('data', (chunk: Buffer) => write(decoder.write(chunk)));
            stream?.on('end', () => { const rest = decoder.end(); if (rest) write(rest); });
        }
        child.on('error', err => finish({ code: null, signal: null, error: err.message }));
        child.on('close', (code, signal) => finish({ code, signal }));
    };

    const pty: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        open: dims => start(dims?.columns),
        // The user closed the terminal: stop the process with it.
        close: () => kill(),
        handleInput: data => {
            if (data === '\x03') kill('SIGINT'); // Ctrl+C
        }
    };

    const terminal = vscode.window.createTerminal({ name: options.name, pty });
    return { terminal, exited, kill: () => kill() };
}

/** Stop every process started by runPythonInTerminal (extension deactivation). */
export function killAllPythonRuns(): void {
    for (const child of running) child.kill();
    running.clear();
}
