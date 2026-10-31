const fs = require('fs');
const path = require('path');

describe('course archive names across Canvas layouts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.title = '';
        window.eval(fs.readFileSync(path.join(__dirname, '../../src/content/api.js'), 'utf8'));
        window.CanvasDownloader.extractCourseId = () => '180189';
    });

    test('finds the course link in an ordered breadcrumb list without a dashboard crumb', () => {
        document.body.innerHTML = '<nav id="breadcrumbs"><ol><li><a href="/courses/180189">CSE-6223-01-202630</a></li><li>Modules</li></ol></nav>';
        expect(window.CanvasDownloader.getCourseName()).toBe('CSE-6223-01-202630');
    });

    test('skips Dashboard and Courses in the older breadcrumb layout', () => {
        document.body.innerHTML = '<nav id="breadcrumbs"><ul><li>Dashboard</li><li>Courses</li><li><a href="/courses/180189/">Software Projects</a></li><li>Files</li></ul></nav>';
        expect(window.CanvasDownloader.getCourseName()).toBe('Software Projects');
    });

    test('uses a plain course crumb on the home page', () => {
        document.body.innerHTML = '<nav id="breadcrumbs"><ol><li>CSE-6223-01-202630</li></ol></nav>';
        expect(window.CanvasDownloader.getCourseName()).toBe('CSE-6223-01-202630');
    });

    test('uses the course portion of the title when a theme replaces breadcrumbs', () => {
        document.title = 'Course Modules: Managing Software Projects';
        expect(window.CanvasDownloader.getCourseName()).toBe('Managing Software Projects');
    });

    test('uses the course ID as a meaningful last fallback', () => {
        document.title = 'Modules';
        expect(window.CanvasDownloader.getCourseName()).toBe('Canvas_Course_180189');
    });
});
