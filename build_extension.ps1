param (
    [string]$Status = "PENDING"
)

# Configuration
$ManifestPath = Join-Path $PSScriptRoot "manifest.json"
$TargetDir = Join-Path $PSScriptRoot "..\Builds-4-CanvasExtension"

# Read Manifest
if (-not (Test-Path $ManifestPath)) {
    Write-Error "manifest.json not found at $ManifestPath"
    exit 1
}

$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$Version = $Manifest.version
$Name = $Manifest.name

# Sanitize Name (Replace non-alphanumeric characters with underscores)
$SanitizedName = $Name -replace '[^a-zA-Z0-9]', '_'
$SanitizedName = $SanitizedName -replace '_+', '_' # Remove duplicate underscores
$SanitizedName = $SanitizedName -replace '^_|_$', '' # Remove leading/trailing underscores

# Construct Zip Name
$ZipName = "{0}_v{1}_{2}.zip" -f $SanitizedName, $Version, $Status
$ZipPath = Join-Path $TargetDir $ZipName

# Create Output Directory
if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    Write-Host "Created directory: $TargetDir"
}

# Remove existing zip if it exists
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
    Write-Host "Removed existing file: $ZipPath"
}

# Define Exclusions
$Exclude = @(
    ".git",
    ".gitignore",
    ".agent",
    "tests",
    "node_modules",
    "*.md", # README.md, STORE_LISTING.md, etc.
    "*.zip",
    "build_extension.ps1",
    "reviewer_note.txt",
    "privacy.html",
    ".DS_Store"
)

# Zip Files
# We need to selectively pipe items to Compress-Archive to handle exclusions properly
# Get-ChildItem -Exclude is sometimes finicky with recursive directories in PowerShell < 7, 
# but Compress-Archive takes a list of files.

Write-Host "Packaging extension..."
Write-Host "  Name: $SanitizedName"
Write-Host "  Version: $Version"
Write-Host "  Status: $Status"
Write-Host "  Output: $ZipPath"

# Simple approach: Get items in root, filter against exclusions, then zip
$ItemsToZip = Get-ChildItem -Path $PSScriptRoot -Exclude $Exclude | Where-Object { 
    $_.Name -notin $Exclude 
}

Compress-Archive -Path $ItemsToZip.FullName -DestinationPath $ZipPath -CompressionLevel Optimal

if (Test-Path $ZipPath) {
    Write-Host "Success! Created $ZipName"
} else {
    Write-Error "Failed to create zip file."
    exit 1
}
