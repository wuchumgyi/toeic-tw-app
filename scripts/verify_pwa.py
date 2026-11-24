import functools
import http.server
import json
import os
import re
import threading
import urllib.request
from PIL import Image

DEPLOY = r"d:\AI tools\英文學習\pwa_deploy"

# 1. 檢查 manifest.webmanifest
manifest_path = os.path.join(DEPLOY, "manifest.webmanifest")
with open(manifest_path, encoding="utf-8") as f:
    manifest = json.load(f)

for key in ("name", "short_name", "start_url", "display", "icons"):
    assert manifest.get(key), f"Missing manifest key: {key}"

for ico in manifest["icons"]:
    src = ico["src"].lstrip("./")
    fp = os.path.join(DEPLOY, src)
    assert os.path.exists(fp), f"Missing icon: {fp}"
    w, h = map(int, ico["sizes"].split("x"))
    with Image.open(fp) as im:
        assert im.size == (w, h), f"Icon size mismatch for {src}: got {im.size}, expected {(w, h)}"

print("PASS: manifest.webmanifest schema & all PNG icon dimensions verified!")

# 2. 解析 sw.js 的 CORE_ASSETS 並用實際本機 HTTP 伺服器測試每個路徑回傳 200 OK
with open(os.path.join(DEPLOY, "sw.js"), encoding="utf-8") as f:
    sw_code = f.read()

m = re.search(r"CORE_ASSETS\s*=\s*\[(.*?)\];", sw_code, re.S)
assert m, "Could not parse CORE_ASSETS in sw.js"
assets = re.findall(r'"([^"]+)"', m.group(1))
assert len(assets) >= 8, "Too few assets in CORE_ASSETS"

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DEPLOY)
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
port = httpd.server_address[1]
t = threading.Thread(target=httpd.serve_forever, daemon=True)
t.start()

try:
    for rel in assets:
        path = "/" + rel.lstrip("./")
        url = f"http://127.0.0.1:{port}{path}"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = resp.read()
            assert resp.status == 200, f"HTTP {resp.status} for {rel}"
            assert len(data) > 0, f"Empty body for {rel}"
            print(f"  200 OK | {len(data):>7d} bytes | {rel}")
finally:
    httpd.shutdown()
    httpd.server_close()

print(f"PASS: All {len(assets)} Service Worker precache assets returned HTTP 200 OK!")
