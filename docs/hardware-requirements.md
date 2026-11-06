# 전체 드론 MVP 서버 최소·권장 사양

측정일: 2026-11-06 UTC. 서비스 코드 기준: platform `6e99dfdb` 및 해당 하위 저장소 커밋.

현재 구성은 **8코어·16스레드 / RAM 16GB**를 최소 배포 시작점으로, **12코어·24스레드 / RAM 32GB**를 여유 있는 권장값으로 잡는다. 이는 현재 서버 한 대의 측정에서 산정한 값이며, 더 낮은 사양의 장비에서 검증한 절대 최소값은 아니다. CPU 세대·클럭·가상화 방식에 따라 같은 코어 수라도 성능이 다르다.

| 항목 | 최소 배포 시작점 | 권장 |
|---|---|---|
| CPU | 측정 서버급 8코어·16스레드, x86-64 | 12코어·24스레드 이상 |
| RAM | 16GB | 32GB 이상 |
| SSD | 64GB 이상, 실행·업데이트용 여유 20GB 확보 | 128GB 이상, 서버 빌드·영상 보관 시 256GB 이상 |
| 그래픽 환경 | Gazebo OGRE2 실행 가능한 드라이버/OpenGL 환경. 현재 확인한 소프트웨어 렌더러는 OpenGL 4.5 | OpenGL 4.3+ 가속 환경과 PyTorch 호환 추론 GPU 검토 |
| OS | 현재 검증한 Ubuntu 24.04 x86-64 + Docker Compose | 동일 |

SSD와 권장 하드웨어 수치는 설치·업데이트·모델·로그 여유를 포함한 운영 예산이다. 해당 용량으로 제한하거나 새 장비에서 시험한 결과는 아니다. GPU 모델별 최소 VRAM이나 추론 속도는 측정하지 않았다. 현재 설치된 AMD 그래픽 장치는 Gazebo 컨테이너에 전달되지만, GUI는 `LIBGL_ALWAYS_SOFTWARE=1`로 실행되고 추론은 `NEUROVECTOR_DEVICE=cpu`이다. GPU를 구매·설치하는 것만으로 현재 설정의 가속이 보장되지 않는다.

## 측정 조건

- AMD BC-250, 물리 8코어·논리 16개, 시스템에서 보이는 RAM 14.853GiB(16GB급).
- 시뮬레이션 기체 1대, 학교 장면, Gazebo/PX4, ROS 브리지, 카메라 스트리밍, CPU 추론, 웹/API/관리자, PostgreSQL, Redis, Kafka, MQTT, MediaMTX, TURN 실행.
- 기본 구간 약 30초 15회, 검증된 API 부하 구간 약 30초 15회 자원 샘플. Docker CPU는 논리 CPU 하나를 100%로 표현한다.
- 기본 구간에서도 카메라·추론이 계속 동작했다. 관측된 비행 모드는 `awaiting_receipt`, 비무장 상태였으며 이번 측정에서 주문이나 비행을 생성하지 않았다.
- 학습 기반 얼굴/깊이 모델은 꺼져 있고 주 객체 모델 `school_obstacles_best.pt`와 보조 YOLO 모델을 사용했다. 시뮬레이터 깊이 센서 경로와 학습 기반 깊이 모델은 별개다.
- 부하: 같은 서버의 nginx를 통해 초당 10개 GET, 최대 작업자 4개, 총 300회. `/api/v1/inventory?limit=50`, `/api/v1/reviews?limit=20`, `/api/v1/flights/status`, `/simulation/live/state.json`을 순환했다.
- 운영 서비스의 CPU/메모리 제한·추론 설정·비행 상태는 변경하지 않았다. 공유 서버의 다른 작업은 중단하지 않았다.

## 실측 결과

| 지표 | 기본 구간 | API 부하 구간 |
|---|---:|---:|
| 프로젝트 CPU 평균 | 논리 CPU 약 9.74개 사용 | 약 10.04개 사용 |
| 프로젝트 CPU 관측 최대 | 약 12.08개 | 약 11.77개 |
| 프로젝트 메모리 평균 | 약 4.50GiB | 약 4.50GiB |
| 프로젝트 메모리 관측 최대 | 약 4.56GiB | 약 4.59GiB |
| 공유 호스트 전체 CPU 평균 | 65.0% | 67.6% |
| 공유 호스트 전체 사용 메모리 평균 | 약 8.08GiB | 약 8.08GiB |
| 추론 1회 평균 | 2,034ms | 2,052ms |
| 추론 1회 관측 최대 | 2,086ms | 2,172ms |

Docker 자원 샘플과 호스트 vision 프로세스를 합산한 근사치다. CPU 표본의 시간 창이 완전히 같지는 않으며, 메모리는 Docker working set + vision RSS여서 시스템 전체의 최대 커밋 메모리와 같지 않다. 15개 표본의 p95는 nearest-rank 방식에서 최댓값과 같으므로 표에는 관측 최대를 사용했다.

부하 구간 평균은 시뮬레이터 CPU 약 4.40개 / 메모리 2.37GiB, vision CPU 약 4.86개 / RSS 1.03GiB, Kafka 메모리 약 0.71GiB였다. **CPU를 주로 사용하는 곳은 시뮬레이터와 추론이다.** 웹 요청만 보고 작은 서버를 선정하면 전체 구성을 과소 산정한다.

- 검증된 HTTP 부하: **300/300 HTTP 200**, 평균 **26.49ms**, p95 **103.52ms**, 최대 **125.00ms**. 이는 로컬 원점 응답이며 외부 인터넷·Cloudflare·이용자 회선 지연은 포함하지 않는다.
- `/api/v1/flights/status` p95 120.47ms, 재고 조회 p95 4.89ms, 리뷰 조회 p95 7.23ms, 상태 JSON p95 5.23ms.
- 관측한 추론 상태는 모두 `ok=true`; 상태 JSON의 최대 나이는 검증된 부하 구간 0.629초였다.
- 별도 Gazebo `/world/school/stats` 5개 표본의 realTimeFactor는 약 **1.00–1.08**이었다. 짧은 구간에서 시뮬레이션 시간이 실제 시간에 가깝게 진행됨을 확인한 것이며 지속 성능 보증은 아니다.
- 카메라는 640×360/15fps 설정이지만, 추론 완료 후 릴레이가 1초 대기하므로 **추론 결과 갱신률은 카메라 fps와 같지 않다.** 현재 약 2초 추론 시간은 저지연 추론 성능으로 해석하면 안 된다.

## 저장 공간과 운영 판단

실행 중인 프로젝트 컨테이너 이미지 10개의 크기 합계는 약 **2.353GiB**다(공유 레이어 중복이 포함될 수 있음). 실제 vision 가상환경 약 1.5GiB, 사용자 제공 주 모델 약 200MiB가 별도로 있다. 운영체제·DB·로그·녹화·빌드 캐시는 이 합계에 포함하지 않았다.

공유 호스트의 루트 디스크는 약 98GiB급이며 측정 당시 가용 공간은 약 **0.8GiB**였다. 현재 실행은 가능하지만 추가 빌드·영상 저장·업데이트를 위한 여유로는 부족하다. 이 서버에 새 배포를 진행하기 전 최소 20GB 정도의 운영 여유를 확보하는 것을 권한다. 이번 측정에서는 사용자 데이터나 캐시를 삭제하지 않았다.

단일 기체의 현재 구성이라면 16GB급 RAM에서 동작하는 것을 확인했다. 동시 비행 증가, 학습 기반 깊이/포즈 모델 추가, 여러 영상 시청자, 서버 내 소스 빌드·영상 인코딩의 피크는 포함하지 않았으므로 해당 조건에서는 다시 측정해야 한다. 동접 최대 인원, 다중 기체 최대 수, 실물 드론 제어 지연을 이 결과에서 추정하지 않는다.

## 재측정

```sh
vision/.venv/bin/python infra/bench/capacity.py
# 부하 구간만 다시 측정
vision/.venv/bin/python infra/bench/capacity.py --load-only
```

실제 측정 환경의 `vision` 가상환경에는 psutil, pydantic, httpx2가 설치돼 있다. 의존성은 스크립트 상단 PEP 723에도 선언했다. 출력은 `runtime/qa/capacity-20261106/`에 저장된다. 공개 요약 데이터는 [benchmarks/capacity-20261106.json](benchmarks/capacity-20261106.json)에 있다.

최초 도구 실행은 폐기된 `/api/v1/drones` 경로 75개가 404를 반환했다. 해당 실행의 API 결과는 위 성공률/지연 수치에서 제외했고, 실제 관리자 클라이언트가 쓰는 `/api/v1/flights/status`로 수정한 뒤 300회 전부 다시 측정했다. 최초 실행의 정상 기본 구간과 별도 검증된 부하 구간을 구분해 보관했다.

GPU 가속 권고는 측정한 GPU 벤치마크가 아니라 공식 지원 범위와 관측된 CPU 병목에 근거한 개선 후보이다. Gazebo는 렌더링 센서용 GPU를 권장하고 GPU 없는 소프트웨어 렌더링 대안도 설명한다. [Gazebo Harmonic headless rendering](https://gazebosim.org/api/sim/8/headless_rendering.html). OGRE2의 OpenGL 요구는 [Gazebo Harmonic troubleshooting](https://gazebosim.org/docs/harmonic/troubleshooting/)에 설명돼 있다. 추론 장치는 설치된 PyTorch 빌드와 CUDA/ROCm 지원을 맞춰 검증해야 한다. [PyTorch 설치 및 GPU 지원](https://pytorch.org/get-started/locally/).

배포 파일을 ZIP으로 묶는 것만으로 위 실행 환경이 준비되는 것은 아니다. 상위 저장소의 하위 모듈과 Git LFS 자산, 사용자 제공 모델 파일, 외부에 보관된 환경변수·비밀키를 별도로 준비해야 한다. 저장소는 `git clone --recurse-submodules`로 받고 시뮬레이터 자산은 Git LFS로 가져오는 방식을 사용한다.
