"""Fine-tune YOLO26 detection on the VisDrone dataset with a single CUDA GPU."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Final

import torch
from check_dataset import check_dataset
from ultralytics import YOLO

ROOT: Final = Path(__file__).resolve().parent


def main() -> None:
    """Run new training or resume an interrupted checkpoint."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resume", type=Path, help="resume an interrupted last.pt")
    parser.add_argument("--device", type=int, default=0, help="single CUDA device index")
    parser.add_argument("--name", default="visdrone", help="run name below this folder's runs/")
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--imgsz", type=int)
    parser.add_argument("--batch", type=int)
    parser.add_argument("--workers", type=int)
    args = parser.parse_args()
    if not torch.cuda.is_available() or not 0 <= args.device < torch.cuda.device_count():
        parser.error("a working CUDA GPU is required; check nvidia-smi and the PyTorch CUDA build")
    if args.resume is not None and (not args.resume.is_file() or args.resume.suffix != ".pt"):
        parser.error(f"checkpoint must be an existing .pt file: {args.resume}")

    check_dataset()
    overrides = {
        key: value for key in ("epochs", "imgsz", "batch", "workers")
        if (value := getattr(args, key)) is not None
    }
    if args.resume is not None:
        model = YOLO(str(args.resume.resolve()), task="detect")
        # Resume restores the checkpoint's training schedule and hyperparameters.
        model.train(
            resume=True,
            data=str(ROOT / "data.yaml"),
            device=args.device,
            save_dir=str(args.resume.resolve().parent.parent),
            **overrides,
        )
    else:
        model = YOLO(str(ROOT / "yolo26n.pt"), task="detect")
        model.train(
            cfg=str(ROOT / "train.yaml"),
            data=str(ROOT / "data.yaml"),
            device=args.device,
            project=str(ROOT / "runs"),
            name=args.name,
            exist_ok=False,
            **overrides,
        )
    best = Path(model.trainer.best)
    print(f"Best PyTorch weights: {best}", flush=True)


if __name__ == "__main__":
    main()
