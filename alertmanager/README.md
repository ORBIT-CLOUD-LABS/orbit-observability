# Alertmanager (systemd)

모니터링 VM(192.168.100.107:9093)에 Docker Compose 없이 apt 패키지 + systemd로 설치한다.
Prometheus·Loki·Grafana와 같은 방식이다.

Prometheus가 규칙을 평가해 알림을 만들고(`prometheus/rules/`), Alertmanager는 그 알림을
묶고(group)·억제하고(inhibit)·통지한다. 둘은 같은 VM 안에서 `localhost:9093`으로 통신한다.

## 설치

```bash
sudo apt update
sudo apt install -y prometheus-alertmanager
alertmanager --version   # Ubuntu 패키지 0.26.0 확인 (matchers 0.22+, api_url_file 0.25+)
```

## 배포

```bash
# Alertmanager 설정
sudo cp alertmanager.yml /etc/alertmanager/alertmanager.yml
sudo systemctl restart prometheus-alertmanager
sudo systemctl enable prometheus-alertmanager
curl -s http://localhost:9093/-/ready

# 알림 규칙 (Prometheus 쪽)
sudo mkdir -p /etc/prometheus/rules
sudo cp ../prometheus/rules/alerts.yml /etc/prometheus/rules/alerts.yml
sudo cp ../prometheus/prometheus.yml /etc/prometheus/prometheus.yml
sudo systemctl reload prometheus
```

패키지가 설치하는 설정 경로는 배포판에 따라 `/etc/prometheus/alertmanager.yml`일 수 있다.
`systemctl cat prometheus-alertmanager | grep config.file`로 실제 경로를 먼저 확인한다.

## 적용 확인

```bash
# Prometheus가 Alertmanager를 인식했는지 (activeAlertmanagers에 9093이 보여야 한다)
curl -s http://localhost:9090/api/v1/alertmanagers | jq .

# 규칙이 로드됐는지 (groups: targets, kubernetes, orbit-server, nodes)
curl -s http://localhost:9090/api/v1/rules | jq -r '.data.groups[].name'

# Alertmanager가 받은 알림 (Watchdog는 항상 떠 있어야 한다)
curl -s http://localhost:9093/api/v2/alerts | jq -r '.[].labels.alertname'
```

`Watchdog`이 보이지 않으면 Prometheus→Alertmanager 경로가 끊긴 것이다. 규칙 평가 자체는
`/api/v1/rules`의 `state`로, 전달 실패는 Prometheus 로그(`journalctl -u prometheus`)로 가른다.

## 검증 (설정을 바꿀 때마다)

```bash
promtool check config /etc/prometheus/prometheus.yml
promtool check rules /etc/prometheus/rules/alerts.yml
amtool check-config /etc/alertmanager/alertmanager.yml
```

`promtool`은 `prometheus` 패키지에, `amtool`은 `prometheus-alertmanager` 패키지에 들어 있다.

## 수신처 (슬랙 #5-alerts)

슬랙 `#5-alerts` 채널로 통지한다. 모니터링 VM 에서 외부 egress 가 열려 있는 것을 확인했다
(`https://slack.com` → 200).

**비밀값(webhook URL)은 커밋하지 않는다.** VM 파일에만 두고 `api_url_file`(0.25+) 로 참조한다.

```bash
# https://api.slack.com/apps → 해당 앱 → Incoming Webhooks → #5-alerts 용 URL 복사
sudo touch /etc/alertmanager/slack-webhook-url
sudo chown root:root /etc/alertmanager/slack-webhook-url
sudo chmod 0600 /etc/alertmanager/slack-webhook-url
sudo tee /etc/alertmanager/slack-webhook-url >/dev/null   # URL 붙여넣고 Enter, Ctrl-D
sudo systemctl restart prometheus-alertmanager
```

셸 히스토리에 URL 이 남지 않도록 `tee` 표준입력으로 붙여넣는다. 파일 끝의 개행은 Alertmanager
가 잘라내므로 문제되지 않는다.

전송 확인:

```bash
# webhook URL 자체가 살아있는지 (#5-alerts 에 "ping" 이 올라온다)
curl -sS -o /dev/null -w '%{http_code}
' -H 'Content-Type: application/json'   -d '{"text":"orbit alertmanager ping"}' "$(sudo cat /etc/alertmanager/slack-webhook-url)"

# Alertmanager 가 실제로 보냈는지 (실패하면 여기 로그에 남는다)
journalctl -u prometheus-alertmanager -n 50 --no-pager | grep -i notify
```

`invalid_token` 이나 404 가 오면 URL 이 폐기된 것이고, `channel_not_found` 는 앱이 그 채널에
초대되지 않은 것이다. Incoming Webhook 은 설치할 때 고른 채널로 고정되므로
`alertmanager.yml` 의 `channel` 값을 바꿔도 전송 대상은 바뀌지 않는다 — 기록용 값이다.

## 접근 범위 (ufw)

Prometheus→Alertmanager 는 같은 VM 의 루프백이라 그 경로에는 방화벽 규칙이 필요 없다.
UI·API 를 VM 밖에서 보기 위해 **Tailscale 출발지만** 허용한다 (orbit-observability#29 결정).
silence 조작이 가능한 엔드포인트라 Grafana(3000, 현재 Anywhere)보다 Prometheus(9090,
출발지 한정) 쪽 패턴을 따른다.

ASTRA 밖 장비는 subnet router 를 지나며 `192.168.100.1` 로 보인다 (`prometheus/README.md`).

```bash
sudo ufw allow from 192.168.100.1 to any port 9093 proto tcp comment "alertmanager UI via tailscale (orbit-observability#29)"
sudo ufw deny 9093/tcp
sudo ufw status numbered | grep 9093
```

9093 에는 기존 deny 규칙이 없어서(2026-10-19 `ufw status numbered` 확인) allow 를 먼저 추가하면
그 뒤에 deny 가 붙어 순서가 맞는다. 9090·9100 처럼 **이미 deny 가 있는 포트에 출발지를 추가할
때는** `ufw allow` 가 규칙을 맨 뒤에 붙여 deny 에 먼저 걸리므로 `ufw insert <deny 번호>` 를 써야 한다.

이 규칙의 코드화는 orbit-infrastructure#62 에서 다룬다.

## 발화 테스트

실제로 한 건 터뜨려 경로를 확인한다. 가장 안전한 방법은 수집 대상 하나를 잠깐 멈추는 것이다.

```bash
# node_exporter를 멈추면 10분 후 TargetDown이 발화한다 (for: 10m)
sudo systemctl stop prometheus-node-exporter
curl -s 'http://localhost:9090/api/v1/query?query=up==0' | jq -r '.data.result[].metric.instance'
# 발화 확인 후 되돌린다
sudo systemctl start prometheus-node-exporter
```

`for` 시간을 기다리지 않고 경로만 보려면 `amtool`로 알림을 직접 넣는다.

```bash
amtool alert add TestAlert severity=warning --alertmanager.url=http://localhost:9093 \
  --annotation=summary="경로 확인용 테스트"
amtool alert --alertmanager.url=http://localhost:9093
```

테스트 알림은 확인 후 silence하거나 `resolve_timeout`(5분)이 지나기를 기다린다.

## 임계값

`prometheus/rules/alerts.yml`의 임계값과 `for`는 1차 제안값이다. 실험 결과
(ORBIT-CLOUD-LABS/orbit#23)로 확정하기 전까지 확정값처럼 다루지 않는다.
알림별 대응 절차는 ORBIT-CLOUD-LABS/orbit#47에서 Runbook으로 작성한다.
