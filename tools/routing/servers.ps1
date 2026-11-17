<#
Start or stop the local OSRM servers (127.0.0.1 only, restart unless stopped).
  .\tools\routing\servers.ps1 start    # loidis-osrm-dorset on 5001, loidis-osrm-leeds on 5002
  .\tools\routing\servers.ps1 stop
  .\tools\routing\servers.ps1 status
The service reads them from LOIDIS_OSRM_URLS (see service/README.md).
#>
param([Parameter(Mandatory)][ValidateSet("start", "stop", "status")][string]$Action)
$ErrorActionPreference = "Stop"
$Image = "ghcr.io/project-osrm/osrm-backend:v5.27.1"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Servers = @(@{ region = "dorset"; name = "loidis-osrm-dorset"; port = 5001 }, @{ region = "leeds"; name = "loidis-osrm-leeds"; port = 5002 })
foreach ($s in $Servers) {
    switch ($Action) {
        "start" {
            $dir = Join-Path $Root "data\routing\$($s.region)"
            if (-not (Test-Path (Join-Path $dir "$($s.region).osrm.mldgr"))) { throw "Run build.ps1 first ($($s.region))" }
            docker rm -f $s.name 2>$null | Out-Null
            docker run -d --name $s.name --restart unless-stopped -p "127.0.0.1:$($s.port):5000" -v "${dir}:/data" $Image `
                osrm-routed --algorithm mld --max-table-size 2000 /data/$($s.region).osrm | Out-Null
            Write-Host "$($s.name) on http://127.0.0.1:$($s.port)"
        }
        "stop" { docker stop $s.name 2>$null | Out-Null; docker rm $s.name 2>$null | Out-Null; Write-Host "$($s.name) stopped" }
        "status" { docker ps -a --filter "name=$($s.name)" --format "{{.Names}} {{.Status}} {{.Ports}}" }
    }
}
