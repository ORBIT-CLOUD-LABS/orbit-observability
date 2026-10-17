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

## Remote write 수신 (Alloy)

클러스터 안 Alloy가 `remote_write`로 보낸 메트릭을 받으려면 수신 기능을 켜야 한다. 기본은 꺼져 있고(`/etc/default/prometheus`의 `ARGS=""`), 이 상태에서는 orbit-gitops#10의 Alloy remote write가 모두 실패한다.

```bash
sudo sed -i 's|^ARGS=.*|ARGS="--web.enable-remote-write-receiver --storage.tsdb.retention.time=15d"|' /etc/default/prometheus
sudo systemctl restart prometheus
curl -s http://localhost:9090/api/v1/status/flags | grep -i remote-write
```

9090은 실제로 remote write를 보내는 출발지에서만 열어둔다. Alloy는 k8s 노드 4대(Pod 트래픽은 node IP로 SNAT되어 나간다), k6는 실행하는 위치마다 추가한다(`k6/README.md` 실행 위치). 현재 허용한 k6 출발지는 `192.168.100.1` 하나다. ASTRA 호스트 자신과, Tailscale 로 들어오는 ASTRA 밖 장비(ASTRA 가 서브넷 라우터로 출발지를 자기 주소로 바꿔 보낸다)가 모두 이 주소로 보인다(2026-10-17 개인 Mac 에서 허용 전 연결 불가 → 허용 후 `/-/ready` 200 확인). LAN 으로 직접 연결되는 장비는 그 주소를 따로 추가한다.

```bash
sudo apt install -y ufw   # 이미 설치돼 있으면 건너뜀
sudo ufw allow from 192.168.100.101 to any port 9090 proto tcp  # astra-control-plane
sudo ufw allow from 192.168.100.102 to any port 9090 proto tcp  # astra-worker-1
sudo ufw allow from 192.168.100.103 to any port 9090 proto tcp  # astra-worker-2
sudo ufw allow from 192.168.100.104 to any port 9090 proto tcp  # astra-worker-3
sudo ufw allow from 192.168.100.1 to any port 9090 proto tcp comment "astra-host k6 remote write (orbit#23)"  # ASTRA 호스트 (k6)
sudo ufw deny 9090/tcp
```

이미 deny 규칙이 있는 VM에 허용 출발지를 추가할 때는 `ufw allow`가 규칙을 맨 뒤에 붙여 deny에 먼저 걸린다. `sudo ufw status numbered`로 `9090/tcp DENY` 의 번호를 확인한 뒤 그 번호로 끼워 넣는다(2026-10-17 k6 출발지 추가 시 7번).

```bash
sudo ufw insert 7 allow from 192.168.100.1 to any port 9090 proto tcp comment "astra-host k6 remote write (orbit#23)"
```

allow 규칙을 deny보다 먼저 추가해야 순서대로 평가되어 허용 출발지가 막히지 않는다(orbit-infrastructure#45 트러블슈팅 참고). `ufw enable` 자체는 SSH·k8s 포트 allowlist 정리 후 별도로 진행한다(orbit-infrastructure#51).

Alloy가 아직 배포되지 않아(orbit-gitops#10 선행 조건) 실제 ingest 확인은 그 배포 후에 진행한다. 지금은 수신 기능이 켜졌는지만 위 `status/flags` 응답으로 확인한다.

## 보존 기간

실험 기간(서버·CDN 부하 실험 수 주)과 모니터링 VM data disk(20GiB)를 감안해 15일로 설정한다(`--storage.tsdb.retention.time=15d`, 위 Remote write 절의 `ARGS`에 포함). 적용 후 디스크 사용량을 주기적으로 확인한다.

```bash
df -h /var/lib/prometheus
du -sh /var/lib/prometheus/metrics2 2>/dev/null
```

## 수집 간격

node job은 HPA scale-out/in 시점을 놓치지 않도록 global(15s)보다 촘촘한 `5s`로 설정했다(`prometheus.yml`의 `node` job `scrape_interval`). 자기 자신(prometheus job)은 global 15s를 그대로 쓴다.

## 수집 대상

- ASTRA 호스트 + orbit-astra 7개 노드: node_exporter(9100), 고정 IP 192.168.100.1·100~107
  (`terraform/environments/astra/main.tf` 참고, node_exporter 자체는 orbit-infrastructure의
  `ansible/roles/node_exporter`로 각 노드에 배포한다. 대상 목록은 orbit-infrastructure#45에서 전달됨)
- sol/terra/luna: Tailscale IP가 아직 확정되지 않아 미포함. IP가 정해지면
  `prometheus.yml`의 `node` job에 추가한다.
- OTA 앱: 아직 배포되지 않아 scrape job을 주석 처리해 두었다. 배포 후 실제 주소를
  확인하고 주석을 해제한다 (orbit-observability#3 작업 3번).
- 클러스터 안 Pod·kubelet(cAdvisor)·kube-state-metrics: 직접 scrape하지 않고 Alloy가
  remote_write로 보낸다 (위 Remote write 수신 절, orbit-gitops#10).

## label 중복 (node_exporter ↔ cAdvisor)

worker 노드는 node_exporter(이 job)와 클러스터 안 cAdvisor가 같은 노드를 다른 경로로 중복 수집한다.
`k8s_worker`·`k8s_control_plane`가 `--node-name={{ inventory_hostname }}`로 Kubernetes Node 이름을
node_exporter 호스트명과 일치시켜두었으므로(orbit-infrastructure#45), Alloy 쪽 relabel에서 해당 Node
이름 label을 그대로 쓰면 instance 표기가 겹치지 않는다. 실제 중복 여부 확인은 Alloy 배포 후(orbit-gitops#10) 진행한다.

## 범위 밖

- Alertmanager 연동은 별도 작업에서 다룬다.
- orbit-infrastructure의 Docker Compose 기반 `monitoring_host` 롤은 이 설정과
  중복되어 제거되었다 (orbit-infrastructure#35).
- Grafana 대시보드 패널 구성은 별도 작업에서 다룬다 (orbit-observability#6). 이 PR은 서비스 기동과
  데이터소스 연결까지만 다룬다.
