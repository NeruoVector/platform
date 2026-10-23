"""Regression checks for incomplete uploads and malformed detection labels."""

from pathlib import Path

import pytest
from check_dataset import check_split
from PIL import Image


@pytest.fixture
def dataset(tmp_path: Path) -> Path:
    images = tmp_path / "images" / "train"
    labels = tmp_path / "labels" / "train"
    images.mkdir(parents=True)
    labels.mkdir(parents=True)
    Image.new("RGB", (32, 32)).save(images / "sample.jpg")
    (labels / "sample.txt").write_text("0 0.5 0.5 0.5 0.5\n")
    return tmp_path


def test_counts_when_image_and_box_are_valid(dataset: Path) -> None:
    # Given: one paired image and valid box.
    # When: the split is checked.
    result = check_split(dataset, "train", 10)
    # Then: one image and one box are reported.
    assert result == (1, 1)


@pytest.mark.parametrize("label", [
    "10 0.5 0.5 0.5 0.5", "0 nan 0.5 0.5 0.5", "0 0.5 0.5 0 0.5",
    "0 0.9 0.5 0.5 0.5", "0 0.5 0.5", "person 0.5 0.5 0.5 0.5",
])
def test_rejects_when_box_is_invalid(dataset: Path, label: str) -> None:
    # Given: an invalid class, coordinate or row shape.
    (dataset / "labels" / "train" / "sample.txt").write_text(label + "\n")
    # When: the split is checked. Then: invalid training input fails.
    with pytest.raises(SystemExit):
        check_split(dataset, "train", 10)


def test_rejects_when_label_is_missing(dataset: Path) -> None:
    # Given: the uploaded image has no companion label.
    (dataset / "labels" / "train" / "sample.txt").rename(dataset / "missing.txt")
    # When: the split is checked. Then: upload damage fails before training.
    with pytest.raises(SystemExit, match="not paired"):
        check_split(dataset, "train", 10)
