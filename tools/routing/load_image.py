"""Fetch ghcr.io/project-osrm/osrm-backend:<tag> (linux/amd64) anonymously and write an OCI archive
that `docker load` accepts. Used because `docker pull` was refused ('denied') on this machine."""
import hashlib, io, json, sys, tarfile, urllib.request

REPO = "project-osrm/osrm-backend"
TAG = sys.argv[1]
OUT = sys.argv[2]
ACCEPT = ("application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, "
          "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json")


def token():
    r = urllib.request.urlopen(f"https://ghcr.io/token?scope=repository:{REPO}:pull")
    return json.load(r)["token"]


def get(path, tok, accept=ACCEPT):
    req = urllib.request.Request(f"https://ghcr.io/v2/{REPO}/{path}", headers={"Authorization": f"Bearer {tok}", "Accept": accept})
    return urllib.request.urlopen(req).read()


tok = token()
top = json.loads(get(f"manifests/{TAG}", tok))
if "manifests" in top:
    m = next(x for x in top["manifests"] if x["platform"]["architecture"] == "amd64" and x["platform"]["os"] == "linux")
    top_bytes = get(f"manifests/{m['digest']}", tok)
else:
    top_bytes = json.dumps(top).encode()
man = json.loads(top_bytes)
blobs = {}
for d in [man["config"]] + man["layers"]:
    dig = d["digest"]
    data = get(f"blobs/{dig}", tok)
    assert "sha256:" + hashlib.sha256(data).hexdigest() == dig
    blobs[dig] = data
    print("blob", dig[:19], len(data), flush=True)
mdig = "sha256:" + hashlib.sha256(top_bytes).hexdigest()
blobs[mdig] = top_bytes
index = {"schemaVersion": 2, "manifests": [{"mediaType": man.get("mediaType", "application/vnd.oci.image.manifest.v1+json"),
         "digest": mdig, "size": len(top_bytes), "annotations": {"io.containerd.image.name": f"ghcr.io/{REPO}:{TAG}",
         "org.opencontainers.image.ref.name": TAG}}]}
with tarfile.open(OUT, "w") as t:
    def add(name, data):
        ti = tarfile.TarInfo(name); ti.size = len(data); t.addfile(ti, io.BytesIO(data))
    add("oci-layout", b'{"imageLayoutVersion":"1.0.0"}')
    add("index.json", json.dumps(index).encode())
    for dig, data in blobs.items():
        add("blobs/sha256/" + dig.split(":")[1], data)
print("wrote", OUT)
