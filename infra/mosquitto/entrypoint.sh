#!/bin/sh
set -eu

: "${MQTT_USERNAME:=neurovector}"
: "${MQTT_PASSWORD:=neurovector}"

CONFIG_DIR=/mosquitto/config
mkdir -p "$CONFIG_DIR" /mosquitto/data /mosquitto/log

# 로컬 개발용 비밀번호 파일을 시작할 때마다 생성한다.
mosquitto_passwd -b -c "$CONFIG_DIR/passwd" "$MQTT_USERNAME" "$MQTT_PASSWORD"

cat > "$CONFIG_DIR/acl" <<EOF
user $MQTT_USERNAME
topic readwrite neurovector/#
topic read \$SYS/#
EOF

# 드론별 계정을 추가로 쓰고 싶을 때 MQTT_EXTRA_USERS="drone-001:secret,..." 형식으로 전달한다.
if [ -n "${MQTT_EXTRA_USERS:-}" ]; then
  printf '%s\n' "$MQTT_EXTRA_USERS" | tr ',' '\n' | while IFS=: read -r user pass; do
    [ -n "$user" ] || continue
    [ -n "$pass" ] || continue
    mosquitto_passwd -b "$CONFIG_DIR/passwd" "$user" "$pass"
    cat >> "$CONFIG_DIR/acl" <<EOF

user $user
topic readwrite neurovector/drones/$user/#
EOF
  done
fi

chown -R mosquitto:mosquitto /mosquitto/data /mosquitto/log "$CONFIG_DIR"
chmod 0700 "$CONFIG_DIR/passwd" "$CONFIG_DIR/acl"

exec mosquitto -c "$CONFIG_DIR/mosquitto.conf"
