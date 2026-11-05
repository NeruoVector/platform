# 학교 모델·시뮬레이션·영상 파이프라인 배포

2026-11-05 고객 프론트엔드·주문 출발 연동 기준입니다. 이전 영상 검증 날짜는 표에 표시했습니다.

- 고객 주문 앱: https://neurovector-sim.forge-lang.org/#/home
- 드론 모니터·관리자: https://neurovector-sim.forge-lang.org/monitor/
- 웹 전체 지도: https://neurovector-sim.forge-lang.org/monitor/#map
- 실제 Gazebo 화면: https://neurovector-sim.forge-lang.org/simulation/
- 백엔드: https://neurovector-backend.forge-lang.org/health
- 카메라·기체 상태: `/simulation/live/state.json`, `/simulation/live/inference.json`

## 확인 결과

| 구간 | 결과 | 실제 증거 |
| --- | --- | --- |
| 학습 모델 → 카메라 추론 | 통과 | 실제 `school_obstacles_best.pt`, 23개 클래스, CPU 추론 약 1.9–2.1초 |
| 추론 → 백엔드 감지 저장 | 통과 | `building_region`, `window`, `cable` 등 실제 모델 결과, `forwarded` 확인 |
| Gazebo/PX4 → 백엔드 | 통과 | 실제 위치·무장 상태, `school-drone-001` 온라인 및 비행 세션 |
| 추론 중단 → 기체 정지 → 복구 | 통과 | `flying → hold_vision_stale → flying`, 정지 중 위치 변화 약 0.045m |
| 카메라 → SRT → MediaMTX → 백엔드 API | 통과 | source=`srtConn`, H.264 640×360, GPU 렌더링 및 송출 목표 15fps (2026-11-04 갱신) |
| SRT 읽기 | 통과 | 실제 SRT 주소를 FFprobe로 읽어 H.264/640×360/15fps 확인 (2026-11-04 갱신) |
| 녹화 → 백엔드 다운로드 | 통과 | HTTP 다운로드한 실제 MP4를 FFprobe로 디코딩, 60초 세그먼트 |
| WHEP → WebRTC → 브라우저 | 통과: 직접 접근 가능한 경로 | 공개 HTTPS 페이지의 서버측 브라우저에서 10프레임 디코딩, 640×360 |
| TURN 강제 중계 → 브라우저 | 통과: 로컬 TURN 진입점 | candidate=`relay`, relayProtocol=`tcp`, 실제 영상 6프레임 디코딩 |
| SRT 중단 → 웹 감지 → 복구 | 통과 | 중단 안내 후 재연결 54프레임, 시뮬레이터 재시작 횟수 0→0 |
| 공용 인터넷 TURN/TLS 진입점 | 통과 (2026-11-04) | 공용 Funnel IP로 DNS를 고정하고 relay 강제, TLS 중계 후보로 실제 640×360 영상 42프레임 디코딩, 재생 시간 8.5초 진행 |
| 녹화 시간 오차 수정 | 통과 (2026-11-04) | 송출 시각을 실제 도착 시간에 맞춘 뒤 303초 동안 drift 재시작 0회, 완성된 MP4 길이 60.4초·60.6초 확인 |
| 영상 프레임 속도 개선 | 통과 (2026-11-04) | 실제 새 카메라 프레임 약 1.8→12–14Hz, 공용 TURN/TLS 경유 브라우저 10.13초간 142프레임(14.01fps), 드롭·패킷 손실 0 |
| 공개 웹의 Gazebo 화면 | 통과 | 실제 브라우저의 noVNC 캔버스에서 Gazebo·RGB·상태 화면 확인 |
| MQTT → DB/API → Kafka | 통과 | 인증된 MQTT 진단 이벤트를 HTTP와 Kafka 파티션 0에서 동일 ID로 확인 |
| 텔레메트리 → Redis | 통과 | 동일 드론 최신 상태 캐시 확인 |
| Redis 조회 캐시 | 통과 | 재고 조회 두 번째 응답 `X-Cache: HIT` |
| 관리자 세션 | 통과 | 공개 HTTPS 로그인·관리자 조회·로그아웃, 종료한 세션 401 |
| 주문 큐 → Kafka worker → 재고 | 통과 | 실제 비동기 작업 completed, 진단용 재고 2→1 |
| 더미 결제 → 환불 | 통과 | 기존 dummy provider의 captured→refunded, 재고 1→2 |

진단용 DB·Redis 행과 임시 상품·주문은 해당 ID만 지정해 정리했습니다.
Kafka의 진단 이벤트는 불변 로그에 남으며 `pipeline_qa`/`pipelineqa…`로 구분됩니다.
실제 결제 제공자는 호출하지 않았습니다.

실행 보고서와 화면 증거는 `runtime/`에 보관합니다:

- `school-pipeline-report.json`, `commerce-pipeline-report.json`, `vision-recovery-report.json`
- `qa/nv-webrtc-direct-result.json`, `qa/nv-webrtc-stall-result.json`, `qa/nv-webrtc-local-relay-result.json`, `qa/nv-webrtc-public-configured-result.json`
- `qa/nv-webrtc-*.png`, `qa/nv-srt-probe.json`
- `qa/nv-webrtc-public-relay-result.json`, `qa/nv-webrtc-public-relay.png`: 공용 Funnel 경유 TURN/TLS 중계 검증
- `qa/nv-stream-id-result.json`: 공개 대시보드와 활성 스트림 ID 일치 검증
- `qa/nv-recording-clock-result.json`: 수정 전 실패 재현, 카메라 테스트 7개 통과, 실제 녹화 303초 관찰
- `qa/nv-camera-fps-result.json`, `qa/nv-camera-fps.png`: GPU 전환 후 외부 중계 영상 FPS 실측
- `qa/nv-school-colors-before.jpg`, `qa/nv-school-colors-after.jpg`, `qa/nv-school-colors-overview.png`: 학교 재질 적용 전후 및 전체 장면
- `qa/nv-campus-live-result.json`, `qa/nv-campus-fault-result.json`, `qa/nv-campus-*.png`: 웹 전체 지도, 실제 위치 갱신, 모바일·신호 지연·모델 오류 복구 검증

## 실제 배포 구성

`compose.yaml` + `~/.config/neurovector/compose.yaml` + `compose.school.yaml`을 사용합니다.

- `nv-sim`: Gazebo Harmonic/PX4 SITL, Micro XRCE-DDS, ROS 센서 브리지, 비행 제어 노드,
  SRT 송출, Xvfb/Gazebo GUI/보기 전용 noVNC. 별도 Docker 네트워크와 ROS domain 73 사용.
  CPU 6개, 메모리 4GiB 제한. `/dev/dri/renderD128`의 AMD GPU로 센서를 EGL 렌더링합니다.
- `neurovector-vision.service`: localhost:18082의 실제 모델 추론 API.
  가중치는 프로젝트 루트의 `school_obstacles_best.pt`이며 pose/depth 추가 모델은 끕니다.
- `neurovector-school-relay.service`: 실제 카메라 → 추론 API → 기존 백엔드 감지 저장;
  실제 Gazebo ENU 위치 → 백엔드 텔레메트리. 백엔드가 감지 결과를 받지 못해도 정지합니다.
- `nv-mediamtx`: SRT 수신·WebRTC 변환·MP4 녹화. Rust 백엔드가 SRT 바이너리를 직접
  처리하는 구조가 아니라 MediaMTX의 스트림·WHEP·녹화 API를 연결하는 구조입니다.
- `nv-frontend`: 같은 오리진의 백엔드 프록시, 실제 프레임 수신/정지 감지, TURN 설정,
  SRT 주소 안내와 noVNC 프록시. 외부 웹은 기존 Cloudflare 터널을 사용합니다.
- `school-turn`: 별도 coturn. MediaMTX 전용 Docker 주소로만 중계를 허용하고 할당·대역폭을
  제한합니다. 자격 증명은 git에서 제외된 `runtime/` 설정에 있습니다.
- `neurovector-turn-funnel.service`: 공용 TURN/TLS 진입점을 준비합니다.
  Funnel 활성화 완료. `:10000`에서 TLS를 종료하고 localhost TURN TCP로 전달합니다.
  사용자에게 Tailscale 전체 operator 권한을 부여하지 않고, Docker에서 해당 Funnel 명령만
  실행하도록 구성했습니다. 서비스에는 Docker와 로컬 `alpine:3.23` 이미지가 필요합니다.

사용자 systemd 서비스 스냅샷은 `infra/school/*.service`에 있습니다.
현재 서비스에는 실제 작업 디렉터리의 절대 경로가 들어갑니다.

## 모델 출처와 로딩

`school_obstacles_best.pt`와 두 portable 폴더의 `selected_native.pt`는 같은 가중치입니다.
SHA-256: `739d051fed9d48d89bb56d8a1173127e4b4d316c3da65c3f4703e854db99dd24`.

모델의 `Global22Model`과 검출 헤드 세 곳의 `WeakFeatureAdapter`는 제공된
`portable_global22 copy/`의 원본 구현을 그대로 import합니다. 해당 폴더 전체가 추론 서비스의
`PYTHONPATH`에 등록되어 있습니다. 더미 클래스·다른 YOLO 가중치로 대체하지 않았습니다.
CPU PyTorch/torchvision을 명시해 CUDA 런타임 설치를 피했고, 필요한 typer 의존성을 추가했습니다.

자동 순찰은 비활성화되어 있습니다. 새 주문이 배정되고 실제 추론이 정상일 때만 시동하며,
주문 피드나 추론이 끊기면 정지합니다. 사람·동물 또는 가까운 일반 장애물에 정지하고, 거리 미확정인 전선·건물·나무·
기둥 등의 모델 결과가 화면 중앙 진행 방향과 겹칠 때도 보수적으로 정지합니다.
단안 거리·진행 방향 판단은 실기체용 보정이나 정확도 평가를 대신하지 않습니다.

## 경로·재시작 수정

학교 STL의 실제 경계가 ENU y=0.523632m부터 시작합니다. 최초 북쪽 경로는 메시와
충돌해 전복됐습니다. 현재 경로는 메시 바깥인 이륙 지점 남서쪽의 3m 사각형, 높이 3m이며
속도·수평 가속도는 1m/s·1m/s²로 제한합니다. 실제 위치·상태를 사용하며 저장된 경로 재생이 아닙니다.

학교 월드에는 PX4 기본 월드와 같은 비영 자기장을 추가해 EKF 방향 기준을 제공합니다.
PX4 토픽 버전은 설치된 메시지 상수에서 읽습니다(VehicleStatus v4, LocalPosition v1).

Xvfb 잠금·소켓은 이 컨테이너 소유의 display 99만 시작 시 정리합니다. 소프트웨어 렌더링은
x11vnc의 XDamage 최적화를 끄고 전송합니다. SRT 송출기·DDS agent·센서 브리지는 독립적으로
재시작하므로 미디어 게이트웨이 장애가 PX4 전체 재시작으로 이어지지 않습니다.

카메라는 `gz sim --headless-rendering`으로 별도 실행하고 PX4는 해당 월드에 연결합니다.
센서와 송출 목표는 `NV_SCHOOL_CAMERA_FPS=15.0`입니다. 센서 SDF의 최대 주기를 실행 전에
맞추며, ROS의 DOUBLE 파라미터이므로 소수점이 있는 값을 사용합니다. 깊이 센서는 기존
5Hz를 유지합니다. noVNC의 Gazebo GUI는 Xvfb 소프트웨어 렌더링과 낮은 CPU 우선순위를
사용해 카메라 생성과의 CPU 경합을 줄입니다. 실제 FPS는 서버 부하에 따라 달라집니다.

학교 STL에는 색상 정보가 없어, 동일한 159,573개 삼각형을 유지한 시각용
`school_map_colored.dae`를 생성했습니다. 외벽·지붕·창문 계열·녹지·운동장은
`sim/scripts/color-school-mesh.py`의 팔레트와 메시 좌표 영역으로 구분합니다.
충돌 판정은 원본 `school_map.stl`을 계속 사용합니다. 재생성 및 확인 명령은 다음과 같습니다.

```bash
python3 sim/scripts/color-school-mesh.py
python3 sim/scripts/generate-school-world.py
python3 sim/scripts/color-school-mesh.py --check
python3 sim/scripts/generate-school-world.py --check
```

녹화는 1분 세그먼트·6시간 보존이며 Docker 로그는 크기를 제한했습니다.
상시 데모의 PX4 파일 로그는 `SDLOG_BACKEND=0`으로 끄고 백엔드 텔레메트리는 유지합니다.

2026-11-04 녹화 시계 오차를 수정했습니다. 기존 rawvideo 입력은 프레임 개수로만 시간을
계산해 파이프 쓰기·인코딩 지연이 누적될수록 실제 시간과 벌어졌습니다. FFmpeg에
`-use_wallclock_as_timestamps 1`과 `-fps_mode passthrough`를 적용해 실제 도착 간격을
유지합니다. 카메라 워커만 다시 시작했고 PX4 PID와 시뮬레이터 재시작 횟수는 유지됐습니다.
수정 후 303초 관찰에서는 기존 약 218초 간격의 drift 재시작이 재발하지 않았습니다.
수 시간 이상의 장기 관찰은 이번 검증 범위에 포함하지 않았습니다.

## 외부 영상 네트워크

SRT 송출 주소는 `srt://100.86.108.30:8890?streamid=publish:school-drone-001`입니다.
원격 송출 장치는 해당 Tailscale 네트워크에 참여하고 ACL이 허용되어 있어야 합니다.
시뮬레이터 자체는 Docker 내부의 `srt://mediamtx:8890`로 실제 송출합니다.

WHEP의 HTTPS 요청 성공만으로 외부 WebRTC 영상 수신을 보장하지 않습니다.
공개 Cloudflare HTTP 라우트와 별도로 ICE 미디어 경로가 필요합니다.
[Cloudflare의 공개 서비스 프로토콜](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/)과
[Tailscale의 TCP/TLS Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel)을 참고했습니다.

공용 중계 주소는 `turns:helloworld0822.tailc8ec98.ts.net:10000?transport=tcp`입니다.
기존 `:8443`은 다른 서비스가 사용하므로 사용하지 않습니다. Funnel은 TLS를 종료해
로컬 TURN TCP로 전달하고, TURN은 Docker 내부의 MediaMTX와 UDP로 통신합니다.
2026-11-04 계정의 Funnel을 활성화하고 서비스의 로컬 권한 오류를 해결했습니다.
공용 DNS의 두 Funnel IP에서 인증서 호스트명 검증을 통과했습니다. 브라우저 QA는
Tailscale 내부 주소를 사용하지 않도록 공용 IP로 이름 해석을 고정하고
`iceTransportPolicy=relay`를 강제해 실제 영상 및 `candidateType=relay`,
`relayProtocol=tls`를 확인했습니다. 이 검사는 서버에서 공용 Funnel 경로를 거친 결과이며,
별도의 이동통신망 단말에서 수행한 검사는 아닙니다.

## 운영·재검사

```bash
# 현재 배포의 서비스 기동
systemctl --user start neurovector-vision neurovector-school-relay

docker compose --profile sim -f compose.yaml \
  -f "$HOME/.config/neurovector/compose.yaml" -f compose.school.yaml \
  up -d --no-build sim mediamtx school-turn frontend backend

# 외부 중계 상태
tailscale funnel status --json
systemctl --user status neurovector-turn-funnel

# 실제 진단: 고유한 진단용 행만 생성하고 정리
NV_RUN_LIVE_QA=1 vision/.venv/bin/python infra/school/check-pipelines.py
NV_RUN_LIVE_QA=1 vision/.venv/bin/python infra/school/check-commerce.py

# 추론을 잠시 중단해 SITL 정지·복구를 확인하는 명시적 시험
NV_RUN_LIVE_QA=1 python3 infra/school/check-vision-recovery.py
```

기본 compose의 `vision` 컨테이너 대신 위의 host 추론 서비스를 사용합니다.
관리자 비밀번호와 DB·MQTT 자격 증명은 기존 `.env`에 있으며 보고서에 포함하지 않습니다.

## 위치 전송과 추론의 실행 분리

영상 API는 FastAPI 수명 동안 백엔드 HTTP 연결 풀을 재사용합니다.
시뮬레이터 릴레이의 위치 전송은 별도 스레드와 연결 풀에서 1초 간격으로 실행하므로
이미지 추론을 기다리지 않습니다. 위치 전송에는 재시도 없이 작업별 1초 제한을 적용합니다.

`school_relay_runtime.py`가 위치 상태와 `inference.json` 저장을 같은 잠금으로 관리합니다.
위치 전송 실패는 즉시 `ok=false, blocked=true`를 기록하며, 복구된 위치 전송만으로는
비행을 재개하지 않습니다. 장애를 걸쳐 실행된 추론도 폐기하고 이후의 새 추론이
성공해야 정상 결과를 기록합니다. 원본 상태·카메라는 5초, 위치 응답은 3초 이내여야 합니다.
기존 모델·감지 임계값·제어기의 8초 추론 유효기간은 유지합니다.

```bash
uv run --directory vision --python 3.14 --extra vision pytest \
  tests ../sim/tests/test_school_relay.py ../sim/tests/test_school_relay_runtime.py
```

2026-11-05 배포 검증: 60초씩 비교한 위치 갱신 간격 중앙값은 2.966초에서
1.000초로 줄었고, 변경 후 p95는 1.003초였습니다. 재시작을 포함한 최대 간격은
3.587초였습니다. 회귀 테스트 128개와 린트가 통과했습니다. 추론 중단 시
`hold_vision_stale`로 정지했으며 정지 중 이동은 0.037m, 복구 후 `flying`을 확인했습니다.
측정 결과는 `runtime/qa/refactor-report.json`에 저장됩니다.


## 주문으로 출발하는 학교 시뮬레이션

2026-11-05부터 기본 상태는 `waiting_for_order`, `armed=false`입니다.
`POST /api/v1/orders` 및 Kafka 주문 API로 **실제로 생성된 새 주문**을 감지하면,
한 주문씩 기존 3m 사각 경로를 한 바퀴 비행하고 출발점으로 복귀·착륙합니다.
주문 생성 직후 출발 대상으로 삼으므로 `pending_payment`도 포함합니다.
실제 선택 수령 장소로 이동하거나 실물 배송을 완료했다는 의미는 아닙니다.

학교 배포에서만 `SCHOOL_SIM_ENABLED=1`로 최소 주문 피드
`GET /api/v1/simulation/orders?after=<UTC>&after_id=<UUID>`를 사용합니다.
응답은 고객 정보 없이 ID·상태·생성 시각만 포함하며, 생성 시각과 ID의 커서로 페이지를 처리합니다.
릴레이 최초 활성화 이전의 과거 주문은 출발 대상으로 삼지 않습니다.
`runtime/school/order-cursor.json`이 처리 위치를 보존하므로 운영 중 삭제하지 않습니다.
주문 배정은 3초, 센서 상태는 5초, 추론 결과는 8초 이내여야 합니다.
취소·실패·배송 완료 주문은 건너뛰며, 완료한 주문은 재시작 후에도 반복 비행하지 않습니다.
완료 기록은 `runtime/school/orders/<order-id>.json`에 남고, 고객 주문의 배송 완료 상태를
임의로 변경하지 않습니다. 장애 복구 시 진행 중인 주문의 비행만 재개합니다.

최신 고객 프론트엔드는 `NeruoVector/frontend`의 `af54ea8`을 바탕으로 적용했습니다.
상품·재고·금액·주문번호·테스트 결제·전화번호별 주문 내역과 실제 비행 상태를 연결했습니다.
별도 배송비 API가 없으므로 임의의 배송비를 붙이지 않습니다. 문자/SNS 인증, 실물 수령
확인은 제공하지 않으며 관련 화면에서 지원 여부를 안내합니다. 리뷰 저장은 아래 추가 기능을 사용합니다.
기존 지도·영상·관리자는 `/monitor/`에 보존했습니다. 원본 소스와 재빌드 명령은
`monitoring/README.md`에 있습니다.

검증 증거는 `runtime/qa/order-e2e/`, `runtime/qa/order-recovery.json`,
`runtime/qa/order-regression-tests.log`, `runtime/qa/frontend-api-tests.log`에 있습니다.
추론 장애 복구 검사는 이제 **진행 중인 주문으로 비행할 때만** 실행합니다.


## 리뷰 저장·Swagger·새 프론트 WebRTC

`0009_order_reviews.sql`은 결제된 주문당 하나의 리뷰를 저장합니다.
별점 1~5, 내용 1~500자, 제공된 태그 최대 3개, JPG/PNG/WebP 사진 한 장(최대 1MB)을
지원합니다. 사진은 DB의 bytea로 보관하고 별도 이미지 API로 전송하므로 목록 응답에
큰 base64 이미지를 넣지 않습니다. 같은 주문의 중복 등록은 409로 거절하고 기존 내용을
변경하지 않습니다. 주문 내역의 리뷰 쓰기/보기, 매점 리뷰 탭, 마이의 내 리뷰에서 접근합니다.

- `POST /api/v1/orders/{id}/review`: 등록 (미결제·취소 주문 거절)
- `GET /api/v1/orders/{id}/review`: 저장된 리뷰
- `GET /api/v1/reviews?phone=<optional>&limit=20`: 목록·전체 건수·평균 별점
- `GET /api/v1/reviews/{id}/photo`: 저장된 사진 원본

Swagger는 고객 웹과 백엔드의 `/swagger-ui/`에서 열 수 있습니다.
리뷰, 스트림/SRT 정보, WHEP POST/DELETE, 녹화, 시뮬레이터 주문 피드를 등록했습니다.
WHEP offer/answer는 `application/sdp`입니다. Location은 외부에서 호출 가능한
`/api/v1/streams/{drone_id}/whep/{session_id}`를 반환합니다.
브라우저를 닫아 세션이 먼저 종료된 경우 DELETE의 404는 이미 정리된 세션을 뜻합니다.

새 고객 웹 `/#/camera`는 주문 없이도 실시간 영상을 열 수 있습니다.
홈 카메라 버튼으로 접근하며, 진행 중인 주문의 배송 화면에도 같은 뷰어를 표시합니다.
ICE/TURN 설정은 `/webrtc-config.json`을 사용합니다. 이전 모니터 `/monitor/`도 유지합니다.
