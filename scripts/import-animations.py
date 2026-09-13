#!/usr/bin/env python3
"""Rebuild only imported clips from their pinned, hash-checked upstream sources.

Requires Python 3 and ffmpeg with libvpx-vp9. Existing original clips are untouched.
Run from any directory: python3 scripts/import-animations.py
"""
import concurrent.futures
import hashlib
import json
import math
import pathlib
import re
import subprocess
import tempfile
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'assets/animation-sources.json'


def encode(entry, revision, cache):
    name = entry['name']
    if '/' in name or '\\' in name or name in {'.', '..'}:
        raise ValueError('Invalid animation name')
    source = cache / (name + '.webm')
    url = ('https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/' +
           revision + '/' + urllib.parse.quote(entry['upstreamPath']))
    source.write_bytes(urllib.request.urlopen(url, timeout=45).read())
    data = source.read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if blob != entry['gitBlob']:
        raise ValueError('Upstream content changed: ' + name)
    scan = subprocess.run(
        ['ffmpeg', '-hide_banner', '-c:v', 'libvpx-vp9', '-i', str(source),
         '-vf', 'alphaextract,bbox=min_val=16', '-an', '-f', 'null', '-'],
        capture_output=True, check=True).stderr.decode()
    boxes = re.findall(r'x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)', scan)
    if not boxes:
        raise ValueError('No visible frames: ' + name)
    radius = max(max(320-int(a), int(b)-320+1) for a, b, _, _ in boxes)
    width = min(640, max(360, math.ceil(radius)*2+8))
    height = int(360*360/width)//2*2
    y = min(360-height, round(330*(1-360/width)))
    filters = (f'crop={width}:360:{(640-width)//2}:0,'
               f'scale=360:{height}:flags=lanczos,'
               f'pad=360:360:0:{y}:color=black@0,'
               "lut=a='if(lt(val,12),0,val)',setsar=1")
    target = cache / (name + '-converted.webm')
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(source),
         '-vf', filters, '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
         '-b:v', '0', '-crf', '38', '-row-mt', '1', '-threads', '2',
         '-cpu-used', '4', '-y', str(target)], check=True)
    output = target.read_bytes()
    destination = ROOT / 'assets/anim' / (name + '.webm')
    staged = destination.with_suffix('.webm.tmp')
    staged.write_bytes(output)
    staged.replace(destination)
    print(name, len(output), flush=True)
    return {**entry, 'filter': filters, 'bytes': len(output),
            'sha256': hashlib.sha256(output).hexdigest()}


def main():
    manifest = json.loads(MANIFEST.read_text())
    revision = manifest['commit']
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Expected a pinned commit')
    with tempfile.TemporaryDirectory(prefix='kujira-assets-') as folder:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            manifest['added'] = list(pool.map(
                lambda entry: encode(entry, revision, pathlib.Path(folder)),
                manifest['added']))
    manifest['encoding'] = 'VP9 alpha, 360x360, CRF 38; alpha <12 cleared; full-clip visible bounds'
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    config_path = ROOT / 'assets/pet.config.json'
    config = json.loads(config_path.read_text())
    anchors = {}
    for entry in manifest['added']:
        width, height, y = map(int, re.search(
            r'crop=(\d+):360:.*?scale=360:(\d+).*?pad=360:360:0:(\d+)', entry['filter']).groups())
        if width != 360 or height != 360 or y:
            anchors[entry['name']] = {
                'width': round(360 / width, 6), 'height': round(height / 360, 6),
                'top': round(y / 360, 6)}
    config.pop('animationFraming', None)
    config['animationAnchors'] = anchors
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2)+'\n')
    print('TOTAL', sum(entry['bytes'] for entry in manifest['added']), flush=True)


if __name__ == '__main__':
    main()
