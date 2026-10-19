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

**설정 경로를 먼저 확인한다.** Ubuntu 패키지(0.26.0)는 `--config.file`이
`/etc/prometheus/alertmanager.yml`이다 — `/etc/alertmanager/alertmanager.yml`에 복사하면
조용히 무시되고 패키지 기본 설정(`team-X-mails` → `localhost:25` 메일)이 그대로 돌아간다.

```bash
systemctl cat prometheus-alertmanager | grep -E 'ExecStart|EnvironmentFile'
cat /etc/default/prometheus-alertmanager      # ARGS 에 --config.file 이 있다
```

기본 설정을 한 번 백업해두고(`alertmanager.yml.bak`) 그 경로로 복사한다.
webhook URL 파일(`/etc/alertmanager/discord-webhook-url`)의 위치는 설정 안에 적힌 절대경로라
설정 파일이 어디에 있든 그대로 둔다.

## 적용 확인

```bash
# Prometheus가 Alertmanager를 인식했는지 (activeAlertmanagers에 9093이 보여야 한다)
curl -s http://localhost:9090/api/v1/alertmanagers | jq .

# 규칙이 로드됐는지 (groups: targets, kubernetes, orbit-server, nodes)
curl -s http://localhost:9090/api/v1/rules | jq -r '.data.groups[].name'

# Alertmanager가 받은 알림 (Watchdog는 항상 떠 있어야 한다)
curl -s http://localhost:9093/api/v2/alerts | jq -r '.[].labels.alertname'

# 로드된 설정이 이 저장소의 것인지 (경로를 잘못 짚으면 여기서 드러난다)
curl -s http://localhost:9093/api/v2/status | jq -r '.config.original'   | grep -E 'orbit-default|discord-webhook-url'
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

## 수신처 (디스코드)

디스코드 **`#orbit-알림`** 으로 통지한다 (orbit-observability#33 결정. 이전의 슬랙 `#5-alerts`
결정(#29)을 대체한다).

채널명을 아는 자리는 이 문서뿐이다. `alertmanager.yml` 의 `channel` 키는 디스코드가 무시해서
#33 에서 제거했고(적어 두면 틀린 정보만 남는다), 웹후크 URL 은 비밀값이라 커밋하지 않는다.
받는 채널은 웹후크를 만들 때 고정되므로 바꿀 때는 **웹후크를 다시 만든다** (아래 "전송 확인" 참고).

**설정 블록이 `slack_configs` 인 것은 오타가 아니다.** 디스코드 웹후크 URL 끝에 `/slack` 을 붙인
**슬랙 호환 엔드포인트**를 쓴다. 디스코드가 슬랙 payload 를 그대로 해석하므로
`slack_configs` + `api_url_file`(0.25+) 과 기존 `color`·`title`·`text` 템플릿을 그대로 쓸 수 있다.

네이티브 `discord_configs` 는 쓰지 않는다. 설치본 **0.26.0** 의 `discord_configs` 에는
`webhook_url` 만 있고 **`webhook_url_file` 이 없다** (`config/notifiers.go` 기준 **0.27.0 에서 추가**).
파일 참조가 안 되면 웹후크 URL 을 `alertmanager.yml` 에 인라인으로 적어야 해서 아래
"비밀값은 커밋하지 않는다" 와 충돌한다. 0.27+ 는 apt 에 없어 tarball + systemd unit 직접 작성이
되고, 그건 Prometheus·Loki·Grafana 와 같은 apt + systemd 설치 방식에서 벗어난다.

모니터링 VM 에서 디스코드로 나가는 egress 가 열려 있어야 한다.

```bash
curl -sS -o /dev/null -w '%{http_code}' https://discord.com/api/v10/gateway; echo
```

**비밀값(webhook URL)은 커밋하지 않는다.** VM 파일에만 두고 `api_url_file`(0.25+) 로 참조한다.

파일 소유자는 **Alertmanager 서비스 계정**이어야 한다. Alertmanager 는 root 가 아니라
`User=` 로 지정된 계정(Ubuntu 패키지는 `prometheus`)으로 돌기 때문에, `0600 root:root` 로
두면 통지 시점에 `open ...: permission denied` 로 실패한다. 설정 검증(`amtool check-config`)
으로는 안 잡히고 `journalctl` 에만 나온다.

```bash
# 디스코드: 서버 설정 → 연동 → 웹후크 → 새 웹후크 → 채널 선택 → 웹후크 URL 복사
# 복사한 URL 끝에 /slack 을 붙인 값을 저장한다
#   https://discord.com/api/webhooks/<id>/<token>/slack
AMUSER=$(systemctl show -p User --value prometheus-alertmanager); echo "${AMUSER:-root}"

sudo touch /etc/alertmanager/discord-webhook-url
sudo tee /etc/alertmanager/discord-webhook-url >/dev/null   # URL 붙여넣고 Enter, Ctrl-D
sudo chown "${AMUSER:-root}":"${AMUSER:-root}" /etc/alertmanager/discord-webhook-url
sudo chmod 0400 /etc/alertmanager/discord-webhook-url
sudo chmod 0755 /etc/alertmanager                         # 서비스 계정이 디렉터리에 들어갈 수 있어야 한다
sudo systemctl restart prometheus-alertmanager

# 슬랙에서 넘어온 뒤에는 옛 파일을 남기지 않는다
sudo rm -f /etc/alertmanager/slack-webhook-url
```

셸 히스토리에 URL 이 남지 않도록 `tee` 표준입력으로 붙여넣는다. 파일 끝의 개행은 Alertmanager
가 잘라내므로 문제되지 않는다.

전송 확인:

```bash
# webhook URL 이 살아있는지 + 어느 엔드포인트인지 (디스코드 채널에 "ping" 이 올라온다)
curl -sS -o /tmp/am-ping.out -w '%{http_code}' -H 'Content-Type: application/json' -d '{"text":"orbit alertmanager ping"}' "$(sudo cat /etc/alertmanager/discord-webhook-url)"; echo " $(cat /tmp/am-ping.out)"; rm -f /tmp/am-ping.out

# Alertmanager 가 실제로 보냈는지 (실패하면 여기 로그에 남는다)
journalctl -u prometheus-alertmanager -n 50 --no-pager | grep -i notify
```

**응답으로 엔드포인트 종류를 가린다.** 위 `curl` 이 `200 ok` 면 슬랙 호환 엔드포인트다
(URL 끝에 `/slack` 있음, 이게 맞는 상태). `204` + 빈 본문이면 일반 디스코드 웹후크라
`/slack` 이 빠진 것이다. `open ...: permission denied` 는 위의 소유자 문제, 401·404 는
웹후크가 지워졌거나 URL 이 틀린 것이다.

### `400 {"attachments": ["0"]}` — attachment 안의 URL 이 거부된 것이다

**두 번 밟은 함정이다** (2026-10-18 21:53, 2026-10-19 재현). 디스코드는 attachment 의 URL 필드를
검증하고 **호스트명에 TLD 가 없으면 거부한다.**

Alertmanager 는 `slack_configs` 의 `title_link` 를 기본 템플릿으로 채운다
(v0.26.0 `template/default.tmpl`): `slack.default.titlelink` → `__alertmanagerURL` →
`{{ .ExternalURL }}/#/alerts?receiver=...`. `--web.external-url` 을 주지 않으면 `.ExternalURL`
이 호스트명으로 채워져 `http://astra-monitoring:9093/#/alerts?receiver=orbit-default` 가 된다.

실제 웹후크로 확인한 결과:

| attachment 의 `title_link` | 응답 |
|---|---|
| `http://astra-monitoring:9093/#/alerts?receiver=orbit-default` | `400 {"attachments": ["0"]}` |
| `""` (빈값) | `200 ok` |
| `https://example.com/alerts` | `200 ok` |
| `http://192.168.100.107:9093/#/alerts` | `200 ok` |

그래서 `alertmanager.yml` 에 `title_link` 를 **IP 로 명시**한다 — 검증을 통과하면서 링크도
살아 있다. `--web.external-url` 을 주는 방법도 되지만 그건 `/etc/default/prometheus-alertmanager`
의 `ARGS` 라 **저장소 밖 상태**다. VM 을 다시 세우면서 빠뜨리면 이 400 이 조용히 돌아온다.

`title_link: ''` 로 비워도 통지는 간다 (링크를 버리는 선택).

이 실패는 `amtool check-config` 로 **안 잡힌다**. `journalctl` 에
`notify retry canceled due to unrecoverable error` 로만 나오고, `unrecoverable` 이라
재시도도 안 하므로 알림이 조용히 사라진다. 통지가 400 이면 **attachment 안의 URL 부터** 본다 —
`color`(`danger`/`good`)·`channel`·`username`·`fallback`·`mrkdwn_in`·빈 `text` 는 디스코드가
그대로 받는 것을 확인했다.

채널을 바꿀 때는 `alertmanager.yml` 이 아니라 **웹후크를 다시 만들어** 파일 내용을 교체한다.
디스코드 웹후크도 만들 때 고른 채널로 고정되고 payload 의 channel 은 무시한다.

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
