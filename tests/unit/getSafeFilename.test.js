const { getSafeFilename } = require('../../src/background/download-engine.js');

describe('getSafeFilename', () => {
    test('basic name + extension', () => {
        expect(getSafeFilename('Lecture Notes', '.pdf')).toBe('Lecture Notes.pdf');
    });

    test('strips each Windows-invalid character', () => {
        expect(getSafeFilename('a<b>c:d"e/f\\g|h?i*j', '.pdf')).toBe('a_b_c_d_e_f_g_h_i_j.pdf');
    });

    test('strips control characters and non-breaking spaces', () => {
        // Build the input from char codes to avoid any ambiguity with literal
        // control-character escapes in the test source itself.
        const NUL = String.fromCharCode(0);
        const UNIT_SEP = String.fromCharCode(0x1F);
        const DEL = String.fromCharCode(0x7F);
        const NBSP = String.fromCharCode(0xA0);
        const input = `a${NUL}b${UNIT_SEP}c${DEL}d${NBSP}e`;
        expect(getSafeFilename(input, '.pdf')).toBe('a_b_c_d_e.pdf');
    });

    test('trims whitespace and trailing dots', () => {
        expect(getSafeFilename('  report...  ', '.pdf')).toBe('report.pdf');
    });

    test.each(['CON', 'con', 'NUL', 'COM1', 'LPT1', 'PRN', 'AUX'])(
        'prefixes reserved Windows name "%s"',
        (name) => {
            expect(getSafeFilename(name, '')).toBe('_' + name);
        }
    );

    test('does not flag a non-reserved name that merely contains a reserved substring', () => {
        expect(getSafeFilename('CONTRACT', '.pdf')).toBe('CONTRACT.pdf');
    });

    test('truncates names longer than 120 characters', () => {
        const longName = 'a'.repeat(200);
        const result = getSafeFilename(longName, '.pdf');
        // 120 chars of 'a' + '.pdf'
        expect(result).toBe('a'.repeat(120) + '.pdf');
    });

    test('appends extension when missing', () => {
        expect(getSafeFilename('syllabus', '.docx')).toBe('syllabus.docx');
    });

    test('does not duplicate extension already present (case-insensitive)', () => {
        expect(getSafeFilename('report.PDF', '.pdf')).toBe('report.PDF');
    });

    test('normalizes extension without a leading dot', () => {
        expect(getSafeFilename('notes', 'txt')).toBe('notes.txt');
    });

    test('falls back to "download" + extension for empty text', () => {
        expect(getSafeFilename('', '.pdf')).toBe('download.pdf');
    });

    test('falls back to "download" + extension for undefined text', () => {
        expect(getSafeFilename(undefined, '.pdf')).toBe('download.pdf');
    });

    test('falls back when cleaned name is empty (only whitespace/dots)', () => {
        expect(getSafeFilename('   ...   ', '.pdf')).toBe('download.pdf');
    });

    test('preserves accented Latin characters (French/Spanish course names)', () => {
        expect(getSafeFilename('café résumé', '.pdf')).toBe('café résumé.pdf');
        expect(getSafeFilename('Ñoño García', '.pptx')).toBe('Ñoño García.pptx');
    });

    test('preserves non-Latin scripts (Japanese/Chinese file names)', () => {
        expect(getSafeFilename('日本語ファイル', '.docx')).toBe('日本語ファイル.docx');
        expect(getSafeFilename('课程笔记', '.pdf')).toBe('课程笔记.pdf');
    });
});
