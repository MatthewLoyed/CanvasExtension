param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$SourceRoot = Split-Path $PSScriptRoot -Parent
$OutputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputRoot) { throw 'Choose a new output directory; existing builds are never overwritten.' }
$Unpacked = Join-Path $OutputRoot 'Unpacked'
New-Item -ItemType Directory -Path $Unpacked -Force | Out-Null
foreach ($Name in @('manifest.json','src','assets')) { Copy-Item -LiteralPath (Join-Path $SourceRoot $Name) -Destination $Unpacked -Recurse }
$Archive = Join-Path $OutputRoot 'Canvas_Downloader_OFFLINE_PREVIEW_NOT_FOR_STORE.zip'
Compress-Archive -Path (Join-Path $Unpacked '*') -DestinationPath $Archive
$Checksums = foreach ($File in Get-ChildItem -LiteralPath $Unpacked -Recurse -File) {
    $Relative = [IO.Path]::GetRelativePath($Unpacked, $File.FullName)
    $Original = Join-Path $SourceRoot $Relative
    $Hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
    if ($Hash -ne (Get-FileHash -LiteralPath $Original -Algorithm SHA256).Hash) { throw "Package mismatch: $Relative" }
    [PSCustomObject]@{Path=$Relative;SHA256=$Hash}
}
$Checksums | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputRoot 'source-checksums.json')
$ZipHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
@"
LOCAL PREVIEW — NOT FOR STORE UPLOAD
Source: $SourceRoot
Manifest version is intentionally unchanged at 1.11.0. This is not a released update.
No installed extension or previous build was modified by packaging.
All $($Checksums.Count) unpacked files match source SHA-256.
ZIP SHA-256: $ZipHash
Read OFFLINE_EXPORT_IMPLEMENTATION.md in the source repository for validation and remaining release gates.
"@ | Set-Content -LiteralPath (Join-Path $OutputRoot 'PREVIEW_README.txt')
Write-Output "Preview: $Archive"
Write-Output "Files: $($Checksums.Count) | ZIP SHA-256: $ZipHash"
