# NeuroVector Platform

NeuroVector 의 로컬 개발 인프라(Docker Compose) 레포입니다.

## 레포 구성

| 레포 | 스택 | 역할 |
| --- | --- | --- |
| [`platform`](https://github.com/NeruoVector/platform) | Docker Compose | PostgreSQL · Redis · Kafka 인프라 |
| [`frontend`](https://github.com/NeruoVector/frontend) | React + TS + Vite | 감지 결과 대시보드 |
| [`backend`](https://github.com/NeruoVector/backend) | Rust + axum | API 서버 |
| [`vision`](https://github.com/NeruoVector/vision) | Python + uv + YOLO | 장애물 감지 |
| [`drone`](https://github.com/NeruoVector/drone) | C/C++ + Conan 2 | 드론 하드웨어 HAL |
| [`sim`](https://github.com/NeruoVector/sim) | PX4 SITL + Gazebo + ROS 2 | 드론 시뮬레이션 (RViz2 · Foxglove) |

## 인프라

Docker Compose 기반 로컬 스택입니다.

| 서비스 | 이미지 | 포트 | 용도 |
| --- | --- | --- | --- |
| postgres | `pgvector/pgvector:pg16` | 5432 | 메인 DB + 벡터 검색(pgvector) |
| redis | `redis:7.4-alpine` | 6379 | 캐시 / 세션 (AOF 영속화) |
| kafka | `apache/kafka:3.9.1` | 9092 | 이벤트 스트림 (KRaft, 단일 노드) |
| kafka-ui | `provectuslabs/kafka-ui` | 8080 | 토픽 확인용 (선택, `tools` 프로필) |

## 1. 사전 준비

이 저장소가 있는 머신에는 현재 Docker가 설치되어 있지 않습니다. 아래 중 하나로 설치하세요.

**Docker Engine (Debian/Ubuntu)**

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # 재로그인 필요
```

설치 후 확인:

```bash
docker --version
docker compose version
```

## 2. 실행

```bash
cp .env.example .env     # 값은 필요에 따라 수정
make up                  # docker compose up -d
make ps                  # 상태 확인 (healthy 될 때까지)
```

Kafka UI까지 띄우려면:

```bash
make ui                  # http://localhost:8080
```

## 3. 접속 정보

```
DATABASE_URL=postgres://neurovector:neurovector@localhost:5432/neurovector
REDIS_URL=redis://:neurovector@localhost:6379/0
KAFKA_BROKERS=localhost:9092
```

- Kafka는 컨테이너 내부에서 접근할 때 `kafka:29092` 를 사용합니다.
- `.env` 의 값을 바꾸면 아래 접속 정보도 함께 바뀝니다.

## 4. 자주 쓰는 명령

```bash
make psql       # psql 접속
make redis-cli  # redis-cli 접속
make topics     # Kafka 토픽 목록
make logs       # 전체 로그 tail
make down       # 중지
make clean      # 중지 + 볼륨 삭제 (데이터 유실)
```

## 5. 초기 DB 설정

`infra/postgres/init/01-extensions.sql` 이 **볼륨이 비어있는 최초 기동 시 1회** 실행됩니다.

- `vector` (pgvector)
- `pg_trgm`
- `uuid-ossp`
- `neurovector` 스키마

볼륨이 이미 존재해서 스크립트가 실행되지 않았다면 수동으로 적용하세요.

```bash
docker compose exec -T postgres psql -U neurovector -d neurovector \
  < infra/postgres/init/01-extensions.sql
```

확인:

```bash
docker compose exec postgres psql -U neurovector -d neurovector -c '\dx'
```

## 6. 참고

- 포트 충돌 시 `.env` 에서 `POSTGRES_PORT`, `REDIS_PORT`, `KAFKA_PORT`, `KAFKA_UI_PORT` 를 변경하세요.
- `kafka` 의 `KAFKA_CLUSTER_ID` 는 KRaft 클러스터 식별자입니다. 볼륨을 유지하는 한 바꾸지 마세요.
- 운영 환경에서는 기본 비밀번호(`neurovector`)를 반드시 교체하고, 포트를 외부에 노출하지 마세요.
