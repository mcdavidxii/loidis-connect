<#
Build OSRM road-routing data (car profile, MLD) from the OpenStreetMap extracts in data/routing/.
  .\tools\routing\build.ps1                 # both regions
  .\tools\routing\build.ps1 -Region dorset  # one region
Needs Docker running and the image ghcr.io/project-osrm/osrm-backend:v5.27.1 (see README.md).
Input : data/routing/<pbf>   Output: data/routing/<region>/<region>.osrm*   (git-ignored)
Nothing is downloaded by this script and no personal data is involved.
#>
param([ValidateSet("dorset", "leeds", "all")][string]$Region = "all")
$ErrorActionPreference = "Stop"
$Image = "ghcr.io/project-osrm/osrm-backend:v5.27.1"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Data = Join-Path $Root "data\routing"
$Extracts = @{ dorset = "dorset-latest.osm.pbf"; leeds = "west-yorkshire-latest.osm.pbf" }

$regions = if ($Region -eq "all") { @("dorset", "leeds") } else { @($Region) }
foreach ($r in $regions) {
    $dir = Join-Path $Data $r
    New-Item -ItemType Directory -Force $dir | Out-Null
    $pbf = Join-Path $Data $Extracts[$r]
    if (-not (Test-Path $pbf)) { throw "Missing $pbf" }
    Copy-Item $pbf (Join-Path $dir "$r.osm.pbf") -Force
    Write-Host "== $r : extract"
    docker run --rm -v "${dir}:/data" $Image osrm-extract -p /opt/car.lua /data/$r.osm.pbf
    if ($LASTEXITCODE) { throw "osrm-extract failed" }
    Write-Host "== $r : partition"
    docker run --rm -v "${dir}:/data" $Image osrm-partition /data/$r.osrm
    if ($LASTEXITCODE) { throw "osrm-partition failed" }
    Write-Host "== $r : customize"
    docker run --rm -v "${dir}:/data" $Image osrm-customize /data/$r.osrm
    if ($LASTEXITCODE) { throw "osrm-customize failed" }
    Remove-Item (Join-Path $dir "$r.osm.pbf")   # the extract stays in data/routing/
    Write-Host "== $r : done"
}
