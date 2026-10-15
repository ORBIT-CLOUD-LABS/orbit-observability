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

## 데이터소스 연결 (provisioning)

`grafana/provisioning/datasources/datasources.yaml`을 VM의 provisioning 경로에 복사하면,
재시작 시 Prometheus·Loki가 코드로 자동 연결된다(UI에서 수동으로 추가하지 않음).

```bash
sudo cp provisioning/datasources/datasources.yaml /etc/grafana/provisioning/datasources/datasources.yaml
sudo systemctl restart grafana-server
```

확인:

```bash
curl -s -u admin:'<비밀번호>' http://localhost:3000/api/datasources | grep -o '"name":"[^"]*"'
```

## 범위 밖

- 대시보드 패널 구성은 별도 작업에서 다룬다 (orbit-observability#6).
- Alertmanager 연동은 범위 밖이다.
