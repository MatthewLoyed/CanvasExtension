const { detectFileType } = require('../../src/content/api.js');

// Same set (lowercase) the real scan code passes in.
const EXTENSIONS = ['.pdf', '.docx', '.pptx', '.zip', '.xlsx', '.txt', '.doc', '.ppt', '.xls'];

function makeLink({ text = '', title = null, className = '' } = {}) {
    const a = document.createElement('a');
    a.textContent = text;
    if (title !== null) a.setAttribute('title', title);
    if (className) a.className = className;
    return a;
}

describe('detectFileType', () => {
    test('matches an extension present directly in the URL', () => {
        const link = makeLink({ text: 'notes.pdf' });
        expect(detectFileType('https://canvas.example.edu/files/123/notes.pdf', link, EXTENSIONS)).toBe('.pdf');
    });

    test('URL extension match is case-insensitive', () => {
        const link = makeLink({ text: 'NOTES' });
        expect(detectFileType('https://canvas.example.edu/files/1/NOTES.PDF', link, EXTENSIONS)).toBe('.pdf');
    });

    test('Canvas /files/ path with extension only in the title attribute', () => {
        const link = makeLink({ text: 'Download', title: 'Lecture Slides.pptx' });
        expect(detectFileType('https://canvas.example.edu/courses/1/files/456/download', link, EXTENSIONS)).toBe('.pptx');
    });

    test('Canvas /files/ path with no extension anywhere falls back to generic "file"', () => {
        const link = makeLink({ text: 'Download' });
        expect(detectFileType('https://canvas.example.edu/courses/1/files/456/download', link, EXTENSIONS)).toBe('file');
    });

    test('a /files/.../folder/ path is excluded from the generic "file" fallback', () => {
        const link = makeLink({ text: 'Documents' });
        const result = detectFileType('https://canvas.example.edu/courses/1/files/folder/Documents', link, EXTENSIONS);
        expect(result).not.toBe('file');
        expect(result).toBeNull();
    });

    test('instructure_file_link class with extension only in the title', () => {
        const link = makeLink({ text: 'Download', title: 'Reading.docx', className: 'instructure_file_link' });
        expect(detectFileType('https://canvas.example.edu/some/redirect?verifier=abc', link, EXTENSIONS)).toBe('.docx');
    });

    test('instructure_scribd_file class with extension in the URL', () => {
        const link = makeLink({ text: 'Preview' });
        link.className = 'instructure_scribd_file';
        expect(detectFileType('https://canvas.example.edu/redirect/handout.xlsx', link, EXTENSIONS)).toBe('.xlsx');
    });

    test('plain link with extension mentioned only in link text', () => {
        const link = makeLink({ text: 'Syllabus.txt' });
        expect(detectFileType('https://canvas.example.edu/pages/syllabus', link, EXTENSIONS)).toBe('.txt');
    });

    test('returns null when there is no matching signal at all', () => {
        const link = makeLink({ text: 'Click here' });
        expect(detectFileType('https://canvas.example.edu/pages/welcome', link, EXTENSIONS)).toBeNull();
    });
});
