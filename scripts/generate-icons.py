"""Encode the reviewed icon source into desktop and web icon sizes.

Run with Python + Pillow. This only resizes/encodes the existing artwork;
the source image is the canonical reviewed design.
"""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"
SIZES = (16, 24, 32, 48, 64, 128, 256)


def main():
    with Image.open(ICONS / "icon-source.png") as source:
        artwork = source.convert("RGBA")
    if artwork.width != artwork.height:
        raise ValueError("The reviewed icon source must be square")
    for name, size in (("32x32.png", 32), ("128x128.png", 128),
                       ("128x128@2x.png", 256), ("icon.png", 512)):
        artwork.resize((size, size), Image.Resampling.LANCZOS).save(ICONS / name)
    artwork.save(ICONS / "icon.ico", sizes=[(size, size) for size in SIZES])
    artwork.resize((512, 512), Image.Resampling.LANCZOS).save(ROOT / "public" / "logo.png")
    (ROOT / "public" / "logo.ico").write_bytes((ICONS / "icon.ico").read_bytes())
    with Image.open(ICONS / "icon.ico") as encoded:
        assert encoded.ico.sizes() == {(size, size) for size in SIZES}
    assert artwork.getpixel((artwork.width // 2, artwork.height // 3))[3] >= 250
    assert artwork.getpixel((0, 0))[3] == 0
    print("Desktop/web icons encoded; opaque paper and transparent exterior verified.")


if __name__ == "__main__":
    main()
