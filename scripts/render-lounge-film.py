"""Render the original, silent After Hours ambient loop. Requires Pillow + ffmpeg."""
from pathlib import Path
import math
import random
import subprocess
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'apps/web/public/media'
OUT.mkdir(parents=True, exist_ok=True)
WIDTH, HEIGHT, FPS, SECONDS = 960, 540, 24, 16
rng = random.Random(4)
stars = [(rng.randrange(WIDTH), rng.randrange(280), rng.random()) for _ in range(65)]
buildings = [(x, rng.randrange(75, 220), rng.randrange(28, 62)) for x in range(-30, 1000, 42)]
encoder = subprocess.Popen([
    'ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
    '-video_size', f'{WIDTH}x{HEIGHT}', '-framerate', str(FPS), '-i', '-', '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', str(OUT / 'lounge-after-hours.mp4'),
], stdin=subprocess.PIPE)
for frame in range(FPS * SECONDS):
    phase = frame / (FPS * SECONDS) * math.tau
    picture = Image.new('RGB', (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(picture)
    for y in range(HEIGHT):
        p = y / HEIGHT
        draw.line((0, y, WIDTH, y), fill=(int(9 + p * 16), int(24 + p * 20), int(38 + p * 11)))
    draw.ellipse((665, 55, 754, 144), fill=(206, 197, 163))
    draw.ellipse((682, 43, 766, 130), fill=(12, 29, 41))
    for x, y, offset in stars:
        light = int(135 + 50 * math.sin(phase + offset * math.tau))
        draw.ellipse((x, y, x + 1, y + 1), fill=(light, light + 10, min(255, light + 25)))
    for index, (x, height, width) in enumerate(buildings):
        top = 345 - height
        draw.rectangle((x, top, x + width, 345), fill=(17 + index % 3 * 3, 38 + index % 3 * 3, 45 + index % 3 * 4))
        for row in range(0, height - 14, 17):
            for col in range(7, width - 4, 12):
                if (row + col + index) % 5 == 0:
                    continue
                light = int(145 + 22 * math.sin(phase + index * .7 + row))
                draw.rectangle((x + col, top + row + 8, x + col + 3, top + row + 13), fill=(light, int(light * .9), int(light * .63)))
    draw.rectangle((0, 345, WIDTH, 352), fill=(79, 91, 79))
    for row in range(355, HEIGHT, 4):
        depth = (row - 355) / (HEIGHT - 355)
        for index, (x, height, width) in enumerate(buildings):
            shift = math.sin(phase + row * .12) * (3 + depth * 13)
            length = 4 + height * .045
            draw.line((x + shift, row, x + length + shift, row), fill=(int(69 - depth * 37), int(76 - depth * 40), int(60 - depth * 27)), width=1)
    # Two slow, looping ferry lights on the water; no third-party imagery or audio.
    for offset in [0, .52]:
        x = ((frame / (FPS * SECONDS) + offset) % 1) * (WIDTH + 160) - 80
        y = 385 + offset * 110
        draw.line((x, y, x + 48, y), fill=(172, 158, 116), width=2)
        draw.line((x - 20, y + 6, x + 5, y + 6), fill=(67, 95, 96))
    if frame == 0:
        picture.save(OUT / 'lounge-after-hours.webp', quality=90)
    encoder.stdin.write(picture.tobytes())
encoder.stdin.close()
if encoder.wait():
    raise SystemExit('Video encoding failed')
print(OUT / 'lounge-after-hours.mp4')
