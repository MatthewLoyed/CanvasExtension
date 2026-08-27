require('../../src/content/ui-builder.js');

const { getSafeDisplayName } = window.CanvasDownloaderUI;

describe('getSafeDisplayName', () => {
    test('basic name + extension', () => {
        expect(getSafeDisplayName('Lecture Notes', '.pdf')).toBe('Lecture Notes.pdf');
    });

    test('strips each Windows-invalid character', () => {
        expect(getSafeDisplayName('a<b>c:d"e/f\\g|h?i*j', '.pdf')).toBe('a_b_c_d_e_f_g_h_i_j.pdf');
    });

    test('trims whitespace and trailing dots', () => {
        expect(getSafeDisplayName('  report...  ', '.pdf')).toBe('report.pdf');
    });

    test('truncates names longer than 120 characters', () => {
        const longName = 'a'.repeat(200);
        expect(getSafeDisplayName(longName, '.pdf')).toBe('a'.repeat(120) + '.pdf');
    });

    test('does not duplicate extension already present (case-insensitive)', () => {
        expect(getSafeDisplayName('report.PDF', '.pdf')).toBe('report.PDF');
    });

    test('falls back to "download" + extension for empty text', () => {
        expect(getSafeDisplayName('', '.pdf')).toBe('download.pdf');
    });

    test('does NOT apply Windows reserved-name handling (unlike getSafeFilename)', () => {
        // ui-builder.js's display-name sanitizer has no CON/NUL/COM1/etc. check —
        // confirms it stays bare, unlike download-engine.js's getSafeFilename.
        expect(getSafeDisplayName('CON', '.pdf')).toBe('CON.pdf');
        expect(getSafeDisplayName('NUL', '.pdf')).toBe('NUL.pdf');
    });

    test('does not append extension when extension is the literal "file" marker', () => {
        expect(getSafeDisplayName('Syllabus', 'file')).toBe('Syllabus');
    });

    test('still appends a real extension normally', () => {
        expect(getSafeDisplayName('Syllabus', '.docx')).toBe('Syllabus.docx');
    });

    test('preserves accented Latin and non-Latin scripts', () => {
        expect(getSafeDisplayName('café résumé', '.pdf')).toBe('café résumé.pdf');
        expect(getSafeDisplayName('日本語ファイル', '.docx')).toBe('日本語ファイル.docx');
    });
});
