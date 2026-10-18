# k6 부하 실험

Phase1 서버 HPA·복구 실험(ORBIT-CLOUD-LABS/orbit#23), CDN 캐시·Edge 실험(ORBIT-CLOUD-LABS/orbit#24)과 OTA 전체 흐름 확인에 쓰는 k6 스크립트다. 실험 기준은 [docs/requirements.md](../docs/requirements.md) §k6 부하 실험을 따른다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `scenarios/smoke-e2e.js` | OTA 전체 흐름 1회 확인 (등록 → 체크인 → 매니페스트 → Edge 다운로드 → 결과 보고) |
| `scenarios/server-hpa.js` | 서버 부하. 체크인 → (업데이트 대상이면) 매니페스트, `ramping-arrival-rate` |
| `scenarios/cdn-download.js` | CDN 부하. 매니페스트로 받은 Edge 주소에서 같은 시험 파일을 반복 다운로드, `ramping-arrival-rate` |
| `lib/config.js` | 실행 설정 (`-e` 또는 환경 변수) |
| `lib/fixture.js` | 시험 데이터 준비. 차종은 `K6-` 로 시작하고 이미 있으면 재사용 |
| `lib/vehicle-api.js`, `lib/cdn.js` | 체크인·매니페스트 호출, Edge 다운로드 |
| `scripts/run.sh` | 실행 조건 기록·토큰 주입·Prometheus 전송을 묶은 실행 스크립트 |
| `scripts/cleanup.sh` | `K6-` 시험 데이터를 DB·NFS 에서 삭제 |

## 실행 전 확인

- **실행 위치**: 위치는 실험 조건의 하나다. 여러 위치에서 실행해 볼 수 있으며, 아래를 지킨다.
  - 비교하는 run(예: 고정 replica vs HPA, 사전 측정과 본 실험)은 같은 위치에서 실행한다. 위치는 `conditions.txt` 의 `host` 로 남는다.
  - 실행마다 dropped iterations 와 부하 발생기 쪽 CPU 를 함께 보고, 결과 문서에 위치와 경로(직접·중계)를 적는다.
  - SSH 터널은 smoke 처럼 1회 확인할 때만 쓴다. 터널이 병목이 되므로 부하 실험에는 쓰지 않는다.

  | 위치 | 경로 (2026-10-17 확인) | 주의 |
  | --- | --- | --- |
  | ASTRA 호스트 (`orbit-astra`, `192.168.100.1`) | `virbr100` 직접 | VM 과 물리 CPU 를 나눠 쓴다. `taskset` 으로 k6 코어를 묶고(예: 10·11), ASTRA 호스트 CPU(node_exporter `192.168.100.1`)를 함께 기록한다 |
  | ASTRA 밖 장비 (개인 Mac, orbit-sol 등) | Tailscale 중계(DERP, 왕복 약 70ms) | 중계의 대역폭·지연이 결과에 섞인다. 들어오는 트래픽은 ASTRA 의 `tailscaled` 가 풀므로 ASTRA CPU 도 쓴다. LAN 으로 직접 연결되면 경로를 다시 확인한다 |
  | ASTRA 안 VM | 내부망 직접 | vCPU 가 이미 과할당(14 vCPU / 12 스레드)이라 서버와 CPU 를 다툰다 |
- **접근**: 서버 `192.168.100.102:30080`, Edge `:30081`, Prometheus `192.168.100.107:9090`
  - Prometheus 9090 은 허용 출발지만 받는다. ASTRA 호스트와 Tailscale 경유 장비는 모두 `192.168.100.1` 로 보여 이미 허용돼 있다. LAN 으로 직접 연결되는 장비처럼 다른 주소로 들어오면 모니터링 VM ufw 에 추가한다 (`prometheus/README.md` Remote write). 허용 전에는 `run.sh` 가 시작 전에 멈춘다 (`NO_PROM=1` 이면 보내지 않고 실행)
- **k6 설치 (ASTRA 호스트)**: sudo 없이 공식 릴리스 바이너리를 체크섬 확인 후 `~/.local/bin` 에 둔다. 비대화형 ssh 셸에는 이 경로가 `PATH` 에 없으므로 실행 시 지정한다.

  ```bash
  V=v2.3.0; F=k6-$V-linux-amd64.tar.gz
  curl -fsSLO https://github.com/grafana/k6/releases/download/$V/$F
  curl -fsSL https://github.com/grafana/k6/releases/download/$V/k6-$V-checksums.txt | grep " $F\$" | sha256sum -c -
  tar xzf $F && install -m 755 k6-$V-linux-amd64/k6 ~/.local/bin/k6
  ```
- **토큰**: `run.sh` 가 `orbit-astra` → control-plane 경유로 Secret `orbit/orbit-server-secret` 에서 읽는다. 다른 경로면 `ADMIN_TOKEN`·`ENROLLMENT_KEY` 를 환경 변수로 직접 지정한다.
- **동시 실행 금지**: 서버 실험과 CDN 실험을 함께 돌리지 않는다. 실행 중에는 서버 이미지·설정을 바꾸지 않는다.

## 실행

```bash
# OTA 전체 흐름 확인
k6/scripts/run.sh smoke-e2e

# 서버 부하 (값은 orbit#23 사전 측정 결과로 정한다)
k6/scripts/run.sh server-hpa -e STAGES=10:1m,50:3m,100:5m,10:2m -e VEHICLES=100 -e UPDATE_RATIO=0.1

# CDN 다운로드 (20MB 파일, 초당 10건 2분)
k6/scripts/run.sh cdn-download -e FIRMWARE_SIZE_MB=20 -e STAGES=10:10s,10:2m
```

`run.sh` 뒤의 인자는 그대로 `k6 run` 에 넘어간다.

ASTRA 호스트에서 실행할 때는 `~/orbit-observability`(develop clone)에서 아래처럼 한다. 이미 ASTRA 안이므로 `JUMP_HOST=` 로 control-plane 에 직접 접속해 토큰을 읽는다.

```bash
cd ~/orbit-observability && git pull --ff-only
export PATH=$HOME/.local/bin:$PATH
JUMP_HOST= taskset -c 10,11 k6/scripts/run.sh server-hpa -e STAGES=... -e VEHICLES=100 -e UPDATE_RATIO=0.1
```

### 설정 값

| 값 | 기본값 | 시나리오 | 설명 |
| --- | --- | --- | --- |
| `SERVER_URL` | `http://192.168.100.102:30080` | 공통 | 서버 NodePort |
| `CDN_URL` | 없음 | smoke | 매니페스트 `downloadUrl` 의 주소 부분을 바꿀 때 (터널 등) |
| `RUN_ID` | `<UTC 시각>-<시나리오>` | 공통 | 실행 구분값. 결과 디렉터리 이름, Prometheus `run_id` label |
| `FIRMWARE_SIZE_MB` | `1` (smoke), `10` (cdn-download) | smoke, cdn-download | 시험 파일 크기. cdn-download 는 크기마다 차종 `K6-CDN-<N>MB` 를 따로 두고 재사용한다 |
| `STAGES` | `10:1m,50:2m,100:3m,100:3m,10:2m` (server-hpa), `5:1m,20:3m` (cdn-download) | server-hpa, cdn-download | `목표 요청률(iteration/s):시간` 목록. 앞 단계 값에서 목표까지 그 시간 동안 직선으로 올린다 (아래 단계 유지). 시간은 단위 하나만 쓴다 (`390s` 는 되고 `6m30s` 는 안 된다) |
| `HASH_RATIO` | `0.05` | cdn-download | SHA-256 까지 검증할 요청 비율(0~1). 크기는 매번 검증한다. 해시 계산이 k6 CPU 를 많이 써서 처리량 한계를 잴 때는 `0` 으로 둔다 |
| `MAX_VUS` | `100` | cdn-download | 최대 VU. 다운로드가 느려져 VU 가 모자라면 dropped iterations 가 생긴다 |
| `VEHICLES` | `100` | server-hpa | 차량 수 = 최대 VU. VU 하나가 차량 하나를 맡는다 |
| `UPDATE_RATIO` | `0.1` | server-hpa | 업데이트 대상 비율. 대상이면 매니페스트까지 호출 |
| `JUMP_HOST` | `orbit-astra` | run.sh, cleanup.sh | 클러스터 VM 에 접속할 때 거치는 호스트. ASTRA 호스트에서 실행하면 빈 값(`JUMP_HOST=`) |
| `NO_PROM` | `0` | run.sh | `1` 이면 Prometheus 로 보내지 않는다 |
| `PROM_RW_URL` | `http://192.168.100.107:9090/api/v1/write` | run.sh | remote write 주소 |

### 단계 유지

`server-hpa` 는 `ramping-arrival-rate` 라 `STAGES` 의 각 값은 "그 값까지 직선으로 올리기"다. 유지 구간이 필요하면 같은 값을 한 번 더 적는다.

```bash
# 연속 증가: 20 → 40 → 80 사이를 계속 올린다. 한계 범위를 빠르게 찾을 때
-e STAGES=5:2m,20:1m,40:1m,80:1m

# 계단: 20초 동안 올리고 2분 유지. 한계값(T_pod·T_db)을 판정할 때
-e STAGES=5:30s,5:1m,80:20s,80:2m,120:20s,120:2m,160:20s,160:2m
```

- 처음 `5:30s,5:1m` 은 JIT warm-up 이라 판정에서 뺀다
- 서버·cAdvisor 지표는 30초마다 수집되므로 단계 판정은 2분 창(`[2m]`)으로 본다. 1분 창은 샘플이 2개뿐이라 값이 튄다

### CDN 실험 (cold·warm)

- **cold**: Edge 캐시가 빈 상태. `kubectl -n orbit rollout restart deployment/cdn-edge` 로 Edge 를 다시 띄우고 Ready 를 확인한 직후 실행한다. Edge 마다 첫 요청 1건만 `MISS`(Origin 으로 감)이고 이후 `HIT` 여야 한다
- **warm**: cold 실행 직후 같은 파일로 다시 실행한다. 모든 요청이 `HIT` 이고 Origin 요청이 0 이어야 한다
- **캐시 조건** (orbit-gitops `workloads/cdn` 의 `proxy_cache`): `max_size=1g`, `inactive=30m`. 시험 파일은 1GB 보다 충분히 작게 두고(20MB 이하), warm 실행은 cold 뒤 30분 안에 끝낸다. 30분 넘게 요청이 없으면 캐시에서 빠져 다시 `MISS` 가 된다
- **k6 코어**: 20MB 파일로 초당 수십 건을 받으면 k6 도 CPU 를 많이 쓴다. ASTRA 호스트에서는 4코어(`taskset -c 8-11`)로 묶고 `HASH_RATIO=0` 으로 실행한다
- **연결 재사용**: k6 는 연결을 재사용하고 NodePort 분산은 연결 단위라 요청이 한 Edge 로 몰릴 수 있다. Edge 수를 비교할 때는 run 마다 k6 를 새로 시작하고, Edge 별 분산을 `edge` label 로 확인한다

## 결과

- **로컬**: `k6/runs/<RUN_ID>/` 에 `conditions.txt`(실행 조건·종료 코드), `k6.log`, `summary.json`. git 에 올리지 않는다.
- **Prometheus**: `k6_` 로 시작하는 지표에 `run_id`·`experiment`·`name`(`check-in`, `manifest`, `fixture:*`) label 이 붙는다 (`experiment` 는 `server-hpa`·`smoke-e2e`). 응답 시간은 `p(50)·p(95)·p(99)·avg·max` 로 보낸다. 차량 ID 가 들어간 `url` tag 는 보내지 않는다.
  - fixture 요청은 `phase="fixture"` 로 구분되므로 측정에서는 `name` 이 `check-in`·`manifest` 인 것만 본다.
  - `k6_dropped_iterations_total` 은 한 번도 발생하지 않으면 시계열 자체가 없다. 조회할 때 `or vector(0)` 으로 0 을 채운다.
  - 2026-10-17 ASTRA 호스트에서 확인: `server-hpa`(`STAGES=1:20s`, `VEHICLES=2`) 1회로 시계열 274개가 `run_id`·`experiment="server-hpa"`·`name` label 과 함께 들어옴, `url` label 없음.
  - `cdn-download` 는 `experiment="cdn-download"` 이고, 다운로드 요청은 `name="download"` 다. Edge 응답 헤더(`X-Cache-Status`, `X-Edge-ID`)별 요청 수·받은 byte 를 `k6_cdn_requests_total`·`k6_cdn_bytes_total` 에 `cache`·`edge` label 로 남긴다. Loki 없이도 HIT/MISS 비율과 Edge 별 분산을 볼 수 있다 (2026-10-17 orbit#24 측정에서 확인).
- **결과 문서**: run ID 별 조건·원시 결과·판정은 orbit 레포에 정리한다.
- `server-hpa`·`cdn-download` 의 thresholds 는 판정 기준이 아니다. 요약에 `name` 별 값을 따로 보여 주기 위한 기준선이다.

## 정리

서버에 삭제 API 가 없어서 시험 데이터는 직접 지운다. 삭제 대상을 보여 준 뒤 접두어를 다시 입력해야 지운다.

```bash
k6/scripts/cleanup.sh K6-SMOKE-<RUN_ID>   # smoke 1회분 (smoke 출력 마지막 줄에 나온다)
k6/scripts/cleanup.sh K6-SMOKE-           # smoke 전체
k6/scripts/cleanup.sh K6-CDN-             # CDN 시험 파일 (K6-CDN-<N>MB). 지우면 다음 실행에서 다시 올린다
k6/scripts/cleanup.sh K6-                 # 부하 fixture(K6-LOAD) 포함 전체. 실험 기간에는 지우지 않는다
```
