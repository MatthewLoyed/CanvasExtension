# Canvas Downloader

Chrome Manifest V3 extension for downloading Canvas LMS course resources, individually or as a ZIP. It adds a download menu to Canvas pages and resolves preview links through Canvas APIs using your existing browser session.

Current combined source version: **1.12.1**. Includes the newer module picker, download/ZIP fixes, and offline course export, plus restored feedback. See [RELEASE_STATUS.md](RELEASE_STATUS.md) for source/store distinctions.

## Install from source

1. Clone this repository or download a tagged source archive.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the repository folder containing `manifest.json`.
4. Reload your Canvas tab, sign in normally, and open a course or modules page.
5. Use the injected download menu to select files, scan course modules, and download individual files or a ZIP.

Settings are available from the extension popup. No API key, password, or build step is required. This project is independent of Instructure and your school.

## Offline course export

Use Save Course Offline to select available course content and attachments for a local ZIP with a browsable index and an export report. Canvas access controls still apply. Quizzes, grades, submissions, discussion replies, recordings, and external-site copies are excluded. Some attachments require separate software or internet access. Read the report for missing or partial items; an export is not a guarantee of a complete course backup. Course content is fetched and assembled locally; no course export is uploaded to the developer. Exported archives contain private course material: keep them private.

## Permissions and privacy

- `downloads`: saves selected resources with Chrome's download manager.
- `storage`: stores the folder preference in Chrome sync storage (which can sync across signed-in browsers).
- `tabs`: inspects the active tab and handles navigation updates.
- `scripting`: supports the legacy programmatic injection handler.
- `*://*/*` host access and content-script matching: supports Canvas on custom school domains and resources hosted on external domains. Scripts are loaded on matching HTTP/HTTPS pages; the downloader UI and scanning use Canvas DOM detection. Broad access is a real permission, and DOM detection is not a security boundary. You can restrict site access in Chrome, but this may break detection or external downloads.

Course discovery, URL resolution, and ZIP assembly run in your browser. Requests go to your Canvas server and resource hosts; normal browser session authentication is used where applicable. Course scan results are cached in the Canvas tab's sessionStorage. Downloaded files remain on your computer. There is no analytics or automatic course-data upload endpoint. Feedback you explicitly submit in the popup sends your message, type, extension version, and optional email through Formspree for storage and email delivery to the developer. It does not attach course files or browser details. The separate external support form uses Google Forms. These services process submitted information under their own privacy practices. See [privacy.html](privacy.html).

## Development and tests

Use Node.js 22 LTS and npm:

```sh
npm ci
npm test -- --runInBand
npm audit
```

The Jest suite covers filenames, download queues, module selection, ZIP contents, offline archive sanitization/transport, and feedback submission. It does not verify a live Canvas account, ZIP downloads, or browser permissions. Manually test those on a course you are authorized to access; never commit real course files, session cookies, or signed download URLs.

Source layout:

- `src/content/`: Canvas detection, scanning, API resolution, and injected UI.
- `src/background/`: download queue, ZIP assembly, and message handling.
- `src/popup/`: settings and feedback UI.
- `src/offline/`: bounded course export, HTML sanitization, local archive generation, and UI.
- `src/vendor/`: bundled JSZip and DOMPurify; see [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
- `tests/unit/`: Jest tests; other files in `tests/` are manual diagnostics/fixtures.

## Releases and verification

Source availability alone does not prove which code is installed. Release tags should identify the exact reviewed commit. A GitHub release ZIP built by CI includes only the manifest, source, icons, and license notices; CI attaches its SHA-256 checksum. Compare that package with any store upload before claiming they match. Existing store versions have not been verified against this repository.

Pushing a `v*` tag runs the release workflow; the tag version must match `manifest.json`. Pull requests and main-branch pushes run tests. The local `build_extension.ps1` is a legacy packaging tool that archives previous builds in a sibling folder.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Open issues for reproducible bugs without private course data. Known limitations include broad host permissions, heuristic Canvas detection, in-memory ZIP generation, and incomplete browser integration coverage.

Project code is MIT licensed. Third-party code retains its own license notices.
