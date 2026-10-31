param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$SourceRoot = Split-Path $PSScriptRoot -Parent
$Manifest = Get-Content -LiteralPath (Join-Path $SourceRoot 'manifest.json') -Raw | ConvertFrom-Json
$OutputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputRoot) { throw 'Choose a new directory; existing releases are preserved.' }
$Unpacked = Join-Path $OutputRoot 'Unpacked'
New-Item -ItemType Directory -Path $Unpacked -Force | Out-Null
foreach ($Name in @('manifest.json','src','assets','LICENSE','THIRD_PARTY_NOTICES.txt')) { Copy-Item -LiteralPath (Join-Path $SourceRoot $Name) -Destination $Unpacked -Recurse }
$Archive = Join-Path $OutputRoot "Canvas_Downloader_v$($Manifest.version)_STORE.zip"
Compress-Archive -Path (Join-Path $Unpacked '*') -DestinationPath $Archive
$Checksums = foreach ($File in Get-ChildItem -LiteralPath $Unpacked -Recurse -File) {
    $Relative = [IO.Path]::GetRelativePath($Unpacked, $File.FullName)
    $Hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
    if ($Hash -ne (Get-FileHash -LiteralPath (Join-Path $SourceRoot $Relative) -Algorithm SHA256).Hash) { throw "Source mismatch: $Relative" }
    [PSCustomObject]@{Path=$Relative;SHA256=$Hash}
}
$Checksums | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputRoot 'source-checksums.json')
foreach ($Name in @('STORE_LISTING.md','reviewer_note.txt')) { Copy-Item -LiteralPath (Join-Path $SourceRoot $Name) -Destination $OutputRoot }
$ZipHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
@"
Store candidate v$($Manifest.version). Not uploaded or submitted by packaging.
Verify the developer dashboard accepts this version before submission.
ZIP includes manifest.json, src/, assets/, and license notices; no course archives or credentials.
All $($Checksums.Count) unpacked files match source SHA-256.
ZIP SHA-256: $ZipHash
Listing and reviewer notes are alongside the archive, not inside it.
"@ | Set-Content -LiteralPath (Join-Path $OutputRoot 'RELEASE_README.txt')
Write-Output "Store candidate: $Archive"
Write-Output "Files: $($Checksums.Count) | ZIP SHA-256: $ZipHash"
