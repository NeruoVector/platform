# YOLO26 드론 장애물 데이터셋

이 폴더는 드론 시점 RGB 이미지로 객체 종류를 감지하는 Ultralytics YOLO26 탐지 데이터셋입니다. 학습 대상은 포함된 `yolo26n.pt`이며, 깊이 맵이나 포즈 정답은 포함하지 않습니다.

## Vast.ai 실행

CUDA가 동작하는 PyTorch 템플릿을 사용하고 이 폴더 전체를 업로드합니다. 이미지, 라벨, `dataset_summary.json`, 초기 가중치 `yolo26n.pt`를 함께 옮겨야 합니다. 아래는 `/workspace/YOLO26_VisDrone_Obstacle_Dataset`에 업로드한 예입니다.

GitHub에서 받는 경우 이미지와 초기 가중치는 Git LFS로 관리됩니다. Git LFS를 설치하고 저장소 루트에서 `git lfs install`과 `git lfs pull`을 실행해 실제 파일을 내려받습니다. GitHub ZIP만 받으면 LFS 포인터가 들어 있을 수 있습니다.

```bash
cd /workspace/YOLO26_VisDrone_Obstacle_Dataset
nvidia-smi

# uv가 없으면 설치합니다.
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

# 템플릿에 설치된 CUDA PyTorch를 사용합니다.
uv venv --system-site-packages --python python3 .venv
uv pip install --python .venv/bin/python -r requirements.txt
source .venv/bin/activate
python -c 'import torch; print(torch.__version__, torch.cuda.is_available())'

# 모든 이미지와 라벨을 확인합니다. 학습 시에도 자동으로 검사합니다.
python check_dataset.py

# 기본값: 100 epochs, imgsz=1280, batch=4, GPU 0
python train.py
```

CUDA 확인 결과가 `True`여야 합니다. `libGL.so.1` 오류가 나면 템플릿에 `libgl1`과 `libglib2.0-0` 시스템 패키지를 설치합니다. SSH 연결 종료 후에도 학습을 유지하려면 서버의 `tmux` 세션 안에서 실행합니다.

학습 설정은 `train.yaml`에 있습니다. GPU 메모리가 부족하면 배치를 줄입니다.

```bash
python train.py --batch 2 --workers 2 --name visdrone_batch2
```

`train.py`는 실행 위치와 관계없이 자신의 폴더에서 데이터와 초기 가중치를 찾습니다. 이미지/라벨은 기존 train/val/test 분할을 유지하며, 학습 중 검증에는 val만 사용합니다.

## 결과와 재개

첫 실행 결과는 `runs/visdrone/`에 저장됩니다. 같은 이름이 이미 있으면 Ultralytics가 번호를 붙여 새 실행 폴더를 만듭니다. 실제 저장 경로는 실행 로그를 확인합니다.

- `weights/best.pt`: 검증 성능이 가장 좋은 가중치
- `weights/last.pt`: 마지막 epoch 체크포인트
- `weights/epoch*.pt`: 10 epoch마다 저장되는 체크포인트
- `results.csv`, `results.png`, `args.yaml`: 지표와 학습 설정

중단한 학습은 해당 실행의 `last.pt`에서 재개합니다. 재개 시 학습 일정은 체크포인트 설정을 따르며 `--epochs` 변경은 적용되지 않습니다. 서버를 옮기면 가중치뿐 아니라 해당 실행 폴더 전체를 복사합니다.

```bash
python train.py --resume runs/visdrone/weights/last.pt

# 학습 완료 후에만 test-dev로 최종 평가합니다.
yolo detect val model=runs/visdrone/weights/best.pt data="$PWD/data.yaml" \
  split=test imgsz=1280 batch=1 device=0 max_det=1000
```

Vast.ai 인스턴스를 삭제하기 전에 실행 폴더를 로컬로 다운로드합니다. 전송에는 [Vast.ai의 SSH/SCP 또는 Cloud Copy](https://docs.vast.ai/guides/instances/storage/data-movement)를 사용할 수 있습니다. 학습/재개 설정은 [Ultralytics 학습 문서](https://docs.ultralytics.com/modes/train/)를 따릅니다.

NeuroVector에서는 내려받은 `best.pt`의 경로를 `NEUROVECTOR_MODEL_PATH` 또는 카메라 UI의 `--object-model`로 지정합니다. 이 모델의 출력 클래스는 아래 10개이며, 기존 COCO 전체 클래스를 유지하는 모델은 아닙니다. 크기 기반 거리 추정을 사용할 경우 `pedestrian`, `people`, `van`, `tricycle`, `awning-tricycle`, `motor`에 맞는 `NEUROVECTOR_OBJECT_SIZES` 설정도 필요합니다.

데이터 검사 코드의 회귀 검사는 다음과 같이 실행할 수 있습니다.

```bash
uv run --active --with pytest python -m pytest test_check_dataset.py -q
```

## 구성

```text
images/train, labels/train   # 6,471장
images/val,   labels/val     # 548장
images/test,  labels/test    # 1,610장, 공식 test-dev
data.yaml                    # 경로와 10개 클래스
class_box_counts.csv         # 클래스별 바운딩박스 수
class_images.csv             # 각 사진에 포함된 클래스 색인
dataset_summary.json         # 데이터셋 요약
```

라벨은 YOLO 감지 형식의 `class_id x_center y_center width height`이며 좌표는 0~1로 정규화되어 있습니다. 사진 하나에 여러 종류의 장애물이 있으면 같은 이름의 라벨 파일에 여러 행으로 기록되어 있습니다. `data.yaml`의 번호와 이름이 클래스 기준표입니다.

클래스는 `pedestrian`, `people`, `bicycle`, `car`, `van`, `truck`, `tricycle`, `awning-tricycle`, `bus`, `motor`입니다. 학습/검증/테스트는 VisDrone2019-DET의 공식 분할을 따릅니다. `ignored regions`와 범주가 모호한 `others`는 학습 라벨에서 제외했습니다.

정의된 종류는 사람과 도로 교통 객체 중심입니다. 나뭇가지, 전선, 벽, 실내 물체 등 VisDrone의 10개 클래스 밖의 장애물은 이 데이터에서 해당 종류로 학습되지 않습니다.

## 범위

이 데이터셋은 RGB 사진에서 **객체 종류와 화면 안 위치**를 학습하는 자료입니다. 실제 거리(m) 정답, 충돌까지의 시간, 비행 가능 공간 라벨은 포함하지 않습니다. 따라서 YOLO26 감지 결과만으로 물체까지의 거리를 알 수 없으며, 거리 센서 또는 별도의 깊이 추정 모듈이 필요합니다. 이 데이터셋만으로 자율 비행 안전성이 보장되지는 않습니다.

## 출처와 라이선스

- 원본 데이터: [VisDrone-Dataset](https://github.com/VisDrone/VisDrone-Dataset), AISKYEYE 팀, Tianjin University.
- 클래스 구조와 YOLO 변환 방식: [Ultralytics VisDrone 문서](https://docs.ultralytics.com/datasets/detect/visdrone/).
- 논문: Zhu et al., “Detection and Tracking Meet Drones Challenge,” IEEE TPAMI, 2022, [DOI 10.1109/TPAMI.2021.3119563](https://doi.org/10.1109/TPAMI.2021.3119563).
- VisDrone 자료는 학술 연구용/비상업 조건으로 배포된다고 안내되어 있습니다. 원본 이미지와 라벨의 저작권·이용 조건을 유지하고, 상업 이용 전에는 원저작자에게 확인하세요. 이 변환본은 추가 사용 권한을 부여하지 않습니다.

`prepare_visdrone_yolo26.py`는 원본 train/val/test-dev ZIP을 이 구조로 변환하는 스크립트입니다. 변환 시 원본 이미지는 그대로 복사하고, 무시 영역 및 `others` 카테고리를 제외한 뒤 정규화된 바운딩박스로 저장합니다.
