---
description: Build, package, and prepare the Canvas Extension for release.
---

# Publish Extension Workflow

This workflow automates the process of packaging the extension and preparing it for the Chrome Web Store.

1. **Review and Update Documentation**
   Before building, the agent MUST review the project for any out-of-date information. Specifically verify:
   - `privacy.html`: Ensure the date, product name, and permission justifications are accurate for the current release.
   - `reviewer_note.txt`: Ensure the tester instructions accurately reflect the current UI and functionality of the extension.
   - `STORE_LISTING.md`: Ensure the description matches the latest features.
   If any of these files are outdated, update them before proceeding.

2. **Check Git Status**
   Ensure you are on the correct branch and verify what will be committed.
   ```bash
   git status
   ```

3. **Stage and Commit Changes**
   Stage all local changes and commit them.
   > [!IMPORTANT]
   > Ensure you have bumped the version in `manifest.json` BEFORE running this workflow if this is a new release.
   ```bash
   git add .
   git commit -m "Prepare release build"
   ```

4. **Run Build Script**
   Execute the PowerShell build script to create the zip file.
   // turbo
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\build_extension.ps1 -Status "PENDING"
   ```

5. **Verify Zip Contents**
   Inspect the contents of the most recently created zip file to ensure correctness.
   ```powershell
   powershell -Command "Write-Host 'Checking latest zip...'; $LatestZip = Get-ChildItem ..\Builds-4-CanvasExtension\*.zip | Sort-Object LastWriteTime -Descending | Select-Object -First 1; Write-Host 'Found:' $LatestZip.Name; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead($LatestZip.FullName).Entries | Select-Object FullName"
   ```

6. **Extract and Test**
   The build script has automatically extracted the extension to the `Unpacked` folder.
   > [!TIP]
   > 1. Go to `chrome://extensions`
   > 2. Enable **Developer mode**
   > 3. Click **Load unpacked** (or verify the existing one is reloaded)
   > 4. Select the `..\Builds-4-CanvasExtension\Unpacked` folder
   > 5. Verify the extension loads and functions correctly.

7. **Publishing Instructions**
   Follow these steps to publish to the Chrome Web Store:

   1.  **Log in** to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/dev/dashboard).
   2.  **Select** the extension: *Canvas LMS Bulk Downloader & Resource Saver*.
   3.  **Navigate** to **Package** in the left sidebar.
   4.  **Click** the **Upload new package** button.
   5.  **Upload** the zip file found in `..\Builds-4-CanvasExtension` (the one identified in step 4).
       - *Tip: You can drag and drop the file from your file explorer.*
   6.  **Verify** the version number matches your manifest.
   7.  **Click** **Submit for review** (or "Save draft" if you aren't ready).
