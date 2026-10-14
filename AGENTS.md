# AGENTS.md

모니터링 VM(`astra-monitoring`)의 수집·저장·조회 구성을 작성·수정·리뷰하는 AI 에이전트용 지침.
이 문서는 작업 범위와 어떤 문서를 언제 볼지를 정한다.

## 요구사항

요구사항의 원본(source of truth)은 orbit 레포에 있다. 이 레포에 복사하지 않는다.
작업 전에 읽는 방법과 규칙은 [docs/requirements.md](docs/requirements.md).
Phase1 작업은 orbit `docs/phase1.md` 를 먼저 읽는다.

## 작업 전 읽을 문서

| 상황 | 문서 |
| --- | --- |
| 수집 구조·공통 값 확인 (항상) | [docs/requirements.md](docs/requirements.md) |
| Issue·Branch·커밋·PR·리뷰 | Org 공통 [CONTRIBUTING.md](https://github.com/ORBIT-CLOUD-LABS/.github/blob/main/CONTRIBUTING.md) |

## 범위

| 이 레포 | 다른 레포 |
| --- | --- |
| 모니터링 VM 의 Prometheus·Loki·Grafana 설정, 수집 대상, 보존 기간, 대시보드 | 클러스터 안 수집기(Alloy, kube-state-metrics) 배포 선언: orbit-gitops |
| | VM·호스트의 node_exporter 설치: orbit-infrastructure |
| | 서버 메트릭 노출(`/actuator/prometheus`): orbit-server |

## 수집 구조 (Phase1)

```text
클러스터 안 Alloy ──remote write──▶ Prometheus (192.168.100.107:9090)
                 └──push─────────▶ Loki       (192.168.100.107:3100)
VM·호스트 node_exporter (:9100) ◀──scrape── Prometheus
Grafana (:3000) ──조회──▶ Prometheus, Loki
```

## 핵심 규칙 요약

- 모니터링 VM 은 apt 패키지 + systemd 로 구성한다. Docker Compose 를 쓰지 않는다.
- 설정 파일은 이 레포에 두고, VM 에 적용하는 절차를 함께 남긴다.
- label 은 namespace·app·pod·instance 수준으로 둔다. 차량 ID·토큰처럼 값이 계속 늘어나는 항목을 label 로 쓰지 않는다.
- 비밀번호·토큰을 커밋하지 않는다.
- 미확정 공통 값은 확정된 것처럼 고정하지 말고 사용자에게 확인한다.

## 검증

PR 에는 실제로 실행한 검증만 적는다.

```bash
promtool check config <prometheus.yml>   # Prometheus 설정
loki -verify-config -config.file=<config> # Loki 설정
```
