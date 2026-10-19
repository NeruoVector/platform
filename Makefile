COMPOSE := docker compose

.PHONY: up down restart logs ps psql redis-cli topics ui clean

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

# 컨테이너 내부 환경변수를 사용하므로 .env 값을 바꿔도 그대로 동작합니다.
psql:
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

redis-cli:
	$(COMPOSE) exec redis sh -c 'redis-cli -a "$$REDIS_PASSWORD" --no-auth-warning'

topics:
	$(COMPOSE) exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list

ui:
	$(COMPOSE) --profile tools up -d kafka-ui

# 볼륨까지 삭제 (데이터 유실 주의)
clean:
	$(COMPOSE) down -v
