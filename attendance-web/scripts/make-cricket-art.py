#!/usr/bin/env python3
"""Draws every picture of the cricket theme from code. Run it to redraw them:

    python3 attendance-web/scripts/make-cricket-art.py

Needs only Pillow. Out come small PNGs in src/cricket/art/, shown large with
`image-rendering: pixelated`, plus sprites.json saying where each pose sits.

All of it is original: no real player, team, league or logo. Figures are built
from a skeleton, so a new pose is a new set of joints rather than a new drawing.
"""
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "src" / "cricket" / "art"
OUT.mkdir(parents=True, exist_ok=True)

SKIN, SKIN_D = (201, 138, 92), (156, 100, 62)
JERSEY, JERSEY_D = (0, 94, 184), (0, 62, 130)
TRIM = (255, 204, 0)
WHITE, WHITE_D = (240, 243, 238), (186, 194, 190)
HELMET, HELMET_D = (20, 34, 66), (10, 18, 38)
GRILL = (150, 160, 170)
WOOD, WOOD_D = (226, 186, 120), (170, 126, 70)
GRIP = (40, 40, 44)
SHOE = (232, 232, 228)
BLACK = (14, 19, 24)
UMP_SHIRT, UMP_SHIRT_D = (238, 238, 232), (196, 198, 192)
UMP_TROUSER, UMP_TROUSER_D = (32, 38, 50), (18, 22, 30)
UMP_HAT = (240, 232, 205)
BALL, BALL_D = (214, 40, 46), (140, 18, 26)
STUMP, STUMP_D = (235, 215, 170), (176, 146, 96)
PAD, PAD_D = (252, 252, 248), (192, 199, 197)
GLOVE, GLOVE_D = (248, 248, 244), (160, 170, 168)
OUTLINE = (6, 12, 20)

CELL = 48  # one pose: 48 x 48 pixels, feet on line 44, facing right


def limb(d, a, b, width, col, dark=None):
    """A chunky arm or leg, with a darker underside so it reads at small size."""
    if dark:
        d.line([(a[0], a[1] + 1), (b[0], b[1] + 1)], fill=dark, width=width)
    d.line([a, b], fill=col, width=width)


def outlined(im):
    """A dark rim round the figure, so it holds up over grass and crowd at any size."""
    w, h = im.size
    px = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if 0 <= x + dx < w and 0 <= y + dy < h and px[x + dx, y + dy][3]:
                    op[x, y] = OUTLINE + (255,)
                    break
    out.alpha_composite(im)
    return out


def bat(d, hand, angle_deg, length=15):
    """Grip, a maker's band under the shoulder, the blade, and a darker toe."""
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    at = lambda k: (hand[0] + c * k, hand[1] + s * k)  # noqa: E731
    d.line([hand, at(4)], fill=GRIP, width=2)
    d.line([at(4), at(length)], fill=WOOD_D, width=4)
    d.line([at(4), at(length)], fill=WOOD, width=3)
    d.line([at(5.5), at(7)], fill=TRIM, width=3)
    d.line([at(length - 2), at(length)], fill=WOOD_D, width=3)


def pad(d, knee, foot, back=False):
    """A batting pad from just over the knee to the boot: ribbed, with a knee roll."""
    top = (knee[0] - (foot[0] - knee[0]) * 0.25, knee[1] - (foot[1] - knee[1]) * 0.25)
    d.line([top, foot], fill=PAD_D, width=6)
    d.line([top, foot], fill=PAD_D if back else PAD, width=5)
    d.line([top, foot], fill=(170, 178, 176) if back else PAD_D, width=1)
    d.line([(top[0] - 2, top[1]), (top[0] + 2, top[1])], fill=(170, 178, 176), width=2)


def glove(d, hand):
    x, y = hand
    d.rectangle([x - 2, y - 1, x + 1, y + 2], fill=GLOVE)
    d.line([(x - 2, y + 2), (x + 1, y + 2)], fill=GLOVE_D)


def boot(d, foot):
    d.rectangle([foot[0] - 1, foot[1], foot[0] + 3, foot[1] + 1], fill=SHOE)
    d.point((foot[0] + 3, foot[1] + 1), fill=(150, 150, 146))


def batter(p):
    """p: hips, chest, head, front/back foot+knee, hands, bat angle."""
    im = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    hip, chest, head = p["hip"], p["chest"], p["head"]
    # back leg, then back arm, go behind the body
    limb(d, hip, p["bknee"], 4, WHITE_D)
    pad(d, p["bknee"], p["bfoot"], back=True)
    boot(d, p["bfoot"])
    limb(d, chest, p["bhand"], 3, JERSEY_D)
    if p.get("bat") is not None and p.get("bat_behind"):
        bat(d, p["hand"], p["bat"], p.get("batlen", 15))
    glove(d, p["bhand"])
    # front leg with its pad
    limb(d, hip, p["fknee"], 4, WHITE)
    pad(d, p["fknee"], p["ffoot"])
    boot(d, p["ffoot"])
    # body, with the trim on the chest and the collar
    limb(d, hip, chest, 7, JERSEY, JERSEY_D)
    d.line([(chest[0] - 3, chest[1] + 3), (chest[0] + 3, chest[1] + 3)], fill=TRIM)
    d.point((chest[0], chest[1] - 2), fill=TRIM)
    # helmet: dome with a shine, peak, ear guard and a grille over the face
    hx, hy = head
    d.ellipse([hx - 4, hy - 4, hx + 4, hy + 4], fill=SKIN)
    d.pieslice([hx - 5, hy - 6, hx + 4, hy + 3], 170, 360, fill=HELMET)
    d.point([(hx - 2, hy - 4), (hx - 1, hy - 5)], fill=(70, 92, 140))
    d.line([(hx - 5, hy - 1), (hx + 6, hy - 1)], fill=HELMET_D)
    d.rectangle([hx - 3, hy, hx - 1, hy + 2], fill=HELMET)
    d.line([(hx + 1, hy + 1), (hx + 5, hy + 1)], fill=GRILL)
    d.line([(hx + 2, hy + 3), (hx + 4, hy + 3)], fill=GRILL)
    d.line([(hx + 5, hy), (hx + 5, hy + 3)], fill=GRILL)
    # front arm and the bat
    limb(d, chest, p["hand"], 3, JERSEY)
    if p.get("bat") is not None and not p.get("bat_behind"):
        bat(d, p["hand"], p["bat"], p.get("batlen", 15))
    glove(d, p["hand"])
    return outlined(im)


def bowler(p):
    im = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    hip, chest, head = p["hip"], p["chest"], p["head"]
    limb(d, hip, p["bknee"], 4, WHITE_D)
    limb(d, p["bknee"], p["bfoot"], 3, WHITE_D)
    d.rectangle([p["bfoot"][0] - 1, p["bfoot"][1], p["bfoot"][0] + 2, p["bfoot"][1] + 1], fill=SHOE)
    limb(d, chest, p["bhand"], 3, (160, 40, 44))
    limb(d, hip, p["fknee"], 4, WHITE)
    limb(d, p["fknee"], p["ffoot"], 3, WHITE)
    d.rectangle([p["ffoot"][0] - 1, p["ffoot"][1], p["ffoot"][0] + 2, p["ffoot"][1] + 1], fill=SHOE)
    limb(d, hip, chest, 7, (196, 52, 56), (150, 34, 40))
    d.point([(chest[0] - 1, chest[1] - 2), (chest[0] + 1, chest[1] - 2)], fill=WHITE)  # collar
    hx, hy = head
    d.ellipse([hx - 4, hy - 4, hx + 4, hy + 4], fill=SKIN)
    d.pieslice([hx - 4, hy - 5, hx + 4, hy + 2], 180, 360, fill=(120, 26, 32))
    d.line([(hx + 3, hy - 2), (hx + 7, hy - 2)], fill=(90, 18, 24))  # cap peak
    d.point((hx + 2, hy), fill=BLACK)  # eye
    limb(d, chest, p["hand"], 3, (196, 52, 56))
    # a white wristband, then the hand
    w = (p["hand"][0] + (chest[0] - p["hand"][0]) * 0.2, p["hand"][1] + (chest[1] - p["hand"][1]) * 0.2)
    d.point((round(w[0]), round(w[1])), fill=WHITE)
    if p.get("ball"):
        d.rectangle([p["hand"][0] - 1, p["hand"][1] - 1, p["hand"][0] + 1, p["hand"][1] + 1], fill=BALL)
        d.point((p["hand"][0], p["hand"][1] - 1), fill=(245, 225, 200))
    else:
        d.rectangle([p["hand"][0] - 1, p["hand"][1] - 1, p["hand"][0], p["hand"][1]], fill=SKIN)
    return outlined(im)


def umpire(pose):
    im = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = 24
    d.rectangle([cx - 5, 30, cx - 1, 43], fill=UMP_TROUSER_D)
    d.rectangle([cx + 1, 30, cx + 5, 43], fill=UMP_TROUSER)
    d.rectangle([cx - 6, 43, cx - 1, 44], fill=BLACK)
    d.rectangle([cx + 1, 43, cx + 6, 44], fill=BLACK)
    d.rectangle([cx - 6, 18, cx + 6, 31], fill=UMP_SHIRT)
    d.rectangle([cx - 6, 18, cx - 4, 31], fill=UMP_SHIRT_D)
    d.line([(cx, 19), (cx, 26)], fill=(40, 60, 110))  # tie
    # head with the wide white hat
    d.ellipse([cx - 4, 8, cx + 4, 17], fill=SKIN)
    d.rectangle([cx - 8, 7, cx + 8, 8], fill=UMP_HAT)
    d.rectangle([cx - 5, 2, cx + 5, 7], fill=UMP_HAT)
    d.line([(cx - 5, 6), (cx + 5, 6)], fill=(40, 60, 110))  # hat band
    d.line([(cx - 8, 8), (cx + 8, 8)], fill=(200, 192, 166))  # brim shade
    d.point([(cx + 2, 12)], fill=BLACK)
    d.point([(cx - 2, 19), (cx + 2, 19)], fill=UMP_SHIRT_D)  # collar
    d.line([(cx - 3, 15), (cx + 2, 15)], fill=SKIN_D)
    sleeve, hand = UMP_SHIRT, SKIN
    if pose == "still":
        limb(d, (cx - 7, 20), (cx - 8, 32), 3, sleeve)
        limb(d, (cx + 7, 20), (cx + 8, 32), 3, sleeve)
        d.point([(cx - 8, 33), (cx + 8, 33)], fill=hand)
    elif pose == "out":  # the raised finger
        limb(d, (cx - 7, 20), (cx - 8, 32), 3, sleeve)
        limb(d, (cx + 7, 20), (cx + 10, 8), 3, sleeve)
        d.rectangle([cx + 9, 5, cx + 12, 8], fill=hand)
        d.line([(cx + 11, 0), (cx + 11, 5)], fill=hand)
    elif pose in ("fourA", "fourB"):  # sweeping one arm across for a boundary
        limb(d, (cx - 7, 20), (cx - 8, 32), 3, sleeve)
        end = (cx + 14, 15) if pose == "fourA" else (cx + 15, 28)
        limb(d, (cx + 7, 21), end, 3, sleeve)
        d.rectangle([end[0], end[1] - 1, end[0] + 2, end[1] + 1], fill=hand)
    elif pose == "six":  # both arms straight up
        limb(d, (cx - 7, 19), (cx - 9, 6), 3, sleeve)
        limb(d, (cx + 7, 19), (cx + 9, 6), 3, sleeve)
        d.rectangle([cx - 10, 3, cx - 8, 6], fill=hand)
        d.rectangle([cx + 8, 3, cx + 10, 6], fill=hand)
    elif pose == "wide":  # arms out to the side: the single, and a welcome
        limb(d, (cx - 7, 21), (cx - 17, 21), 3, sleeve)
        limb(d, (cx + 7, 21), (cx + 17, 21), 3, sleeve)
        d.rectangle([cx - 20, 20, cx - 18, 22], fill=hand)
        d.rectangle([cx + 18, 20, cx + 20, 22], fill=hand)
    return outlined(im)


BATTER_POSES = {
    "stance": dict(hip=(20, 28), chest=(22, 20), head=(24, 12), fknee=(26, 35), ffoot=(28, 43), bknee=(15, 35), bfoot=(13, 43),
                   hand=(28, 26), bhand=(27, 26), bat=112),
    "lift": dict(hip=(20, 28), chest=(21, 20), head=(23, 12), fknee=(26, 35), ffoot=(29, 43), bknee=(15, 35), bfoot=(13, 43),
                 hand=(13, 15), bhand=(14, 16), bat=-125, bat_behind=True),
    "drive": dict(hip=(23, 29), chest=(27, 21), head=(30, 13), fknee=(32, 35), ffoot=(36, 43), bknee=(16, 36), bfoot=(11, 43),
                  hand=(36, 22), bhand=(35, 23), bat=-40),
    "follow": dict(hip=(22, 28), chest=(24, 20), head=(26, 12), fknee=(30, 35), ffoot=(33, 43), bknee=(15, 36), bfoot=(12, 43),
                   hand=(30, 10), bhand=(29, 11), bat=-115),
    "pull": dict(hip=(22, 28), chest=(21, 20), head=(23, 12), fknee=(28, 35), ffoot=(31, 43), bknee=(16, 36), bfoot=(14, 43),
                 hand=(34, 17), bhand=(33, 18), bat=-8),
    "runA": dict(hip=(22, 27), chest=(26, 20), head=(29, 12), fknee=(31, 32), ffoot=(36, 39), bknee=(15, 33), bfoot=(9, 41),
                 hand=(33, 25), bhand=(16, 25), bat=20),
    "runB": dict(hip=(22, 27), chest=(26, 20), head=(29, 12), fknee=(25, 36), ffoot=(26, 43), bknee=(18, 34), bfoot=(19, 42),
                 hand=(32, 22), bhand=(18, 22), bat=15),
    "cheer": dict(hip=(22, 28), chest=(22, 20), head=(23, 12), fknee=(27, 36), ffoot=(29, 43), bknee=(17, 36), bfoot=(15, 43),
                  hand=(29, 6), bhand=(14, 10), bat=-82, batlen=14),
    "walk": dict(hip=(21, 28), chest=(20, 20), head=(20, 13), fknee=(24, 36), ffoot=(25, 43), bknee=(18, 36), bfoot=(16, 43),
                 hand=(19, 31), bhand=(23, 30), bat=100),
}
BOWLER_POSES = {
    "mark": dict(hip=(22, 28), chest=(22, 20), head=(23, 12), fknee=(25, 36), ffoot=(26, 43), bknee=(19, 36), bfoot=(18, 43),
                 hand=(29, 26), bhand=(15, 26), ball=True),
    "runA": dict(hip=(22, 27), chest=(25, 20), head=(28, 12), fknee=(31, 31), ffoot=(35, 38), bknee=(15, 33), bfoot=(9, 41),
                 hand=(32, 26), bhand=(16, 22), ball=True),
    "runB": dict(hip=(22, 27), chest=(25, 20), head=(28, 12), fknee=(24, 36), ffoot=(25, 43), bknee=(18, 34), bfoot=(19, 42),
                 hand=(17, 23), bhand=(31, 24), ball=True),
    "load": dict(hip=(21, 26), chest=(20, 18), head=(21, 10), fknee=(29, 29), ffoot=(32, 36), bknee=(18, 35), bfoot=(16, 43),
                 hand=(11, 26), bhand=(28, 11), ball=True),
    "throw": dict(hip=(24, 27), chest=(28, 20), head=(31, 12), fknee=(32, 35), ffoot=(36, 43), bknee=(16, 33), bfoot=(9, 39),
                  hand=(33, 6), bhand=(18, 28), ball=True),
    "after": dict(hip=(25, 28), chest=(30, 22), head=(34, 15), fknee=(32, 36), ffoot=(35, 43), bknee=(18, 33), bfoot=(11, 37),
                  hand=(38, 31), bhand=(22, 28)),
    "appeal": dict(hip=(23, 28), chest=(23, 20), head=(24, 12), fknee=(27, 36), ffoot=(29, 43), bknee=(18, 36), bfoot=(16, 43),
                   hand=(31, 5), bhand=(15, 6)),
}
UMPIRE_POSES = ["still", "out", "fourA", "fourB", "six", "wide"]


def sheet():
    frames = {}
    cells = []
    for name, pose in BATTER_POSES.items():
        frames[f"batter-{name}"] = len(cells)
        cells.append(batter(pose))
    for name, pose in BOWLER_POSES.items():
        frames[f"bowler-{name}"] = len(cells)
        cells.append(bowler(pose))
    for name in UMPIRE_POSES:
        frames[f"umpire-{name}"] = len(cells)
        cells.append(umpire(name))
    im = Image.new("RGBA", (CELL * len(cells), CELL), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        im.paste(c, (i * CELL, 0))
    im.save(OUT / "sprites.png", optimize=True)
    (OUT / "sprites.json").write_text(json.dumps({"cell": CELL, "count": len(cells), "frames": frames}, indent=1))


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def stands(d, rng, w, top, bottom, far):
    """Tiers of seats full of people: a speckle that reads as a crowd."""
    tiers = 3
    h = (bottom - top) / tiers
    colours = [(226, 60, 60), (240, 200, 60), (60, 130, 220), (240, 240, 235), (60, 180, 110), (235, 120, 40), (150, 80, 190), (30, 40, 60)]
    for t in range(tiers):
        y0 = int(top + t * h)
        y1 = int(top + (t + 1) * h)
        d.rectangle([0, y0, w, y1], fill=lerp((22, 28, 48), (34, 42, 62), t / tiers))
        for y in range(y0 + 1, y1 - 1, 2):
            for x in range(rng.randint(0, 1), w, 2):
                if rng.random() < 0.82:
                    c = rng.choice(colours)
                    d.point((x, y), fill=lerp(c, (16, 22, 40), 0.25 if not far else 0.45))
        d.line([(0, y1 - 1), (w, y1 - 1)], fill=(12, 16, 30))


def tower(d, x, base, top):
    """A floodlight mast. Its lamps are drawn off; the lit glow is its own layer."""
    d.line([(x, base), (x, top)], fill=(60, 68, 84), width=2)
    d.rectangle([x - 8, top - 6, x + 8, top], fill=(44, 50, 64))
    for ly in (top - 5, top - 2):
        for lx in range(x - 7, x + 8, 3):
            d.point((lx, ly), fill=(96, 104, 120))


TOWERS = [40, 150, 290, 410]


def ground():
    """The whole ground at night. The camera moves over this one picture."""
    rng = random.Random(26)
    w, h = 460, 240
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    # sky, stepped so it stays pixel art rather than a smooth gradient
    for y in range(0, 92):
        t = y / 92
        band = int(t * 12) / 12
        d.line([(0, y), (w, y)], fill=lerp((6, 10, 28), (30, 40, 86), band))
    for _ in range(90):
        x, y = rng.randrange(w), rng.randrange(66)
        d.point((x, y), fill=(200, 210, 235) if rng.random() < 0.3 else (110, 124, 160))
    # far city, a shop town behind the ground
    x = 0
    while x < w:
        bw = rng.randint(10, 26)
        bh = rng.randint(6, 22)
        d.rectangle([x, 74 - bh, x + bw, 80], fill=(14, 20, 44))
        for wy in range(74 - bh + 2, 74, 3):
            for wx in range(x + 2, x + bw - 1, 3):
                if rng.random() < 0.22:
                    d.point((wx, wy), fill=(214, 180, 90))
        x += bw
    for tx in TOWERS:
        tower(d, tx, 112, 20)
    stands(d, rng, w, 72, 124, far=True)
    # roof edge of the stand
    d.rectangle([0, 70, w, 73], fill=(50, 58, 78))
    # the boundary boards, lettered
    d.rectangle([0, 124, w, 137], fill=(10, 42, 90))
    d.rectangle([0, 124, w, 125], fill=(255, 204, 0))
    font = ImageFont.load_default()
    d.fontmode = "1"
    words = ["SHIV HARDWARE", "LOCKS", "PAINT", "SHIV HARDWARE", "PIPES", "TOOLS"]
    x = 6
    while x < w:
        for word in words:
            d.text((x, 125), word, fill=(255, 255, 255) if "SHIV" in word else (255, 204, 0), font=font)
            x += int(d.textlength(word, font=font)) + 14
    # the outfield, in mown stripes
    for i in range(0, 12):
        y0 = 137 + i * 9
        d.rectangle([0, y0, w, y0 + 9], fill=(30, 118, 62) if i % 2 == 0 else (24, 102, 54))
    for _ in range(900):
        x, y = rng.randrange(w), rng.randrange(138, h)
        d.point((x, y), fill=(36, 132, 70) if rng.random() < 0.5 else (20, 92, 48))
    # boundary rope
    d.line([(0, 139), (w, 139)], fill=(240, 240, 235))
    # the pitch
    pitch = [(150, 168), (310, 168), (346, 222), (114, 222)]
    d.polygon(pitch, fill=(196, 172, 118))
    for _ in range(300):
        x, y = rng.randrange(120, 340), rng.randrange(169, 222)
        if 150 - (y - 168) * 0.67 < x < 310 + (y - 168) * 0.67:
            d.point((x, y), fill=(176, 150, 98) if rng.random() < 0.6 else (214, 192, 140))
    d.line([(138, 186), (322, 186)], fill=(245, 245, 240))
    d.line([(128, 204), (332, 204)], fill=(245, 245, 240))
    im.save(OUT / "ground.png", optimize=True)

    # The strip behind the live scene on the Daily screen: crowd, boards, grass.
    im.crop((0, 66, w, 160)).save(OUT / "strip.png", optimize=True)

    # The floodlights lit, as a layer laid over the same picture: on one by one.
    for i, tx in enumerate(TOWERS):
        g = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        gd = ImageDraw.Draw(g)
        for r, a in ((46, 26), (30, 44), (17, 80)):
            gd.ellipse([tx - r, 17 - r, tx + r, 17 + r], fill=(255, 250, 215, a))
        gd.rectangle([tx - 8, 14, tx + 8, 20], fill=(255, 252, 226, 255))
        g.save(OUT / f"light{i}.png", optimize=True)


def small(name, size, draw):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    draw(ImageDraw.Draw(im))
    im.save(OUT / f"{name}.png", optimize=True)


def stumps_whole(d):
    for x in (3, 8, 13):
        d.rectangle([x, 4, x + 1, 23], fill=STUMP)
        d.point([(x + 1, y) for y in range(4, 24)], fill=STUMP_D)
        d.point((x, 4), fill=(250, 238, 210))  # the rounded top catching the light
    d.rectangle([3, 2, 7, 3], fill=WOOD)
    d.rectangle([9, 2, 14, 3], fill=WOOD)
    d.point([(7, 3), (14, 3)], fill=WOOD_D)


def stumps_hit(d):
    """Off and leg stumps knocked back; the middle one is gone (it flies on its own)."""
    d.line([(3, 23), (0, 7)], fill=STUMP, width=2)
    d.line([(4, 23), (1, 7)], fill=STUMP_D)
    d.line([(13, 23), (17, 8)], fill=STUMP, width=2)
    d.line([(14, 23), (17, 10)], fill=STUMP_D)
    d.rectangle([7, 21, 9, 23], fill=(120, 96, 60))  # the hole the middle one left


def stump(d):
    d.rectangle([0, 0, 1, 19], fill=STUMP)
    d.line([(1, 0), (1, 19)], fill=STUMP_D)
    d.point((0, 0), fill=(250, 238, 210))
    d.line([(0, 18), (1, 19)], fill=(150, 120, 80))  # the spike


def ball(d):
    d.ellipse([0, 0, 7, 7], fill=BALL)
    d.arc([0, 0, 7, 7], 200, 340, fill=BALL_D)
    d.line([(2, 1), (5, 6)], fill=(245, 225, 200))
    d.point((2, 2), fill=(255, 150, 150))


def bail(d):
    d.rectangle([0, 0, 5, 1], fill=WOOD)
    d.point((5, 1), fill=WOOD_D)


def coin(d):
    d.ellipse([0, 0, 15, 15], fill=(230, 180, 50))
    d.ellipse([2, 2, 13, 13], outline=(170, 120, 20))
    d.line([(8, 4), (8, 11)], fill=(170, 120, 20), width=2)


def main():
    sheet()
    ground()
    small("stumps", (18, 24), stumps_whole)
    small("stumps-hit", (18, 24), stumps_hit)
    small("stump", (2, 20), stump)
    small("ball", (8, 8), ball)
    small("bail", (6, 2), bail)
    small("coin", (16, 16), coin)
    print("drawn into", OUT)


if __name__ == "__main__":
    main()
