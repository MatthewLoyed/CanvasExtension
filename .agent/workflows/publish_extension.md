---
description: Build, package, and prepare the Canvas Extension for release.
---

# Publish Extension Workflow

This workflow automates the process of packaging the extension and preparing it for the Chrome Web Store.

1. **Check Git Status**
   Ensure you are on the correct branch and verify what will be committed.
   ```bash
   git status
   ```

2. **Stage and Commit Changes**
   Stage all local changes and commit them.
   > [!IMPORTANT]
   > Ensure you have bumped the version in `manifest.json` BEFORE running this workflow if this is a new release.
   ```bash
   git add .
   git commit -m "Prepare release build"
   ```

3. **Run Build Script**
   Execute the PowerShell build script to create the zip file.
   // turbo
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\build_extension.ps1 -Status "PENDING"
   ```

4. **Verify Zip Contents**
   Inspect the contents of the most recently created zip file to ensure correctness.
   ```powershell
   powershell -Command "Write-Host 'Checking latest zip...'; $LatestZip = Get-ChildItem ..\Builds-4-CanvasExtension\*.zip | Sort-Object LastWriteTime -Descending | Select-Object -First 1; Write-Host 'Found:' $LatestZip.Name; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead($LatestZip.FullName).Entries | Select-Object FullName"
   ```

5. **Extract and Test**
   The agent will extract the zip to an `Unpacked` folder for verification.
   // turbo
   ```powershell
   powershell -Command "Write-Host 'Extracting latest zip...'; $LatestZip = Get-ChildItem ..\Builds-4-CanvasExtension\*.zip | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $Dest = '..\Builds-4-CanvasExtension\Unpacked'; if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }; Expand-Archive -Path $LatestZip.FullName -DestinationPath $Dest; Write-Host 'Extracted to:' $Dest"
   ```
   > [!TIP]
   > 1. Go to `chrome://extensions`
   > 2. Enable **Developer mode**
   > 3. Click **Load unpacked**
   > 4. Select the `..\Builds-4-CanvasExtension\Unpacked` folder
   > 5. Verify the extension loads and functions correctly.

6. **Publishing Instructions**
   Follow these steps to publish to the Chrome Web Store:

   1.  **Log in** to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/dev/dashboard).
   2.  **Select** the extension: *Canvas LMS Bulk Downloader & Resource Saver*.
   3.  **Navigate** to **Package** in the left sidebar.
   4.  **Click** the **Upload new package** button.
   5.  **Upload** the zip file found in `..\Builds-4-CanvasExtension` (the one identified in step 4).
       - *Tip: You can drag and drop the file from your file explorer.*
   6.  **Verify** the version number matches your manifest.
   7.  **Click** **Submit for review** (or "Save draft" if you aren't ready).

