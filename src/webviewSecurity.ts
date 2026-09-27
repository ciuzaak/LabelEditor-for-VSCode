/**
 * Pure helpers that keep untrusted data (file names, annotation JSON, persisted
 * settings, webview messages) from turning into code — in the webview HTML or
 * in the shell command that launches the bundled Python scripts.
 *
 * No `vscode` import so the module stays unit-testable under plain Node.
 */

import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Webview HTML
// ---------------------------------------------------------------------------

/** Random nonce for the webview Content-Security-Policy `script-src`. */
export function makeNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

/**
 * JSON-encode a value for embedding inside an inline `<script>` block.
 * `JSON.stringify` leaves `</script>` and `<!--` intact, so a label or file name
 * containing them would end the script element early. Escaping `<`, `>` and `&`
 * as `\uXXXX` keeps the output valid JS/JSON with identical meaning; U+2028/9
 * are escaped for older JS parsers that treat them as line terminators.
 */
export function serializeForScript(value: unknown): string {
    const json = JSON.stringify(value);
    if (json === undefined) return 'null';
    return json
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/** Escape text for insertion into HTML element content or a quoted attribute. */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Persisted global settings (webview → globalState)
// ---------------------------------------------------------------------------

type Validator = (v: unknown) => boolean;

const isBool: Validator = v => typeof v === 'boolean';
const isFiniteNumber: Validator = v => typeof v === 'number' && Number.isFinite(v);
const isString: Validator = v => typeof v === 'string';
const isStringArray: Validator = v => Array.isArray(v) && v.every(x => typeof x === 'string');
const isIntInRange = (min: number, max: number): Validator =>
    v => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const oneOf = (...allowed: string[]): Validator => v => typeof v === 'string' && allowed.includes(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Every key the webview may persist through `saveGlobalSettings`, with a type
 * check for its value. Keys not listed here (including extension-owned ones
 * such as the SAM auth token) are rejected.
 */
const GLOBAL_SETTING_VALIDATORS: Record<string, Validator> = {
    customColors: v => isPlainObject(v) && Object.values(v).every(x => typeof x === 'string'),
    borderWidth: isFiniteNumber,
    fillOpacity: isFiniteNumber,
    recentLabels: isStringArray,
    theme: oneOf('auto', 'light', 'dark'),
    brightness: isFiniteNumber,
    contrast: isFiniteNumber,
    brightnessLocked: isBool,
    contrastLocked: isBool,
    selectedChannel: oneOf('rgb', 'r', 'g', 'b'),
    channelLocked: isBool,
    claheEnabled: isBool,
    claheClipLimit: isFiniteNumber,
    claheLocked: isBool,
    lockViewEnabled: isBool,
    onnxModelDir: isString,
    onnxPythonPath: isString,
    onnxDevice: oneOf('cpu', 'gpu'),
    onnxColor: oneOf('rgb', 'bgr'),
    onnxScope: oneOf('current', 'all'),
    onnxMode: oneOf('skip', 'merge', 'overwrite'),
    onnxGpuIndex: isIntInRange(-1, 1024),
    samModelDir: isString,
    samPythonPath: isString,
    samDevice: oneOf('cpu', 'gpu'),
    samPort: isIntInRange(1, 65535),
    samEncodeMode: oneOf('full', 'local'),
    samEncodeAdjusted: isBool,
    samOutputFormat: oneOf('polygon', 'rectangle'),
    samGpuIndex: isIntInRange(-1, 1024),
    drawClickThrough: isBool,
    showShapeLabels: isBool,
    svgExportScope: oneOf('current', 'all'),
    keyboardBindings: v => v === null || (isPlainObject(v) && Object.values(v).every(
        b => b === null || (isPlainObject(b) && typeof b.key === 'string')
    )),
    locale: oneOf('en', 'zh-CN'),
};

/** True when `key` is a webview-writable setting and `value` has the right type. */
export function isValidGlobalSetting(key: unknown, value: unknown): boolean {
    if (typeof key !== 'string') return false;
    if (!Object.prototype.hasOwnProperty.call(GLOBAL_SETTING_VALIDATORS, key)) return false;
    return GLOBAL_SETTING_VALIDATORS[key](value);
}

/**
 * Read-side counterpart: returns `stored` when it passes the key's validator,
 * otherwise `fallback`. Guards against values persisted by older versions
 * (or tampered with) before the write-side check existed.
 */
export function sanitizeStoredSetting<T>(key: string, stored: unknown, fallback: T): T {
    if (stored === undefined) return fallback;
    return isValidGlobalSetting(key, stored) ? stored as T : fallback;
}

// ---------------------------------------------------------------------------
// Python launcher (webview config → terminal command)
// ---------------------------------------------------------------------------

export type ShellKind = 'posix' | 'fish' | 'powershell' | 'cmd';

/** Classify VS Code's default shell (`vscode.env.shell`) for quoting purposes. */
export function detectShellKind(shellPath: string, platform: string): ShellKind {
    const base = shellPath.split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, '');
    if (base === 'pwsh' || base === 'powershell') return 'powershell';
    if (base === 'cmd') return 'cmd';
    if (base === 'fish') return 'fish';
    if (!base && platform === 'win32') return 'powershell';
    return 'posix';
}

/**
 * Quote one argument so the shell passes it to the program verbatim — no
 * variable, command or glob expansion. Throws on input that cannot be quoted
 * safely (control characters would split the line `sendText` submits; cmd.exe
 * has no way to escape `"` or `%` inside a quoted argument).
 */
export function quoteShellArg(arg: string, kind: ShellKind): string {
    if (/[\x00-\x1f\x7f]/.test(arg)) {
        throw new Error('argument contains control characters');
    }
    switch (kind) {
        case 'posix':
            return `'${arg.replace(/'/g, `'\\''`)}'`;
        case 'fish':
            // Inside fish single quotes only \\ and \' are escapes.
            return `'${arg.replace(/\\/g, '\\\\').replace(/'/g, `\\'`)}'`;
        case 'powershell':
            // PowerShell also treats the typographic single quotes as quote chars.
            return `'${arg.replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&')}'`;
        case 'cmd':
            if (/["%]/.test(arg)) {
                throw new Error('argument contains characters cmd.exe cannot quote (" or %)');
            }
            return `"${arg}"`;
    }
}

/** Build a complete command line that runs `exe` with `args`, all quoted. */
export function buildShellCommand(exe: string, args: string[], kind: ShellKind): string {
    const parts = [exe, ...args].map(a => quoteShellArg(a, kind));
    // PowerShell needs the call operator to run a quoted executable path.
    return (kind === 'powershell' ? '& ' : '') + parts.join(' ');
}

/**
 * Drop trailing path separators (keeping a bare root such as `/` or `C:\`).
 * On Windows a directory argument ending in `\` would otherwise produce `...\"`,
 * which the C runtime parses as an escaped quote.
 */
export function stripTrailingSeparators(p: string): string {
    const stripped = p.replace(/[\\/]+$/, '');
    if (stripped === '' || /^[A-Za-z]:$/.test(stripped)) return p;
    return stripped;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export interface OnnxLaunchConfig {
    modelDir: string;
    pythonPath: string;
    device: 'cpu' | 'gpu';
    colorFormat: 'rgb' | 'bgr';
    mode: 'skip' | 'merge' | 'overwrite';
    scope: 'current' | 'all';
    gpuIndex?: number;
}

export interface SamLaunchConfig {
    modelDir: string;
    pythonPath: string;
    device: 'cpu' | 'gpu';
    port: number;
    gpuIndex?: number;
}

function validatePathsAndGpu(c: Record<string, unknown>): Validated<{ modelDir: string; pythonPath: string; gpuIndex?: number }> {
    if (typeof c.modelDir !== 'string' || !c.modelDir.trim()) return { ok: false, error: 'modelDir' };
    if (c.pythonPath !== undefined && typeof c.pythonPath !== 'string') return { ok: false, error: 'pythonPath' };
    return {
        ok: true,
        value: {
            modelDir: stripTrailingSeparators(c.modelDir.trim()),
            pythonPath: (c.pythonPath as string | undefined)?.trim() || 'python',
            // The webview derives this with parseInt, so an empty GPU dropdown
            // yields NaN; treat anything that isn't a sane index as "unset".
            gpuIndex: isIntInRange(-1, 1024)(c.gpuIndex) ? c.gpuIndex as number : undefined,
        },
    };
}

/** Validate the `onnxBatchInfer` message config coming from the webview. */
export function validateOnnxLaunchConfig(c: unknown): Validated<OnnxLaunchConfig> {
    if (!isPlainObject(c)) return { ok: false, error: 'config' };
    const base = validatePathsAndGpu(c);
    if (!base.ok) return base;
    if (!oneOf('cpu', 'gpu')(c.device)) return { ok: false, error: 'device' };
    if (!oneOf('rgb', 'bgr')(c.colorFormat)) return { ok: false, error: 'colorFormat' };
    if (!oneOf('skip', 'merge', 'overwrite')(c.mode)) return { ok: false, error: 'mode' };
    if (!oneOf('current', 'all')(c.scope)) return { ok: false, error: 'scope' };
    return {
        ok: true,
        value: {
            ...base.value,
            device: c.device as OnnxLaunchConfig['device'],
            colorFormat: c.colorFormat as OnnxLaunchConfig['colorFormat'],
            mode: c.mode as OnnxLaunchConfig['mode'],
            scope: c.scope as OnnxLaunchConfig['scope'],
        },
    };
}

/** Validate the `samStartService` message config coming from the webview. */
export function validateSamLaunchConfig(c: unknown): Validated<SamLaunchConfig> {
    if (!isPlainObject(c)) return { ok: false, error: 'config' };
    const base = validatePathsAndGpu(c);
    if (!base.ok) return base;
    if (!oneOf('cpu', 'gpu')(c.device)) return { ok: false, error: 'device' };
    if (!isIntInRange(1, 65535)(c.port)) return { ok: false, error: 'port' };
    return {
        ok: true,
        value: { ...base.value, device: c.device as SamLaunchConfig['device'], port: c.port as number },
    };
}
