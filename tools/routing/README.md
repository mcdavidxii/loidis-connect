# Local road routing (OSRM)

Real road travel times and distances for the rota engine, computed on this machine from public
OpenStreetMap data. Nothing leaves the machine and no personal data is involved.

- Maps: `data/routing/dorset-latest.osm.pbf` and `data/routing/west-yorkshire-latest.osm.pbf`
  (public OpenStreetMap extracts; `data/routing/` is git-ignored).
- Software: Docker image `ghcr.io/project-osrm/osrm-backend:v5.27.1` (pinned). If `docker pull` is refused
  ("denied", for example because of an expired ghcr.io login), fetch it anonymously and load it:
  see `tools/routing/load_image.py`.

```powershell
.\tools\routing\build.ps1            # once per map: extract, partition, customize (car profile, MLD)
.\tools\routing\servers.ps1 start    # loidis-osrm-dorset -> 127.0.0.1:5001, loidis-osrm-leeds -> 127.0.0.1:5002
.\tools\routing\servers.ps1 status
.\tools\routing\servers.ps1 stop
```

The containers restart with Docker unless stopped. Check one:
`curl "http://127.0.0.1:5001/table/v1/driving/-2.44,50.71;-2.45,50.61?annotations=duration,distance"`.

To update the maps, replace the `.osm.pbf` files and run `build.ps1` then `servers.ps1 start`.
Counties outside these two extracts are not covered: the service falls back to estimated travel there.
