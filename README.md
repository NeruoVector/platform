# NeuroVector Platform

NeuroVector 전체 스택을 한 곳에서 실행하는 슈퍼프로젝트입니다.
각 서비스는 **git submodule** 로 들어와 있고, 루트 `compose.yaml` 이 전부 묶어서 띄웁니다.

## 레포 구성 (서브모듈)

| 경로 | 레포 | 스택 | 포트 |
| --- | --- | --- | --- |
| `frontend/` | [frontend](https://github.com/NeruoVector/frontend) | React 19 + TS + Vite → nginx | 5173 |
| `backend/` | [backend](https://github.com/NeruoVector/backend) | Rust + axum | 8081 |
| `vision/` | [vision](https://github.com/NeruoVector/vision) | Python 3.13 + uv + YOLO/FastAPI | 8082 |
| `drone/` | [drone](https://github.com/NeruoVector/drone) | C/C++ + Conan 2 (HAL) | — |
| `sim/` | [sim](https://github.com/NeruoVector/sim) | PX4 SITL + Gazebo Harmonic + ROS 2 Jazzy | 8765 등 |

> `drone/` 과 `sim/` 은 서브모듈로만 포함됩니다. `drone` 은 빌드 산출물을 배포하는 게 아니라
> Conan 패키지/펌웨어 쪽이라 compose 서비스가 아니고, `sim` 은 X11·host 네트워킹이 필요해
> 별도 프로필로 분리했습니다.

```
                    ┌──────────────┐
   브라우저 ───────▶ │  frontend    │ :5173  (nginx, /api 프록시)
                    └──────┬───────┘
                           │ /api + WHEP
                    ┌──────▼───────┐        ┌──────────────┐
                    │  backend     │ :8081 ─▶│  postgres    │ :5432 (pgvector)
                    │  (axum)      │ ─────▶ │  redis       │ :6379
                    └──┬───┬───┬───┘ ─────▶ │  kafka       │ :9092
                       │   │   │            └──────────────┘
          MQTT 1883 ◀──┘   │   └──▶ MediaMTX :8890 SRT / :8889 WebRTC / :9997 API
                            │
   이미지 ─────▶ ┌──────────▼─────┐
   (또는 sim)     │  vision      │ :8082
                 └────────────────┘

   sim (프로필) : PX4 SITL + Gazebo + ROS 2 + RViz2 + Foxglove
```

### 미디어 / MQTT 흐름

- vision → backend: YOLO26 감지(얼굴·몸통·팔·손·다리·발 포함) + 단안/사선 거리(`distance_m`) + 위험 단계(`priority_level`) → `POST /api/v1/detections`
- 드론 → Mosquitto: `neurovector/drones/{drone_id}/{detections|telemetry|status}`
- 드론 → MediaMTX: `srt://<host>:8890?streamid=publish:{drone_id}`
- 브라우저 ← backend WHEP 프록시 ← MediaMTX: WebRTC 재생
- MediaMTX → `/recordings/{drone_id}/...` 녹화 후 backend API 로 목록/다운로드
- 주문 API → Kafka `neurovector.orders` → backend order-worker → PostgreSQL
- backend 조회 API ↔ Redis cache-aside (`X-Cache: HIT|MISS`)

## 요구 사항

- Docker Engine + Compose **v2.20+** (`include` 문법 사용)
- Git (서브모듈)

Docker 가 없다면:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # 재로그인 필요
```

## 시작하기

```bash
git clone --recurse-submodules https://github.com/NeruoVector/platform.git
cd platform
make init        # .env 생성 + 서브모듈 초기화
make up          # postgres/redis/kafka/migrate/backend/vision/frontend 기동
make ps
```

- 프론트엔드: http://localhost:5173 (`#dashboard` 모니터링, `#store` 스토어, `#admin` 관리자)
- 관리자 로그인: `#admin` → 아이디 `admin` / 비밀번호 `neurovector-admin` (`.env` 에서 변경)
- 백엔드 API: http://localhost:8081/health
- 백엔드 Swagger UI: http://localhost:8081/swagger-ui
- vision API 문서: http://localhost:8082/docs
- Kafka UI: `make up-tools` → http://localhost:8080
- MediaMTX API: http://localhost:9997/v3/paths/list
- MQTT: `localhost:1883` (`neurovector` / `neurovector`)

이미 clone 한 뒤라면:

```bash
make pull        # git submodule update --init --recursive
```

## 자주 쓰는 명령

```bash
make up            # 전체 기동 (이미지 빌드 포함)
make build         # 이미지만 빌드
make ps / logs     # 상태 / 로그
make config        # compose 설정 검증
make down          # 중지
make clean         # 중지 + 볼륨 삭제 (데이터 유실)

make psql          # psql 접속
make redis-cli     # redis-cli 접속
make topics        # Kafka 토픽 목록
make mqtt-sub      # MQTT neurovector/# 구독
make mqtt-detection # 테스트 감지 이벤트 발행
make media-api     # MediaMTX 활성 스트림 조회
make recordings    # 녹화 파일 목록
make migrate       # DB 마이그레이션 재적용
make status        # 서브모듈 상태
```

## MQTT / SRT / WebRTC

```bash
# MQTT 감지 이벤트 발행
mosquitto_pub -h localhost -p 1883 -u neurovector -P neurovector \
  -t neurovector/drones/drone-001/detections \
  -m '{"label":"person","confidence":0.91,"latitude":37.5665,"longitude":126.9780,"distance_m":12.4,"priority_level":1}'

# 드론 영상 SRT publish
ffmpeg -re -i input.mp4 -c copy -f mpegts \
  'srt://localhost:8890?streamid=publish:drone-001'

# 활성 스트림 확인
curl http://localhost:9997/v3/paths/list
```

브라우저에서는 프론트엔드의 **실시간 카메라** 패널이 백엔드 WHEP 프록시를 통해
MediaMTX 스트림을 재생합니다. 녹화는 MediaMTX 가 자동으로 수행하며
`make recordings` 또는 `/api/v1/recordings` 로 확인할 수 있습니다.

## 시뮬레이션 (sim 프로필)

`sim` 서비스는 `sim` 프로필이라 `make up` 으로는 뜨지 않습니다.

```bash
make up-sim        # 시뮬레이션 컨테이너 기동
make agent         # (터미널 2) Micro XRCE-DDS Agent
make px4           # (터미널 3) PX4 SITL + Gazebo
make foxglove      # (터미널 4) ws://localhost:8765
make rviz          # (터미널 5) RViz2
```

GUI(X11)가 필요하므로 호스트에서 먼저 `xhost +local:root` 를 실행하세요.
자세한 내용은 [`sim` 레포 README](https://github.com/NeruoVector/sim) 참고.

## 서브모듈 워크플로

```bash
# 서브모듈에서 작업 후
cd backend && git checkout main && git pull
# ... 커밋/푸시 ...
cd .. && git add backend && git commit -m "chore: backend 최신 커밋 반영" && git push
```

- `make status` 로 각 서브모듈이 어느 커밋에 고정돼 있는지 확인합니다.
- 서브모듈을 최신 main 으로 당길 때: `git submodule update --remote --merge <path>`
- 서브모듈 안에서 작업할 때는 브랜치가 detached HEAD 가 아닌지 확인하세요.

## 환경 변수

`.env.example` → `.env` 로 복사해서 사용합니다. 주요 값:

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `POSTGRES_*` | `neurovector` | DB 계정/DB명 |
| `POSTGRES_PORT` / `REDIS_PORT` / `KAFKA_PORT` | 5432 / 6379 / 9092 | 인프라 포트 |
| `MQTT_PORT` / `MQTT_USERNAME` / `MQTT_PASSWORD` | 1883 / `neurovector` / `neurovector` | Mosquitto 설정 |
| `MEDIA_SRT_PORT` / `MEDIA_WEBRTC_PORT` / `MEDIA_API_PORT` | 8890 / 8889 / 9997 | MediaMTX 포트 |
| `MEDIA_SRT_PUBLIC_HOST` | `localhost` | 드론이 사용할 SRT 공인 주소 |
| `MEDIA_WEBRTC_ADDITIONAL_HOSTS` | `localhost` | 브라우저가 접근할 WebRTC 호스트 |
| `BACKEND_PORT` / `VISION_PORT` / `FRONTEND_PORT` | 8081 / 8082 / 5173 | 앱 포트 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `neurovector-admin` | 관리자 세션 계정 |
| `ADMIN_SESSION_TTL_SECONDS` | `86400` | 관리자 세션 유지 시간 |
| `ADMIN_COOKIE_SECURE` | `false` | HTTPS 배포 시 `true` |
| `MAX_ALTITUDE_M` / `ROUTE_MAX_DISTANCE_M` | 120 / 20000 | 경로 검증 기준 |
| `RISK_LOOKBACK_DAYS` / `RISK_CORRIDOR_M` | 90 / 150 | 위험 예측 기준 |
| `VISION_WITH_MODEL` | `0` | `1` 이면 YOLO/OpenCV 포함해 vision 빌드 |
| `SIM_BASE_IMAGE`, `PX4_SIM_MODEL`, `HEADLESS` | — | sim 프로필용 |

## DB 초기화 / 마이그레이션

1. `infra/postgres/init/01-extensions.sql` — 볼륨이 비었을 때 **최초 1회** 실행
   (`vector`, `pg_trgm`, `uuid-ossp` 확장 + `neurovector` 스키마)
2. `migrate` 서비스 — 매 기동 시 `backend/migrations/*.sql` 을 순서대로 적용
   (스크립트가 `IF NOT EXISTS` 라 반복 실행해도 안전)

볼륨이 이미 있는데 확장이 없다면:

```bash
docker compose exec -T postgres psql -U neurovector -d neurovector \
  < infra/postgres/init/01-extensions.sql
make migrate
```

## 문제 해결

**`include` 때문에 compose 가 실패한다**
서브모듈이 비어 있어 `sim/compose.yaml` 이 없을 때 발생합니다. `make pull` 실행.

**`docker compose` 에서 `include` 를 모른다**
Compose v2.20 미만입니다. `docker compose version` 확인 후 업그레이드하세요.

**backend 가 Kafka 에 붙지 못한다**
컨테이너 네트워크에서는 광고된 INTERNAL 리스너를 써야 하므로 `KAFKA_BROKERS=kafka:29092` 입니다.
호스트에서 직접 실행할 때만 `localhost:9092` 를 사용하세요.

**포트 충돌**
`.env` 에서 해당 포트를 바꾸세요.

**운영에서는**
기본 비밀번호(`neurovector`, `neurovector-admin`)를 교체하고, `ADMIN_COOKIE_SECURE=true`
를 설정한 뒤 인프라 포트를 외부에 노출하지 마세요.

## 라이선스

각 서브모듈은 자체 LICENSE 를 따릅니다 (MIT).

### Korean food reference data

The reference dataset is separate from merchant inventory. Export the supplied MFDS workbook using `scripts/food_reference/export_xlsx.py`, then start the project's PostgreSQL and migrations (`docker compose up -d postgres && docker compose run --rm migrate`). Load the resulting CSV and its manifest with:

```sh
scripts/food_reference/load.sh infra/data/korean-food-reference.csv infra/data/korean-food-reference.manifest.json
```

The loader requires `jq` and the project's Docker Compose PostgreSQL service. It validates the CSV header, manifest, row count and unique food codes, then replaces the reference data and metadata in one transaction; re-running it is safe. Search requests wait while the replacement transaction updates the indexed table; schedule imports accordingly. PostgreSQL's `pgdata` volume retains the imported data. The dataset contains neither barcodes nor photos, prices, or stock.
