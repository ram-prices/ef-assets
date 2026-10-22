"""Makes a looping page background from a game recording.

Cuts `--length` seconds starting at `--start` (minus the bottom strip where
the game prints the player's UID), makes the end flow back into
the start (its last `--fade` seconds crossfade into the frames just before
the cut, so the loop has no jump), scales it to 1280x720 at 24 fps, drops the
sound, and writes:

- backgrounds/<id>.webm (VP9) and backgrounds/<id>.mp4 (H.264, for Safari)
- backgrounds/<id>.jpg, its first frame, shown while it loads and when
  motion is off
- an entry in backgrounds/index.json: the clip's name, and the operators
  whose pages use it (`--operators`), or add it to the clips that operator
  pages without one of their own pick from at random (`--default`)

    python scripts/background-clip.py <recording.mp4> <id> --start 12.5 --length 8
        [--fade 1] [--name "Valley IV, dusk"] [--operators chr_0026_lastrite,...]
        [--default] [--out <dir>]

Needs ffmpeg on PATH (or the imageio-ffmpeg Python package). Aim for clips
under 8 MB; the site's CDN won't serve files over 20 MB.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, FPS = 1280, 720, 24
# The game prints the player's ping and UID along the bottom edge: always cut off.
BOTTOM = 0.05
# Higher is smaller and softer; the site darkens and blurs the clip a little anyway.
VP9_CRF, H264_CRF = 40, 28


def ffmpeg():
    found = shutil.which('ffmpeg')
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit('Needs ffmpeg: install it (winget install Gyan.FFmpeg) or pip install imageio-ffmpeg.')


def run(args):
    subprocess.run([ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('recording')
    p.add_argument('id')
    p.add_argument('--start', type=float, default=0)
    p.add_argument('--length', type=float, default=8)
    p.add_argument('--fade', type=float, default=1)
    p.add_argument('--name')
    p.add_argument('--operators', default='')
    p.add_argument('--default', action='store_true')
    p.add_argument('--out', default=os.path.join(ROOT, 'backgrounds'))
    a = p.parse_args()
    if a.fade * 2 > a.length:
        sys.exit('--fade must be at most half of --length')
    os.makedirs(a.out, exist_ok=True)
    base = os.path.join(a.out, a.id)

    # Read length + fade seconds; play from `fade` on, and over its last
    # `fade` seconds blend into the first `fade` seconds, which come right
    # before where the output starts: the end runs straight into the start.
    L, F = a.length, a.fade
    graph = (
        f'[0:v]trim=duration={L + F},setpts=PTS-STARTPTS,crop=iw:ih*{1 - BOTTOM}:0:0,'
        f'scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},fps={FPS},format=yuv420p,split[a][b];'
        f'[a]trim=start={F},setpts=PTS-STARTPTS,fps={FPS}[main];'
        f'[b]trim=duration={F},setpts=PTS-STARTPTS,fps={FPS}[head];'
        f'[main][head]xfade=transition=fade:duration={F}:offset={L - F},'
        # xfade hands back 4:4:4, which Safari's H.264 and most VP9 decoders won't
        # play, and game recordings are full range: plain 4:2:0, TV range, square pixels.
        f'scale=out_range=tv,format=yuv420p,setsar=1[out]'
    )
    cut = ['-ss', str(a.start), '-t', str(L + F + 0.5), '-i', a.recording, '-filter_complex', graph, '-map', '[out]', '-an', '-pix_fmt', 'yuv420p', '-color_range', 'tv']
    run([*cut, '-c:v', 'libvpx-vp9', '-crf', str(VP9_CRF), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', f'{base}.webm'])
    run([*cut, '-c:v', 'libx264', '-crf', str(H264_CRF), '-preset', 'slow', '-movflags', '+faststart', f'{base}.mp4'])
    run(['-i', f'{base}.mp4', '-frames:v', '1', '-q:v', '4', f'{base}.jpg'])

    index_path = os.path.join(a.out, 'index.json')
    index = json.load(open(index_path, encoding='utf8')) if os.path.exists(index_path) else {'clips': {}, 'operators': {}, 'default': []}
    index['clips'][a.id] = {'name': a.name or a.id}
    for op in filter(None, a.operators.split(',')):
        index['operators'][op.strip()] = a.id
    if a.default and a.id not in index['default']:
        index['default'].append(a.id)
    with open(index_path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
        f.write('\n')

    for ext in ('webm', 'mp4', 'jpg'):
        size = os.path.getsize(f'{base}.{ext}') / 1e6
        print(f'{a.id}.{ext}: {size:.1f} MB' + ('  (over 8 MB: try a shorter --length)' if size > 8 else ''))


if __name__ == '__main__':
    main()
