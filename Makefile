COMPOSE := docker compose
SERVICE_BACKEND := backend
SIM_SERVICE := sim

.PHONY: help init pull status build up down restart ps logs \
        up-tools up-sim sim-shell px4 headless agent foxglove rviz bridge \
        psql redis-cli topics mqtt-sub mqtt-detection media-api recordings \
        migrate config clean

help:
	@echo "── 공통 ──────────────────────────────────────────"
	@echo "make init       .env 생성 + 서브모듈 초기화"
	@echo "make pull       서브모듈 초기화/업데이트"
	@echo "make status     서브모듈 상태"
	@echo "make build      전체 이미지 빌드"
	@echo "make up         인프라 + 앱 기동 (postgres/redis/kafka/backend/vision/frontend)"
	@echo "make down       중지"
	@echo "make ps         컨테이너 상태"
	@echo "make logs       로그 tail"
	@echo "make config     compose 설정 검증"
	@echo "make clean      중지 + 볼륨 삭제 (데이터 유실)"
	@echo "── 인프라 도구 ───────────────────────────────────"
	@echo "make up-tools   Kafka UI 기동 (http://localhost:8080)"
	@echo "make psql       psql 접속"
	@echo "make redis-cli  redis-cli 접속"
	@echo "make topics     Kafka 토픽 목록"
	@echo "make mqtt-sub   MQTT 토픽 구독 (neurovector/#)"
	@echo "make mqtt-detection  테스트 감지 이벤트 발행"
	@echo "make media-api  MediaMTX 활성 스트림 조회"
	@echo "make recordings 녹화 파일 목록"
	@echo "make migrate    DB 마이그레이션 재적용"
	@echo "── 시뮬레이션 (sim 프로필) ───────────────────────"
	@echo "make up-sim     시뮬레이션 컨테이너 기동 (+ --profile sim)"
	@echo "make sim-shell  시뮬레이션 컨테이너 셸"
	@echo "make px4        PX4 SITL + Gazebo (GUI)"
	@echo "make headless   PX4 SITL + Gazebo (헤드리스)"
	@echo "make agent      Micro XRCE-DDS Agent"
	@echo "make foxglove   Foxglove bridge (ws://localhost:8765)"
	@echo "make rviz       RViz2"
	@echo "make bridge     Gazebo -> ROS 2 브릿지"

init:
	@test -f .env || cp .env.example .env
	git submodule update --init --recursive
	@echo "초기화 완료 (.env + 서브모듈)"

pull:
	git submodule update --init --recursive

status:
	git submodule status

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f --tail=100

config:
	$(COMPOSE) config --quiet && echo "compose 설정 정상"

clean:
	$(COMPOSE) down -v

# ---- 인프라 도구 ----
up-tools:
	$(COMPOSE) --profile tools up -d kafka-ui

psql:
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

redis-cli:
	$(COMPOSE) exec redis sh -c 'redis-cli -a "$$REDIS_PASSWORD" --no-auth-warning'

topics:
	$(COMPOSE) exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list

mqtt-sub:
	$(COMPOSE) exec mosquitto sh -c 'mosquitto_sub -h localhost -u "$$MQTT_USERNAME" -P "$$MQTT_PASSWORD" -t "neurovector/#" -v'

mqtt-detection:
	$(COMPOSE) exec mosquitto sh -c 'mosquitto_pub -h localhost -u "$$MQTT_USERNAME" -P "$$MQTT_PASSWORD" -t "neurovector/drones/$${DRONE_ID:-drone-001}/detections" -m "{\"label\":\"person\",\"confidence\":0.91,\"latitude\":37.5665,\"longitude\":126.9780}"'

media-api:
	@curl -fsS "http://localhost:$${MEDIA_API_PORT:-9997}/v3/paths/list" | head -c 2000; echo

recordings:
	$(COMPOSE) exec backend sh -c 'find /recordings -maxdepth 2 -type f -printf "%p %s bytes\n" 2>/dev/null || true'

migrate:
	$(COMPOSE) run --rm migrate

# ---- 시뮬레이션 ----
up-sim:
	$(COMPOSE) --profile sim up -d --build $(SIM_SERVICE)

sim-shell:
	$(COMPOSE) --profile sim exec $(SIM_SERVICE) bash -l

px4:
	$(COMPOSE) --profile sim exec $(SIM_SERVICE) bash -lc 'HEADLESS=0 px4-gazebo'

headless:
	$(COMPOSE) --profile sim exec $(SIM_SERVICE) bash -lc 'HEADLESS=1 px4-gazebo'

agent:
	$(COMPOSE) --profile sim exec $(SIM_SERVICE) MicroXRCEAgent udp4 -p 8888

foxglove:
	$(COMPOSE) --profile sim exec $(SIM_SERVICE) ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765

rviz:
	$(COMPOSE) --profile sim exec $(SIM_SERVICE) rviz2 -d /config/px4.rviz

bridge:
	$(COMPOSE) --profile sim exec $(SIM_SERVICE) ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=/config/gz_bridge.yaml
