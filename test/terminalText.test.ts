import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { toTerminalText, formatCommandLine, formatExitLine } from '../src/terminalText';

describe('toTerminalText', () => {
    it('turns LF and CRLF into CRLF', () => {
        assert.equal(toTerminalText('a\nb\r\nc'), 'a\r\nb\r\nc');
    });

    it('keeps lone CR so progress bars can redraw their line', () => {
        assert.equal(toTerminalText('10%\r20%\r30%\n'), '10%\r20%\r30%\r\n');
    });
});

describe('formatCommandLine', () => {
    it('quotes only arguments that need it', () => {
        assert.equal(
            formatCommandLine('/usr/bin/python3', ['/ext/scripts/sam.py', '--model_dir', '/My Models/sam', '--port', '8765']),
            '/usr/bin/python3 /ext/scripts/sam.py --model_dir "/My Models/sam" --port 8765'
        );
        assert.equal(formatCommandLine('python', ['a"b', '']), 'python "a\\"b" ""');
    });
});

describe('formatExitLine', () => {
    it('describes normal exit, signals and start failures', () => {
        assert.equal(formatExitLine(0, null), '[Process exited with code 0]');
        assert.equal(formatExitLine(null, 'SIGTERM'), '[Process terminated by SIGTERM]');
        assert.equal(formatExitLine(null, null, 'spawn python ENOENT'), '[Failed to start: spawn python ENOENT]');
    });
});
