param (
    [string]$Status = "PENDING"
)

# Configuration
$ManifestPath = Join-Path $PSScriptRoot "manifest.json"
$TargetRoot = Join-Path $PSScriptRoot "..\Builds-4-CanvasExtension"
$HistoryDir = Join-Path $TargetRoot "History"
$UnpackedDir = Join-Path $TargetRoot "Unpacked"

# Ensure Target Root Exists
if (-not (Test-Path $TargetRoot)) {
    New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
}

# --- ARCHIVAL PROCESS ---
Write-Host "Starting Archival Process..."

# 1. Create History Directory
if (-not (Test-Path $HistoryDir)) {
    New-Item -ItemType Directory -Path $HistoryDir -Force | Out-Null
    Write-Host "  Created History directory."
}

# 2. Archive Existing Zips
$ExistingZips = Get-ChildItem -Path $TargetRoot -Filter "*.zip"
foreach ($Zip in $ExistingZips) {
    Move-Item -Path $Zip.FullName -Destination $HistoryDir -Force
    Write-Host "  Archived Zip: $($Zip.Name)"
}

# 2a. Archive Legacy/Other Directories
# Moves any folder that isn't 'History' or 'Unpacked' into History
$LegacyFolders = Get-ChildItem -Path $TargetRoot -Directory | Where-Object { 
    $_.Name -ne "History" -and $_.Name -ne "Unpacked" 
}
foreach ($Folder in $LegacyFolders) {
    Move-Item -Path $Folder.FullName -Destination $HistoryDir -Force
    Write-Host "  Archived Folder: $($Folder.Name)"
}

# 3. Archive Existing Unpacked Folder
if (Test-Path $UnpackedDir) {
    # Try to determine version of the OLD unpacked folder
    $OldManifestPath = Join-Path $UnpackedDir "manifest.json"
    $OldVersion = "unknown"
    if (Test-Path $OldManifestPath) {
        try {
            $OldManifest = Get-Content $OldManifestPath -Raw | ConvertFrom-Json
            $OldVersion = $OldManifest.version
        } catch {
            Write-Warning "  Could not read version from existing Unpacked folder."
        }
    }
    
    $Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $ArchiveName = "Unpacked_v$($OldVersion)_$($Timestamp)"
    $ArchivePath = Join-Path $HistoryDir $ArchiveName
    
    Move-Item -Path $UnpackedDir -Destination $ArchivePath -Force
    Write-Host "  Archived Unpacked: $ArchiveName"
}

# --- BUILD PROCESS ---
Write-Host "`nStarting Build Process..."

# Read Manifest
if (-not (Test-Path $ManifestPath)) {
    Write-Error "manifest.json not found at $ManifestPath"
    exit 1
}

$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$Version = $Manifest.version
$Name = $Manifest.name

# Sanitize Name
$SanitizedName = $Name -replace '[^a-zA-Z0-9]', '_'
$SanitizedName = $SanitizedName -replace '_+', '_'
$SanitizedName = $SanitizedName -replace '^_|_$', ''

# Construct Zip Name
$ZipName = "{0}_v{1}_{2}.zip" -f $SanitizedName, $Version, $Status
$ZipPath = Join-Path $TargetRoot $ZipName

# Define Exclusions
$Exclude = @(
    ".git",
    ".gitignore",
    ".agent",
    "tests",
    "node_modules",
    "*.md",
    "*.zip",
    "build_extension.ps1",
    "reviewer_note.txt",
    "privacy.html",
    ".DS_Store"
)

Write-Host "  Packaging extension..."
Write-Host "  Name: $SanitizedName"
Write-Host "  Version: $Version"
Write-Host "  Output: $ZipPath"

# Zip Files
$ItemsToZip = Get-ChildItem -Path $PSScriptRoot -Exclude $Exclude | Where-Object { 
    $_.Name -notin $Exclude 
}

Compress-Archive -Path $ItemsToZip.FullName -DestinationPath $ZipPath -CompressionLevel Optimal

if (-not (Test-Path $ZipPath)) {
    Write-Error "Failed to create zip file."
    exit 1
}
Write-Host "  Success! Created zip."

# --- EXTRACTION PROCESS ---
Write-Host "`nStarting Extraction Process..."

# Extract to Unpacked
Expand-Archive -Path $ZipPath -DestinationPath $UnpackedDir -Force
Write-Host "  Extracted to: $UnpackedDir"
Write-Host "  Ready for 'Load Unpacked' testing!"
