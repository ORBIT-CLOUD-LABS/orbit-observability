# k6 부하 실험

Phase1 서버 HPA·복구 실험(ORBIT-CLOUD-LABS/orbit#23)과 OTA 전체 흐름 확인에 쓰는 k6 스크립트다. 실험 기준은 [docs/requirements.md](../docs/requirements.md) §k6 부하 실험을 따른다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `scenarios/smoke-e2e.js` | OTA 전체 흐름 1회 확인 (등록 → 체크인 → 매니페스트 → Edge 다운로드 → 결과 보고) |
| `scenarios/server-hpa.js` | 서버 부하. 체크인 → (업데이트 대상이면) 매니페스트, `ramping-arrival-rate` |
| `lib/config.js` | 실행 설정 (`-e` 또는 환경 변수) |
| `lib/fixture.js` | 시험 데이터 준비. 차종은 `K6-` 로 시작하고 이미 있으면 재사용 |
| `lib/vehicle-api.js`, `lib/cdn.js` | 체크인·매니페스트 호출, Edge 다운로드 |
| `scripts/run.sh` | 실행 조건 기록·토큰 주입·Prometheus 전송을 묶은 실행 스크립트 |
| `scripts/cleanup.sh` | `K6-` 시험 데이터를 DB·NFS 에서 삭제 |

## 실행 전 확인

- **실행 위치**: 내부망(`192.168.100.0/24`)에 직접 닿는 ASTRA 밖 호스트. ASTRA 안 VM 에서 실행하면 서버와 물리 CPU 를 나눠 써 결과가 왜곡된다.
  - SSH 터널은 smoke 처럼 1회 확인할 때만 쓴다. 터널이 병목이 되므로 부하 실험에는 쓰지 않는다.
- **접근**: 서버 `192.168.100.102:30080`, Edge `:30081`, Prometheus `192.168.100.107:9090`
- **토큰**: `run.sh` 가 `orbit-astra` → control-plane 경유로 Secret `orbit/orbit-server-secret` 에서 읽는다. 다른 경로면 `ADMIN_TOKEN`·`ENROLLMENT_KEY` 를 환경 변수로 직접 지정한다.
- **동시 실행 금지**: 서버 실험과 CDN 실험을 함께 돌리지 않는다. 실행 중에는 서버 이미지·설정을 바꾸지 않는다.

## 실행

```bash
# OTA 전체 흐름 확인
k6/scripts/run.sh smoke-e2e

# 서버 부하 (값은 orbit#23 사전 측정 결과로 정한다)
k6/scripts/run.sh server-hpa -e STAGES=10:1m,50:3m,100:5m,10:2m -e VEHICLES=100 -e UPDATE_RATIO=0.1
```

`run.sh` 뒤의 인자는 그대로 `k6 run` 에 넘어간다.

### 설정 값

| 값 | 기본값 | 시나리오 | 설명 |
| --- | --- | --- | --- |
| `SERVER_URL` | `http://192.168.100.102:30080` | 공통 | 서버 NodePort |
| `CDN_URL` | 없음 | smoke | 매니페스트 `downloadUrl` 의 주소 부분을 바꿀 때 (터널 등) |
| `RUN_ID` | `<UTC 시각>-<시나리오>` | 공통 | 실행 구분값. Prometheus `run_id` label, 결과 디렉터리 이름 |
| `FIRMWARE_SIZE_MB` | `1` | smoke | 시험 파일 크기 |
| `STAGES` | `10:1m,50:2m,100:3m,100:3m,10:2m` | server-hpa | `요청률(iteration/s):유지 시간` 목록 |
| `VEHICLES` | `100` | server-hpa | 차량 수 = 최대 VU. VU 하나가 차량 하나를 맡는다 |
| `UPDATE_RATIO` | `0.1` | server-hpa | 업데이트 대상 비율. 대상이면 매니페스트까지 호출 |
| `NO_PROM` | `0` | run.sh | `1` 이면 Prometheus 로 보내지 않는다 |
| `PROM_RW_URL` | `http://192.168.100.107:9090/api/v1/write` | run.sh | remote write 주소 |

## 결과

- **로컬**: `k6/runs/<RUN_ID>/` 에 `conditions.txt`(실행 조건·종료 코드), `k6.log`, `summary.json`. git 에 올리지 않는다.
- **Prometheus**: `k6_` 로 시작하는 지표에 `run_id`·`experiment`·`name`(`check-in`, `manifest`, `fixture:*`) label 이 붙는다. 응답 시간은 `p(50)·p(95)·p(99)·avg·max` 로 보낸다. 차량 ID 가 들어간 `url` tag 는 보내지 않는다.
  - fixture 요청은 `phase="fixture"` 로 구분되므로 측정에서는 `name` 이 `check-in`·`manifest` 인 것만 본다.
- **결과 문서**: run ID 별 조건·원시 결과·판정은 orbit 레포에 정리한다.
- `server-hpa` 의 thresholds 는 판정 기준이 아니다. 요약에 `name` 별 값을 따로 보여 주기 위한 기준선이다.

## 정리

서버에 삭제 API 가 없어서 시험 데이터는 직접 지운다. 삭제 대상을 보여 준 뒤 접두어를 다시 입력해야 지운다.

```bash
k6/scripts/cleanup.sh K6-SMOKE-<RUN_ID>   # smoke 1회분 (smoke 출력 마지막 줄에 나온다)
k6/scripts/cleanup.sh K6-SMOKE-           # smoke 전체
k6/scripts/cleanup.sh K6-                 # 부하 fixture(K6-LOAD) 포함 전체. 실험 기간에는 지우지 않는다
```
