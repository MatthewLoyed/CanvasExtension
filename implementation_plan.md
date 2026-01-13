# Professional Download Logic Audit & Refactoring Plan

## Goals
1.  **Eliminate "File not available" / .htm errors**: Ensure we never attempt to download a webpage as a file.
2.  **Professional Validation**: Implement "Look before you leap" logic using HTTP `HEAD` requests or intermediate fetching to resolve the *true* binary file URL before triggering `chrome.downloads`.
3.  **Robust Module Handling**: Stop guessing URLs for `/modules/items/`. Instead, fetch the wrapper page and scrape the actual file link from it.
4.  **Professional Organization**: Implement folder-based sorting (e.g., `Canvas Resources/Course Name/File.pdf`) and a visible progress queue.

## User Review Required
> [!IMPORTANT]
> This plan changes the "Download" button behavior to be **asynchronous**. When a user clicks "Download", there might be a brief "Resolving..." state while we fetch the final URL. This is standard professional behavior to ensure reliability.

## Proposed Changes

### Logic: The `resolveDownloadUrl(url)` Pattern
We will replace the synchronous `getDownloadUrl` (which guesses) with an asynchronous `resolveDownloadUrl` that *verifies*.

**The logic flow:**
1.  **Input**: A URL from the scraper.
2.  **Check 1 (Pattern Matching)**: 
    *   If it matches `/files/\d+/download`, it's likely good.
    *   If it matches `/files/\d+` (no download), append `/download`.
    *   If it matches `/modules/items/`, **FLAG AS WRAPPER**.
3.  **Action for Wrapper (Module Items)**:
    *   `fetch()` the wrapper page (DOM parser).
    *   Query selector for the "Download" button inside that page (usually `a[data-api-endpoint]` or having specific class `instructure_file_link`).
    *   Extract *that* URL.
4.  **Final Verification (Head Request)**:
    *   Perform a `fetch(url, {method: 'HEAD'})`.
    *   Check `Content-Type` header.
    *   If `text/html`, **ABORT** and throw error "Not a file".
    *   If `application/pdf`, `application/zip`, etc., **PROCEED**.

### Architecture Updates

#### [MODIFY] [sidepanel.js](file:///c:/Users/matth/Documents/CodedProjects/CanvasExtension/sidepanel.js)
-   **Add**: `async function resolveDownloadUrl(originalUrl)`
-   **Add**: `async function getTrueFileUrlFromModuleItem(moduleItemUrl)`
-   **Add**: `class DownloadQueue` to manage the batching (max 3 concurrent) and delays (100ms) as suggested by professional standards.
-   **Update**: `downloadAllFiles` to use the `DownloadQueue`.
-   **Feature**: **Folder Mapping**. We will extract the Course Name from the page context (sent via `update_files`) and use it to organize downloads: `filename: "Canvas_Resources/" + cleanCourseName + "/" + safeFilename`.

### Verification Plan
1.  **Manual Test (Module Item)**: Go to a Canvas "Module" page, find an item that is a PDF. Click download.
    *   *Expected*: Extension fetches the intermediate page, finds the real `/files/.../download` link, and downloads the PDF (not the HTML wrapper).
2.  **Manual Test (Batch & Folder)**: Click "Bulk Download".
    *   *Expected*: Files appear in `Downloads/Canvas_Resources/[Course Name]/`. Use a queue to download 3 at a time, avoiding browser throttling.
3.  **Negative Test**: Try to download a Page that is just text.
    *   *Expected*: Extension detects `Content-Type: text/html` and alerts "This is a page, not a file", effectively preventing the `.htm` bug. 
