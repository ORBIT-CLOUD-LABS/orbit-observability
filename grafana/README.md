# Grafana (systemd)

모니터링 VM(192.168.100.107:3000)에 apt 패키지로 이미 설치되어 있으나 서비스가 꺼져 있다.
Prometheus·Loki와 같은 방식(apt + systemd, Docker Compose 아님)이다.

## 기동

```bash
sudo systemctl enable --now grafana-server
curl -s http://localhost:3000/api/health
```

## 관리자 비밀번호

기본 `admin`/`admin`을 바로 바꾼다. 비밀번호 원문은 저장소에 남기지 않는다.

```bash
sudo grafana-cli admin reset-admin-password '<새 비밀번호>'
```

`reset-admin-password`는 기존 `admin` 사용자의 비밀번호만 바꾼다. DB(`/var/lib/grafana/grafana.db`,
sqlite)에 admin 사용자가 아직 없으면(예: 첫 기동이 꼬여 bootstrap이 실패한 경우) 조용히 아무것도
바꾸지 않고 "성공"만 출력하므로, 비밀번호를 바꿨는데도 로그인이 계속 실패하면
`sudo journalctl -u grafana-server | grep "no user found"`로 사용자 존재 여부를 먼저 확인한다.

## 관리자 계정 이름 변경

로그인 아이디를 `admin`에서 `orbit`으로 바꾼다 (HTTP API, `grafana-cli`에는 없음).

```bash
curl -s -u orbit:'<비밀번호>' http://localhost:3000/api/user   # id 확인 (최초엔 admin:'<비밀번호>'로 조회)
curl -s -u admin:'<비밀번호>' -X PUT -H "Content-Type: application/json" \
  -d '{"login":"orbit"}' http://localhost:3000/api/users/1
```

## 데이터소스 연결 (provisioning)

`grafana/provisioning/datasources/datasources.yaml`을 VM의 provisioning 경로에 복사하면,
재시작 시 Prometheus·Loki가 코드로 자동 연결된다(UI에서 수동으로 추가하지 않음).

Loki url은 `localhost`가 아니라 바인딩된 IP(`192.168.100.107`)를 쓴다 — `sudo ss -tlnp | grep loki`로
확인한 결과 Loki가 loopback이 아닌 이 IP에만 bind되어 있어, `localhost:3100`으로는 Grafana에서
연결되지 않는다.

```bash
sudo cp provisioning/datasources/datasources.yaml /etc/grafana/provisioning/datasources/datasources.yaml
sudo systemctl restart grafana-server
```

확인 (데이터소스 목록 + 각 데이터소스 실제 조회):

```bash
curl -s -u orbit:'<비밀번호>' http://localhost:3000/api/datasources | grep -o '"name":"[^"]*","uid":"[^"]*"'
# 위에서 얻은 uid로 실제 조회 (숫자 id 기반 /api/datasources/proxy/<id>/... 는 Grafana 13에서 404)
curl -s -u orbit:'<비밀번호>' "http://localhost:3000/api/datasources/proxy/uid/<prometheus-uid>/api/v1/query?query=up"
curl -s -u orbit:'<비밀번호>' "http://localhost:3000/api/datasources/proxy/uid/<loki-uid>/loki/api/v1/labels"
```

## 대시보드 구성 (provisioning)

`grafana/provisioning/dashboards/dashboards.yaml`(provider 설정)과 같은 디렉터리의
`load-recovery-experiment.json`(부하·복구 실험용 대시보드, orbit-observability#6)을
VM의 provisioning 경로에 함께 복사하면, 재시작 시 Grafana가 ORBIT 폴더 아래 대시보드를
코드로 자동 생성한다(UI에서 수동으로 Import하지 않음).

대시보드 JSON은 데이터소스를 `datasources.yaml`에 고정해 둔 `uid: prometheus`/`uid: loki`로
참조한다 — 데이터소스 provisioning이 먼저 적용돼 있어야 패널이 올바른 데이터소스에 붙는다.

```bash
sudo cp provisioning/dashboards/dashboards.yaml /etc/grafana/provisioning/dashboards/dashboards.yaml
sudo cp provisioning/dashboards/load-recovery-experiment.json /etc/grafana/provisioning/dashboards/load-recovery-experiment.json
sudo systemctl restart grafana-server
```

확인:

```bash
curl -s -u orbit:'<비밀번호>' http://localhost:3000/api/search?query=부하 | grep -o '"uid":"[^"]*"'
```

**이 세션에서는 검증 못함**: 이 작업 환경에서 모니터링 VM(192.168.100.107)으로의 네트워크·SSH·Tailscale
접근이 전혀 되지 않아(health 엔드포인트 curl 타임아웃, SSH 22번 포트 타임아웃, tailscale CLI 없음),
위 apply 절차와 패널 쿼리는 코드·문서 검토로만 작성했고 실제 VM에 적용해 패널에 데이터가 찍히는지는
확인하지 못했다. 또한 서버·CDN 패널은 orbit-gitops#10(PR #27)이 아직 머지 전이라 Alloy 자체가
배포되지 않은 상태라 데이터가 없는 게 정상이다 — VM·노드 패널(node_exporter)만 기존에 이미 동작 중이다.
VM 접근이 가능해지면 각 패널을 실제 쿼리 결과로 재검증해야 한다.

## 범위 밖

- Alertmanager 연동은 범위 밖이다.
