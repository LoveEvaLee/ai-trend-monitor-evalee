#!/bin/bash
# VM 데일리 갱신 — 헤르메스·아르고스 digest → data/ 공급 파일 → push(GitHub Pages 자동 재배포).
# harness-vm 크론(/etc/cron.d/harness, 13:30 KST — 아르고스 12:30 큐레이션 뒤)이 매일 부른다.
# 호 보관(data/archive/)은 월요일만 — 데일리는 latest·weekly_note·popularity만 갱신.
# 맥에서 손으로 돌릴 때는 이 래퍼 말고 export_monitor.py를 직접 쓴다(경로 기본값이 맥).
set -u
REPO="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG() { echo "[$(date '+%F %T')] $*"; }
[ -f /root/.harness-env ] && . /root/.harness-env
NOTIFY=/root/한양대학교/Hermes/_pipeline/scripts/notify_failure.sh
fail() {
  LOG "실패: $1"
  [ -x "$NOTIFY" ] && "$NOTIFY" "동향 모니터 갱신 실패" "$1 (repo: $REPO)"
  exit 1
}

cd "$REPO" || exit 1
git pull --ff-only || fail "git pull 실패 — 원격과 어긋남(수동 확인 필요)"

export HERMES_VAULT="${HERMES_VAULT:-/root/한양대학교/Hermes}"
export ARGUS_VAULT="${ARGUS_VAULT:-/root/한양대학교/Argus}"
ARGS=""
[ "$(date +%u)" != "1" ] && ARGS="--no-archive"
python3 scripts/export_monitor.py $ARGS || fail "export_monitor.py 실패"

git add data/
if git diff --cached --quiet; then
  LOG "변경 없음 — push 생략"
  exit 0
fi
git commit -m "데일리 갱신 $(date +%F) — latest·weekly_note·popularity$([ -z "$ARGS" ] && echo '·주간 호') (VM 자동)" \
  || fail "commit 실패"
git push || fail "push 실패 — 배포키 확인"
LOG "push 완료 — Pages 재배포는 1~2분 뒤"
