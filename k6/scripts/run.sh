#!/usr/bin/env bash
# k6 시나리오를 실행 조건 기록·Prometheus 전송과 함께 실행한다.
#
# 사용법: k6/scripts/run.sh <시나리오> [k6 run 추가 인자...]
#   k6/scripts/run.sh smoke-e2e
#   k6/scripts/run.sh server-hpa -e STAGES=10:1m,50:3m,10:1m -e VEHICLES=100 -e UPDATE_RATIO=0.1
#
# - 토큰은 ADMIN_TOKEN·ENROLLMENT_KEY 환경 변수가 없으면 클러스터 Secret 에서 읽는다. 화면·파일에 남기지 않는다.
# - 결과는 k6/runs/<RUN_ID>/ 에 conditions.txt·k6.log·summary.json 으로 남는다 (git 에 올리지 않음).
# - k6 지표는 Prometheus remote write 로 보낸다. NO_PROM=1 이면 보내지 않는다.
set -euo pipefail

K6_DIR="$(cd "$(dirname "$0")/.." && pwd)"

JUMP_HOST="${JUMP_HOST-orbit-astra}"            # 빈 값이면 control-plane 에 직접 접속
REMOTE_USER="${REMOTE_USER:-orbit}"
CP_HOST="${CP_HOST:-192.168.100.101}"
SECRET_NAMESPACE="${SECRET_NAMESPACE:-orbit}"
SECRET_NAME="${SECRET_NAME:-orbit-server-secret}"
PROM_RW_URL="${PROM_RW_URL:-http://192.168.100.107:9090/api/v1/write}"
NO_PROM="${NO_PROM:-0}"

usage() {
  sed -n '4,6p' "$0" | sed 's/^# \{0,1\}//'
  local names=()
  for f in "$K6_DIR"/scenarios/*.js; do names+=("$(basename "$f" .js)"); done
  echo "시나리오: ${names[*]}"
  exit 2
}

scenario="${1:-}"
[[ -n "$scenario" ]] || usage
shift
script="$K6_DIR/scenarios/${scenario}.js"
[[ -f "$script" ]] || usage

read_secret() {
  local cmd="sudo kubectl --kubeconfig /etc/kubernetes/admin.conf -n ${SECRET_NAMESPACE} get secret ${SECRET_NAME} -o jsonpath={.data.$1}"
  if [[ -n "$JUMP_HOST" ]]; then
    # 경유 호스트의 셸이 한 번 더 해석하므로 명령을 클라이언트에서 미리 quote 해서 넘긴다.
    # shellcheck disable=SC2029
    ssh "$JUMP_HOST" "ssh -o BatchMode=yes ${REMOTE_USER}@${CP_HOST} $(printf '%q' "$cmd")" | base64 -d
  else
    ssh -o BatchMode=yes "${REMOTE_USER}@${CP_HOST}" "$cmd" | base64 -d
  fi
}

# k6 는 시스템 환경 변수도 __ENV 로 읽는다. -e 로 넘기지 않아 프로세스 목록에 토큰이 보이지 않는다.
ADMIN_TOKEN="${ADMIN_TOKEN:-$(read_secret ADMIN_TOKEN)}"
ENROLLMENT_KEY="${ENROLLMENT_KEY:-$(read_secret ENROLLMENT_KEY)}"
if [[ -z "$ADMIN_TOKEN" || -z "$ENROLLMENT_KEY" ]]; then
  echo "토큰을 읽지 못했다. ADMIN_TOKEN·ENROLLMENT_KEY 를 직접 지정하거나 Secret 접근 경로를 확인한다." >&2
  exit 1
fi
export ADMIN_TOKEN ENROLLMENT_KEY

RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${scenario}}"
out_dir="$K6_DIR/runs/$RUN_ID"

k6_args=(-e "RUN_ID=$RUN_ID" --summary-export "$out_dir/summary.json")

if [[ "$NO_PROM" != 1 ]]; then
  # 전송에 실패해도 k6 는 성공으로 끝나므로 시작 전에 수신 가능 여부를 확인한다.
  ready_url="${PROM_RW_URL%/api/v1/write}/-/ready"
  if ! curl -fsS -m 3 -o /dev/null "$ready_url"; then
    echo "Prometheus 에 닿지 않는다: $ready_url (내부망에 닿는 호스트에서 실행하거나 NO_PROM=1)" >&2
    exit 1
  fi
  export K6_PROMETHEUS_RW_SERVER_URL="$PROM_RW_URL"
  export K6_PROMETHEUS_RW_TREND_STATS="${K6_PROMETHEUS_RW_TREND_STATS:-p(50),p(95),p(99),avg,max}"
  k6_args+=(-o experimental-prometheus-rw)
fi

mkdir -p "$out_dir"
{
  echo "run_id: $RUN_ID"
  echo "scenario: $scenario"
  echo "started_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host: $(hostname)"
  echo "k6: $(k6 version | head -1)"
  echo "repo_commit: $(git -C "$K6_DIR" rev-parse --short HEAD)$(git -C "$K6_DIR" diff --quiet HEAD -- . || echo ' (uncommitted changes)')"
  echo "args: $*"
  echo "prometheus: $([[ "$NO_PROM" == 1 ]] && echo off || echo "$PROM_RW_URL")"
} >"$out_dir/conditions.txt"

echo "run_id=$RUN_ID → $out_dir"
set +e
k6 run "${k6_args[@]}" "$@" "$script" 2>&1 | tee "$out_dir/k6.log"
status="${PIPESTATUS[0]}"
set -e
echo "finished_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$out_dir/conditions.txt"
echo "exit_code: $status" >>"$out_dir/conditions.txt"
exit "$status"
