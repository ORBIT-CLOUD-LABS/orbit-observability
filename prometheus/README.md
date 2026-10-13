# Prometheus (systemd)

모니터링 VM(192.168.100.107)에 Docker Compose 없이 apt 패키지 + systemd로 직접 설치한다.
Loki도 같은 방식(systemd)으로 이미 구성되어 있다.

## 설치

```bash
sudo apt update
sudo apt install -y prometheus
```

## 배포

```bash
sudo cp prometheus.yml /etc/prometheus/prometheus.yml
sudo systemctl restart prometheus
sudo systemctl enable prometheus
curl -s http://localhost:9090/-/ready
```

## 수집 대상

- orbit-astra 7개 노드: node_exporter(9100), 고정 IP 192.168.100.100~107
  (`terraform/environments/astra/main.tf` 참고, node_exporter 자체는 orbit-infrastructure의
  `ansible/roles/node_exporter`로 각 노드에 배포한다)
- sol/terra/luna: Tailscale IP가 아직 확정되지 않아 미포함. IP가 정해지면
  `prometheus.yml`의 `node` job에 추가한다.
- OTA 앱: 아직 배포되지 않아 scrape job을 주석 처리해 두었다. 배포 후 실제 주소를
  확인하고 주석을 해제한다 (orbit-observability#3 작업 3번).

## 범위 밖

- Alertmanager, Grafana, Loki 연동은 별도 작업에서 다룬다.
- orbit-infrastructure의 Docker Compose 기반 `monitoring_host` 롤은 이 설정과
  중복되어 제거되었다 (orbit-infrastructure#35).
