#!/usr/bin/env python3
"""Build a deterministic Chrome Web Store ZIP from an explicit runtime allowlist."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'manifest.json').read_text())
version = manifest['version']
if not re.fullmatch(r'\d+(?:\.\d+){0,3}', version):
    raise SystemExit('Invalid extension version')
files = {
    'manifest.json', 'background.js', 'sidepanel.html', 'sidepanel.css',
    'sidepanel.js', 'storage.js', 'i18n.js', 'sanitize.js', 'highlighter.js', 'excel-export.js',
    'LICENSE', 'lib/jszip.min.js', 'lib/cpexcel.js', 'lib/xlsx-js-style.min.js',
    'lib/THIRD_PARTY_LICENSES.md', 'icons/ui/LICENSE',
    *manifest['icons'].values(), *manifest['action']['default_icon'].values(),
}
files.update(str(path.relative_to(ROOT)) for path in (ROOT / 'icons/ui').glob('*.svg'))
html = (ROOT / 'sidepanel.html').read_text()
for ref in re.findall(r'(?:src|href)="([^"]+)"', html):
    if re.match(r'^(?:https?:|#)', ref):
        continue
    if ref not in files:
        raise SystemExit(f'Unpackaged HTML dependency: {ref}')
css = (ROOT / 'sidepanel.css').read_text()
for ref in re.findall(r'url\([\'"]?([^\)\'\"]+)', css):
    if not ref.startswith('data:') and ref not in files:
        raise SystemExit(f'Unpackaged CSS dependency: {ref}')
for ref in [manifest['background']['service_worker'], manifest['side_panel']['default_path']]:
    if ref not in files:
        raise SystemExit(f'Unpackaged manifest dependency: {ref}')
for name in files:
    path = ROOT / name
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
        raise SystemExit(f'Invalid runtime file: {name}')
output = ROOT / 'dist' / f'article-saver-{version}.zip'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted(files):
        info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (ROOT / name).read_bytes())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == files
    assert json.loads(archive.read('manifest.json')) == manifest
    for name in files:
        assert archive.read(name) == (ROOT / name).read_bytes()
digest = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n')
print(f'{output}\n{len(files)} files; {output.stat().st_size:,} bytes\nSHA-256: {digest}')
