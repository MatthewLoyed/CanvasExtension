Canvas Downloader: Save Course Content and Files

Save available Canvas course materials with fewer clicks. Export a course for offline reading, or download selected module attachments.

New in version 1.12.0: Offline course export
Click Export course next to a course on your Canvas dashboard, or from inside the course. The extension saves available pages, announcements, assignment instructions, files, and images in one ZIP. Extract the ZIP and open index.html for a readable offline index with local attachments and links between saved content.

Follow the current export stage, estimated attachment progress, and ZIP creation in a compact dialog. Close the dialog to keep browsing the dashboard; the course button continues showing progress and can reopen the dialog. Stay on that Canvas page until the export finishes. Bounded parallel discovery and downloads help larger exports finish sooner. Retry missing files if a download fails.

Know what was saved
The ZIP includes export-report.html with skipped content, unavailable items, and collection restrictions. Exports depend on what your Canvas login can access. Locked or undiscoverable content may be absent. External links can still require internet access. Recordings, external tools, quiz content, grades, and student submissions are not included. This is an offline snapshot of available supported content, not a complete course backup or Canvas import package.

Module and page downloads
- Select whole modules or individual files and download separately or as a course-named ZIP.
- Module downloads use module folders. Shared Canvas files are saved once; distinct files with matching names are preserved.
- Find direct module files and attachments linked inside Canvas content, including images, HTML slides, and Quarto source.
- Keep the current page's file list or browse course modules.
- Track completed saves and retry failed files. ZIP retries create a separate archive.

Uses your existing Canvas login. Course content is processed locally and is not uploaded to the developer's servers. No new permissions were added for offline export.

Disclaimer: This independent project is not affiliated with or endorsed by Instructure Inc. or Canvas LMS.

Public source code, installation instructions, and release checksums: https://github.com/MatthewLoyed/CanvasExtension
Version 1.12.1 restores optional feedback submission with explicit disclosure and accurate error reporting.
Version 1.12.2 prevents duplicate download buttons beside Canvas file links.
