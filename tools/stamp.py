#!/usr/bin/env python3
"""给页面里的 CSS / JS 链接加上内容版本号（?v=前 8 位哈希），改过的文件浏览器会重新下载。
发布前在站点根目录运行：python3 tools/stamp.py"""
import glob, hashlib, os, re

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)
pattern = re.compile(r'((?:href|src)="(/[^"?#]+\.(?:css|js)))(?:\?v=[0-9a-f]+)?"')

def version(path):
    with open(path.lstrip("/"), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:8]

for page in glob.glob("**/*.html", recursive=True):
    with open(page, encoding="utf-8") as f:
        text = f.read()
    new = pattern.sub(lambda m: f'{m.group(1)}?v={version(m.group(2))}"', text)
    if new != text:
        with open(page, "w", encoding="utf-8") as f:
            f.write(new)
        print("stamped", page)
