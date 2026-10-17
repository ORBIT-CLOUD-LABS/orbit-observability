#!/usr/bin/env bash
# k6 가 만든 시험 데이터(차종이 K6- 로 시작)를 DB 와 NFS 에서 지운다. 서버에 삭제 API 가 없어서 직접 지운다.
#
# 사용법: k6/scripts/cleanup.sh <차종 접두어> [--yes]
#   k6/scripts/cleanup.sh K6-SMOKE-1792132969355   # smoke 1회분
#   k6/scripts/cleanup.sh K6-SMOKE-                # smoke 전체
#   k6/scripts/cleanup.sh K6-                      # 부하 fixture(K6-LOAD) 포함 전체
#
# 삭제 전에 대상 건수와 파일 목록을 보여주고, 접두어를 다시 입력해야 지운다 (--yes 면 묻지 않는다).
# vehicle·campaign 을 지우면 credential·state·update_result·target 행은 ON DELETE CASCADE 로 함께 지워진다.
set -euo pipefail

JUMP_HOST="${JUMP_HOST-orbit-astra}"            # 빈 값이면 DB·NFS VM 에 직접 접속
REMOTE_USER="${REMOTE_USER:-orbit}"
DB_HOST="${DB_HOST:-192.168.100.106}"
DB_NAME="${DB_NAME:-vehicle}"
NFS_HOST="${NFS_HOST:-192.168.100.105}"
FIRMWARE_DIR="${FIRMWARE_DIR:-/srv/nfs/origin/firmware}"

usage() {
  sed -n '4,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

prefix="${1:-}"
assume_yes="${2:-}"
[[ -n "$prefix" ]] || usage
[[ -z "$assume_yes" || "$assume_yes" == "--yes" ]] || usage

# SQL·셸에 그대로 들어가는 값이라 문자 집합을 제한한다. '_'·'%' 같은 LIKE 와일드카드도 막힌다.
if [[ ! "$prefix" =~ ^K6-[A-Za-z0-9-]*$ ]]; then
  echo "접두어는 K6- 로 시작하고 영문·숫자·'-' 만 쓸 수 있다: $prefix" >&2
  exit 2
fi

# ssh 는 원격 명령에 쓰지 않아도 stdin 을 읽는다. -n 이 없으면 확인 입력을 파이프로 줄 때
# (echo K6-... | cleanup.sh K6-...) 삭제 대상 조회용 ssh 가 그 입력을 먼저 먹어서 read 가 빈 값을 받고 취소된다.
remote() {
  local host="$1" cmd="$2"
  if [[ -n "$JUMP_HOST" ]]; then
    # 경유 호스트의 셸이 한 번 더 해석하므로 명령을 클라이언트에서 미리 quote 해서 넘긴다.
    # shellcheck disable=SC2029
    ssh -n "$JUMP_HOST" "ssh -n -o BatchMode=yes ${REMOTE_USER}@${host} $(printf '%q' "$cmd")"
  else
    ssh -n -o BatchMode=yes "${REMOTE_USER}@${host}" "$cmd"
  fi
}

db() {
  remote "$DB_HOST" "sudo mysql --batch --skip-column-names ${DB_NAME} -e $(printf '%q' "$1")"
}

like="model LIKE '${prefix}%'"

count_rows() {
  db "SELECT (SELECT COUNT(*) FROM vehicle WHERE ${like}),
             (SELECT COUNT(*) FROM campaign WHERE ${like}),
             (SELECT COUNT(*) FROM artifact WHERE ${like});"
}

list_dirs() {
  remote "$NFS_HOST" "sudo find $(printf '%q' "$FIRMWARE_DIR") -mindepth 1 -maxdepth 1 -type d -name $(printf '%q' "${prefix}*") | sort"
}

print_targets() {
  read -r vehicles campaigns artifacts <<<"$(count_rows)"
  echo "DB ${DB_HOST}/${DB_NAME}: vehicle ${vehicles}, campaign ${campaigns}, artifact ${artifacts}"
  echo "NFS ${NFS_HOST}:${FIRMWARE_DIR}:"
  dirs="$(list_dirs)"
  if [[ -n "$dirs" ]]; then
    # shellcheck disable=SC2001  # 여러 줄 각각에 들여쓰기를 붙인다
    sed 's/^/  /' <<<"$dirs"
  else
    echo "  (없음)"
  fi
}

echo "== 삭제 대상 (차종 ${prefix}*)"
print_targets

if [[ "$vehicles" == 0 && "$campaigns" == 0 && "$artifacts" == 0 && -z "$dirs" ]]; then
  echo "지울 데이터가 없다."
  exit 0
fi

if [[ "$assume_yes" != "--yes" ]]; then
  read -r -p "지우려면 접두어(${prefix})를 다시 입력: " answer
  if [[ "$answer" != "$prefix" ]]; then
    echo "취소했다."
    exit 1
  fi
fi

# campaign 이 artifact 를 참조하므로 campaign 을 먼저 지운다.
db "START TRANSACTION;
    DELETE FROM vehicle WHERE ${like};
    DELETE FROM campaign WHERE ${like};
    DELETE FROM artifact WHERE ${like};
    COMMIT;"
remote "$NFS_HOST" "sudo find $(printf '%q' "$FIRMWARE_DIR") -mindepth 1 -maxdepth 1 -type d -name $(printf '%q' "${prefix}*") -exec rm -rf {} +"

echo "== 삭제 후"
print_targets
