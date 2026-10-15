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

## 범위 밖

- 대시보드 패널 구성은 별도 작업에서 다룬다 (orbit-observability#6).
- Alertmanager 연동은 범위 밖이다.
