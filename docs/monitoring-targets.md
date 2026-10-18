# 실험 모니터링 대상과 수집 경로

Phase1 서버 HPA·복구 실험(ORBIT-CLOUD-LABS/orbit#23)과 CDN 실험(ORBIT-CLOUD-LABS/orbit#24)에서 판정에 쓰는 지표와 그 수집 경로다. 수집 가능한 것을 전부 모으지 않고, 실험 질문 → 지표 → 수집 경로 순으로 골랐다 (#14). 화면은 `load-recovery-experiment` 대시보드(#6)다.

2026-10-17 orbit-astra 기준으로 아래 표의 대상이 모두 수집되는 것을 확인했다.

## 수집 경로

```text
[orbit-astra 클러스터]
  orbit-server /actuator/prometheus ─┐
  kubelet /metrics/cadvisor ─────────┼─ Alloy (DaemonSet) ── remote write ──┐
  kube-state-metrics ────────────────┘                                      │
  orbit namespace Pod stdout ──────── Alloy ── push ──────────────── Loki :3100
                                                                            │
[k6 실행 위치 (ASTRA 호스트 등)]                                            │
  k6 ── experimental-prometheus-rw ── remote write ──────────────┐          │
                                                                 ▼          ▼
[VM·ASTRA 호스트]                                   모니터링 VM 192.168.100.107
  node_exporter :9100 ◀── scrape (5s) ──────────── Prometheus :9090 ── Grafana :3000
                                                        │
                                                        └─ 규칙 평가 ──▶ Alertmanager :9093
```

| 경로 | 대상 | 설정 위치 | 간격 |
| --- | --- | --- | --- |
| Prometheus scrape | node_exporter: ASTRA 호스트(`192.168.100.1`), VM `192.168.100.100~107` | `prometheus/prometheus.yml` `node` job | 5s |
| Alloy → remote write | orbit-server(`:8080/actuator/prometheus`), cAdvisor, kube-state-metrics | orbit-gitops `platform/alloy/config.alloy` | 30s |
| Alloy → Loki | `orbit` namespace Pod stdout (Nginx JSON access log 포함) | 같은 파일 | - |
| k6 → remote write | `k6_*` 지표 | `k6/scripts/run.sh` | k6 기본 |
| Prometheus → Alertmanager | 알림 규칙 발화 (같은 VM 루프백 `localhost:9093`) | `prometheus/rules/alerts.yml`, `alertmanager/alertmanager.yml` | 30s (규칙 평가) |

remote write 9090 은 k8s 노드 4대와 `192.168.100.1` 에서만 받는다. ASTRA 밖 장비도 Tailscale subnet router 를 지나며 `192.168.100.1` 로 보인다 (`prometheus/README.md`).

## 실험 질문별 대상

### 서버 실험 (HPA)

| 질문 | 지표 | 수집 경로 | 대시보드 |
| --- | --- | --- | --- |
| replica 가 늘었는가 | `kube_horizontalpodautoscaler_status_target_metric{metric_target_type="utilization"}`, `kube_deployment_spec_replicas`, `kube_deployment_status_replicas_available`, `kube_pod_status_ready` | kube-state-metrics | HPA 사용률, Replica |
| 서버가 병목이었는가 | `container_cpu_usage_seconds_total`, `container_cpu_cfs_throttled_periods_total` / `container_cpu_cfs_periods_total`, `container_memory_working_set_bytes`, request·limit | cAdvisor, kube-state-metrics | Pod CPU·메모리·throttling |
| 처리량이 개선됐는가 | `http_server_requests_seconds_*` (차량 API `uri` 별 요청률·5xx 비율·P95) | orbit-server | 차량 API 요청률·P95 |
| DB 가 먼저 막혔는가 | DB VM CPU (user·system·iowait 구분), DB 디스크 쓰기 횟수, `hikaricp_connections_active`·`pending`·`acquire_seconds` | node_exporter, orbit-server | Hikari, DB VM CPU·디스크 쓰기 |
| 부하 발생기는 정상이었는가 | `k6_http_reqs_total`, `k6_http_req_duration_p95`, `k6_dropped_iterations_total`, `k6_vus` | k6 | 부하 발생기 (k6) |
| 물리 CPU 가 한계였는가 | ASTRA 호스트 `node_cpu_seconds_total` | node_exporter | VM·노드 CPU |

### CDN 실험

| 질문 | 지표 | 수집 경로 | 대시보드 |
| --- | --- | --- | --- |
| 캐시가 Origin 요청을 줄였는가 | Edge `cache`(HIT/MISS) 별 요청 수, Origin 요청 수·`bytes` | Nginx JSON access log → Loki | Edge·Origin |
| 다운로드 성능 | byte/s, P95, 응답 크기 | k6 (`X-Cache-Status` tag) | 미구성 (k6 CDN 시나리오 #16) |
| 원본 I/O 가 병목이었나 | NFS VM·ASTRA 디스크 I/O | node_exporter | VM·노드 디스크 I/O |

### 복구 실험 (Pod 삭제)

| 질문 | 지표 | 수집 경로 | 대시보드 |
| --- | --- | --- | --- |
| 언제 내려가고 돌아왔나 | `kube_pod_start_time`, `kube_pod_status_ready`, available replica | kube-state-metrics | Pod 나이, Replica |
| 요청이 몇 개 실패했나 | `k6_http_reqs_total{expected_response="false"}`, 서버 5xx | k6, orbit-server | k6 실패 요청률, 차량 API 오류율 |

## 알림 규칙

규칙은 `prometheus/rules/alerts.yml`, 통지 설정은 `alertmanager/alertmanager.yml` 이다 (#29).
위 "실험 질문별 대상" 의 지표 중 **사람이 보고 있지 않아도 알아야 하는 것** 만 골랐다.
적용 절차는 `alertmanager/README.md`.

| 그룹 | 알림 | 조건 | 왜 |
| --- | --- | --- | --- |
| targets | `Watchdog` | 항상 발화 | 이 알림이 사라지면 알림 경로 자체가 죽은 것이다. 사람에게 보내지 않는다 |
| targets | `TargetDown` | `up == 0`, 10m | node_exporter·kubelet·kube-state-metrics·Alertmanager 를 한 규칙으로 덮는다. Alloy 가 붙이는 job·instance 값에 의존하지 않게 job 별로 쪼개지 않았다 |
| targets | `RemoteWriteRejected` | write 4xx·5xx > 0, 10m | label 붕괴 → `duplicate sample` 400 → Prometheus 2.45 가 배치 통째 Rollback. 패널이 비는 모습으로만 드러나 발견이 늦었다 (orbit-gitops#35, #38) |
| kubernetes | `PodNotReady` | Ready=false, 10m | 복구 실험에서 보던 상태를 상시 감시로 돌린 것 |
| kubernetes | `DeploymentReplicasUnavailable` | available < spec, 15m | HPA scale-out 중 일시적 부족은 정상이라 `for` 를 길게 둔다 |
| kubernetes | `ContainerRestartingRepeatedly` | 15분간 재시작 > 2 | CrashLoop 를 재시작 횟수로 잡는다 |
| kubernetes | `ContainerCpuThrottlingHigh` | throttled 비율 > 25%, 15m | request 500m / limit 750m 확정값(orbit#23) 기준으로 limit 부족 신호 |
| orbit-server | `VehicleApiErrorRateHigh` | 차량 API 5xx > 1%, 10m | 판정 패널과 같은 `uri` 필터를 쓴다 (health probe 제외) |
| orbit-server | `VehicleApiLatencyP95High` | P95 > 1s, 10m | 임계값은 1차 제안값 |
| orbit-server | `HikariConnectionsPending` | pending > 0, 10m | DB 가 먼저 막혔는지 보는 지표. iowait 와 함께 읽는다 (orbit#23 `T_db`) |
| nodes | `NodeDiskSpaceLow` | 여유 < 15%, 30m | 보존 15일 설정과 모니터링 VM data disk(20GiB)를 함께 본다 |

규칙을 쓸 때 걸리는 제약:

- **Alloy 를 지나는 지표만 쓸 수 있다.** cAdvisor 는 `container_cpu_usage_seconds_total`·
  `container_cpu_cfs_periods_total`·`container_cpu_cfs_throttled_periods_total`·
  `container_memory_working_set_bytes` 만 통과하고, label 도 허용목록만 남는다. 허용목록에 없는
  지표·label 로 규칙을 쓰면 시계열이 없거나 붕괴한 값을 본다. node_exporter 지표는 Prometheus 가
  직접 scrape 하므로 이 제약이 없다.
- **임계값과 `for` 는 1차 제안값이다.** 부하 실험 중에는 CPU throttling·P95 상승이 의도된
  상태라 `for` 를 길게 뒀다. 실험 결과(orbit#23)로 확정하기 전까지 확정값처럼 다루지 않는다.
- **대응 절차는 orbit 레포에 둔다.** 알림의 `runbook_url` 은 orbit#47 Runbook 이 문서로 나오면
  그 경로로 교체한다 (Org CONTRIBUTING: Runbook 은 orbit).

## 지표를 추가하거나 바꿀 때

- **label 을 지우면 시계열이 붕괴한다.** Alloy 는 label 허용목록(`labelkeep`)을 쓴다. 지표를 서로 구분하는 label 이 목록에 없으면 여러 시계열이 같은 label set 이 된다. 같은 timestamp 샘플은 하나만 남고, Prometheus 2.45 는 `duplicate sample` 400 이 나면 write 배치 전체를 버린다. cAdvisor(orbit-gitops#35)와 orbit-server(orbit-gitops#38)에서 실제로 겪었다.
  - orbit-server: `orbit_server_labels` 허용목록. 서버가 새 지표를 내보내면 `/actuator/prometheus` 출력에서 구분 label 을 확인하고 추가한다.
  - cAdvisor: 대시보드가 쓰는 지표 이름만 남기고(`cadvisor_select`), `container` 가 비었거나 `POD` 인 시계열은 버린다.
  - 확인 방법: 변경 후 Alloy 로그에 remote write 400 이 없는지, `up` 이 모든 노드에서 1 인지 본다.
- **값이 계속 늘어나는 label 은 쓰지 않는다.** 차량 ID·토큰은 label 로 남기지 않는다. 서버 `uri` 는 `/api/v1/vehicles/{vehicleId}/...` 템플릿이라 차량 수와 무관하다. k6 는 `name` tag 로 묶고 `url` 은 보내지 않는다.
- **차량 API 만 본다.** 서버 지표에는 health probe·`/actuator/prometheus` 요청도 섞인다. 판정 패널은 `uri=~"/api/v1/vehicles/[{]vehicleId[}]/.*"` 로 거른다. k6 는 `name=~"check-in|manifest"` 로 fixture 요청을 뺀다.
- **값이 없을 수 있는 지표에는 `or vector(0)`.** `k6_dropped_iterations_total` 은 drop 이 생기기 전에는 시계열이 없고, 5xx 가 없으면 오류율 분자가 비어 패널이 빈다.
- **DB CPU 는 iowait 를 따로 본다.** `100 - idle` 은 디스크를 기다리는 시간(iowait)까지 사용 중으로 센다. DB VM 은 체크인 commit 마다 디스크 동기화가 생기고 디스크를 ASTRA 호스트의 다른 VM 과 함께 쓰므로, CPU 가 차 보여도 실제로는 디스크 쓰기 대기일 수 있다 (ORBIT-CLOUD-LABS/orbit#23 `T_db`: 'CPU 96~100%' 중 약 40% 가 iowait)
- **`k6_vus` 는 일하는 VU 수다.** arrival-rate 실행에서 부하가 작고 응답이 빠르면 0 에 가깝다. 준비된 VU 는 `k6_vus_max`.
- **서버 JVM 은 Serial GC 다.** CPU limit 이 2 CPU 미만(현재 500m)이면 JVM 이 Serial GC 를 고른다 (`gc="Copy"`·`"MarkSweepCompact"`, 메모리 영역 `Eden Space`·`Survivor Space`·`Tenured Gen`). CPU limit 을 바꾸면 GC 종류와 지표 값이 함께 바뀔 수 있다.

## 수집하지 않는 것

| 대상 | 이유 |
| --- | --- |
| DB 내부 지표 (QPS·잠금 대기) | 아직 없음. 필요하면 mysqld_exporter 를 검토한다 (설치는 orbit-infrastructure) |
| Nginx 전용 exporter | `stub_status` 는 연결 수만 준다. HIT/MISS 는 JSON access log 를 Loki 로 집계한다 |
| Jenkins·Argo CD 메트릭 | 실험 질문과 무관하다. node_exporter 기본 상태만 본다 |
