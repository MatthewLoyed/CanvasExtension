# Canvas Bulk Downloader

A tailored Chrome Extension designed to fix the "broken download" experience often found on Canvas LMS and university policy sites.

### ⚡ The Problem
Canvas often serves files inside HTML "wrapper" pages (previews) rather than direct binary links. Standard bulk downloaders or "Save Link As" often result in useless `.htm` files instead of the actual `.pdf` or `.docx`.

### 🛠 The Solution
This extension injects a sidebar that scans the current course or module and intelligently resolves the *true* download URL before queuing the file.

**Key Features:**
* **Smart Resolution Engine:** Automatically detects if a link is a direct file, a Canvas API asset, or an HTML wrapper.
* **Deep Unpacking:** Scrapes intermediate "wrapper" pages to locate and extract the actual binary file link (fixing the "policies.msstate.edu" redirect issue).
* **API Proxying:** Leverages a content script bridge to securely fetch signed URLs from the Canvas API (`/api/v1/files/`) using the user's existing session cookies.
* **Download Queue:** Manages concurrency to prevent browser throttling during bulk operations.
* **Sanitized Filenames:** automatically renames files to be file-system safe.

### 🏗 Technical Stack
* **Manifest V3**
* **Vanilla JavaScript** (No heavy frameworks)
* **Chrome Downloads API** & **Tabs API**
* **Custom Logging System:** Dev-mode toggle for granular debugging of the resolution chain.

---
*Disclaimer: This is a personal project intended for educational use and easier file management.*
