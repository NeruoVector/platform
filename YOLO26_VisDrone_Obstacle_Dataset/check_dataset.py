"""Check the uploaded VisDrone images and detection labels before GPU training."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Final

from PIL import Image
from ultralytics.data.utils import check_det_dataset

ROOT: Final = Path(__file__).resolve().parent
IMAGE_SUFFIXES: Final = {".jpg", ".jpeg", ".png"}


def check_split(root: Path, split: str, class_count: int) -> tuple[int, int]:
    """Reject missing pairs, unreadable images and invalid detection boxes."""
    images = sorted(
        path for path in (root / "images" / split).iterdir()
        if path.suffix.lower() in IMAGE_SUFFIXES
    )
    labels = root / "labels" / split
    stems = {path.stem for path in images}
    if not images or len(stems) != len(images):
        raise SystemExit(f"{split}: empty image split or duplicate image stems")
    if stems != {path.stem for path in labels.glob("*.txt")}:
        raise SystemExit(f"{split}: images and labels are not paired; upload the complete split")

    box_count = 0
    for image_path in images:
        with Image.open(image_path) as image:
            image.verify()
        label_path = labels / f"{image_path.stem}.txt"
        for line_number, line in enumerate(label_path.read_text().splitlines(), start=1):
            location = f"{label_path}:{line_number}"
            fields = line.split()
            if len(fields) != 5:
                raise SystemExit(f"{location}: expected class_id x_center y_center width height")
            try:
                class_id = int(fields[0])
                x, y, width, height = (float(value) for value in fields[1:])
            except ValueError as exc:
                raise SystemExit(f"{location}: invalid numeric label") from exc
            if not 0 <= class_id < class_count:
                raise SystemExit(f"{location}: class ID outside data.yaml names")
            if not all(math.isfinite(value) for value in (x, y, width, height)):
                raise SystemExit(f"{location}: non-finite coordinates")
            if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < width <= 1 and 0 < height <= 1):
                raise SystemExit(f"{location}: box coordinates must be normalized to 0..1")
            # Six-decimal conversion can shift a clipped edge by half a decimal unit.
            if min(x - width / 2, y - height / 2) < -1e-6 or max(
                x + width / 2, y + height / 2,
            ) > 1 + 1e-6:
                raise SystemExit(f"{location}: box extends outside the image")
            box_count += 1
    if box_count == 0:
        raise SystemExit(f"{split}: no labeled boxes")
    return len(images), box_count


def check_dataset() -> None:
    """Resolve data.yaml and compare all three splits with the conversion summary."""
    data = check_det_dataset(ROOT / "data.yaml", autodownload=False)
    if Path(data["path"]).resolve() != ROOT:
        raise SystemExit("data.yaml resolves outside this dataset folder")
    expected = json.loads((ROOT / "dataset_summary.json").read_text())["image_counts"]
    for split in ("train", "val", "test"):
        if Path(data[split]).resolve() != ROOT / "images" / split:
            raise SystemExit(f"{split}: data.yaml must point to images/{split}")
        image_count, box_count = check_split(ROOT, split, len(data["names"]))
        if image_count != expected[split]:
            raise SystemExit(f"{split}: expected {expected[split]} images, found {image_count}")
        print(f"{split}: {image_count} images, {box_count} boxes OK", flush=True)


if __name__ == "__main__":
    check_dataset()
