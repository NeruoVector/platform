-- 최초 컨테이너 생성 시 1회 실행됩니다.
-- (기존 볼륨이 있으면 실행되지 않으므로, 필요 시 수동으로 실행하세요.)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS neurovector;
