#!/usr/bin/env python3
"""Convert official VisDrone2019-DET archives to a portable YOLO26 dataset."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import zipfile
from collections import Counter
from pathlib import Path

from PIL import Image


SPLITS = {
    "train": "VisDrone2019-DET-train",
    "val": "VisDrone2019-DET-val",
    "test": "VisDrone2019-DET-test-dev",
}
CLASSES = [
    "pedestrian",
    "people",
    "bicycle",
    "car",
    "van",
    "truck",
    "tricycle",
    "awning-tricycle",
    "bus",
    "motor",
]


def find_split_root(root: Path, name: str) -> Path:
    candidates = [root / name, root / name / name]
    for candidate in candidates:
        if (candidate / "images").is_dir() and (candidate / "annotations").is_dir():
            return candidate
    for candidate in root.rglob(name):
        if candidate.is_dir() and (candidate / "images").is_dir() and (candidate / "annotations").is_dir():
            return candidate
    raise FileNotFoundError(f"Cannot find {name}/images and {name}/annotations below {root}")


def yaml_text() -> str:
    names = "\n".join(f"  {index}: {name}" for index, name in enumerate(CLASSES))
    return (
        "# Ultralytics YOLO26 object detection dataset (VisDrone2019-DET)\n"
        "# Paths are relative to this YAML file, including after uploading to Vast.ai.\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        "names:\n"
        f"{names}\n"
    )


def convert_split(source: Path, output: Path, split: str) -> tuple[int, Counter[int], list[tuple[str, int]]]:
    image_dir = output / "images" / split
    label_dir = output / "labels" / split
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)

    source_images = source / "images"
    source_labels = source / "annotations"
    image_paths = sorted(p for p in source_images.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    class_boxes: Counter[int] = Counter()
    image_class_rows: list[tuple[str, int]] = []

    for image_path in image_paths:
        target_image = image_dir / image_path.name
        if not target_image.exists():
            shutil.copyfile(image_path, target_image)
        with Image.open(image_path) as image:
            width, height = image.size
        if width <= 0 or height <= 0:
            raise ValueError(f"Invalid image dimensions: {image_path}")

        annotation_path = source_labels / f"{image_path.stem}.txt"
        lines: list[str] = []
        image_classes: set[int] = set()
        if annotation_path.exists():
            for raw in annotation_path.read_text(encoding="utf-8").splitlines():
                fields = [part.strip() for part in raw.split(",")]
                if len(fields) < 8:
                    continue
                x, y, box_w, box_h = map(float, fields[:4])
                score, category = int(float(fields[4])), int(float(fields[5]))
                # VisDrone category 0 is an ignored region; category 11 is the
                # non-specific "others" bucket. The standard 10-class protocol
                # drops both, as well as rows marked ignored by score 0.
                if score == 0 or category < 1 or category > len(CLASSES):
                    continue
                x1 = max(0.0, min(float(width), x))
                y1 = max(0.0, min(float(height), y))
                x2 = max(0.0, min(float(width), x + box_w))
                y2 = max(0.0, min(float(height), y + box_h))
                clipped_w, clipped_h = x2 - x1, y2 - y1
                if clipped_w <= 0 or clipped_h <= 0:
                    continue
                class_id = category - 1
                center_x = ((x1 + x2) / 2) / width
                center_y = ((y1 + y2) / 2) / height
                norm_w, norm_h = clipped_w / width, clipped_h / height
                lines.append(f"{class_id} {center_x:.6f} {center_y:.6f} {norm_w:.6f} {norm_h:.6f}")
                class_boxes[class_id] += 1
                image_classes.add(class_id)
        (label_dir / f"{image_path.stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        image_class_rows.extend((image_path.name, class_id) for class_id in sorted(image_classes))

    return len(image_paths), class_boxes, image_class_rows


def unpack_archives(archives_dir: Path, extract_root: Path) -> None:
    extract_root.mkdir(parents=True, exist_ok=True)
    for archive in archives_dir.glob("VisDrone2019-DET-*.zip"):
        print(f"Extracting {archive.name}...", flush=True)
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(extract_root)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archives", type=Path, default=Path(".visdrone_download"))
    parser.add_argument("--extract-root", type=Path, default=Path(".visdrone_extract"))
    parser.add_argument("--output", type=Path, default=Path("YOLO26_VisDrone_Obstacle_Dataset"))
    args = parser.parse_args()

    expected = [args.archives / f"{name}.zip" for name in SPLITS.values()]
    missing = [str(path) for path in expected if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing official VisDrone archives:\n" + "\n".join(missing))

    unpack_archives(args.archives, args.extract_root)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "data.yaml").write_text(yaml_text(), encoding="utf-8")

    image_counts: dict[str, int] = {}
    box_counts: Counter[int] = Counter()
    class_image_counts: Counter[int] = Counter()
    class_image_rows: list[tuple[str, str, int]] = []
    for split, original_name in SPLITS.items():
        print(f"Converting {split} split...", flush=True)
        source = find_split_root(args.extract_root, original_name)
        image_counts[split], counts, image_rows = convert_split(source, args.output, split)
        box_counts.update(counts)
        class_image_counts.update(class_id for _, class_id in image_rows)
        class_image_rows.extend((split, image_name, class_id) for image_name, class_id in image_rows)

    summary = {
        "source": "VisDrone2019-DET",
        "source_url": "https://github.com/VisDrone/VisDrone-Dataset",
        "format": "Ultralytics YOLO detect",
        "image_counts": image_counts,
        "class_box_counts": {CLASSES[i]: box_counts[i] for i in range(len(CLASSES))},
        "class_image_counts": {CLASSES[i]: class_image_counts[i] for i in range(len(CLASSES))},
        "classes": CLASSES,
        "excluded_annotations": ["ignored regions (category 0 / score 0)", "others (category 11)"],
    }
    (args.output / "dataset_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with (args.output / "class_box_counts.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file)
        writer.writerow(["class_id", "class_name", "all_splits_boxes"])
        for class_id, name in enumerate(CLASSES):
            writer.writerow([class_id, name, box_counts[class_id]])

    with (args.output / "class_images.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file)
        writer.writerow(["split", "image", "class_id", "class_name"])
        for split, image_name, class_id in class_image_rows:
            writer.writerow([split, image_name, class_id, CLASSES[class_id]])

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
