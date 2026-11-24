import os
import shutil

BASE = r"d:\AI tools\英文學習"
DEPLOY = os.path.join(BASE, "pwa_deploy")

if os.path.exists(DEPLOY):
    shutil.rmtree(DEPLOY)
os.makedirs(DEPLOY, exist_ok=True)

ROOT_FILES = [
    "index.html",
    "manifest.webmanifest",
    "sw.js",
    ".nojekyll",
]

for fname in ROOT_FILES:
    shutil.copy2(os.path.join(BASE, fname), os.path.join(DEPLOY, fname))

shutil.copytree(os.path.join(BASE, "assets"), os.path.join(DEPLOY, "assets"))

total_bytes = 0
file_count = 0
for root, _, files in os.walk(DEPLOY):
    for f in files:
        fp = os.path.join(root, f)
        total_bytes += os.path.getsize(fp)
        file_count += 1

print(f"Built clean pwa_deploy/: {file_count} files, {total_bytes / 1024:.1f} KB total")
