## Related Issue

Closes #

## Summary

<!--
무엇을, 왜 변경했는지 2~4개의 불릿으로 작성합니다.
구현 방법보다 수집 대상과 관측 결과의 변화를 우선 작성합니다.

필요한 경우 아래 항목을 추가합니다.
- Metrics: Prometheus scrape target, recording rule 또는 metric 변경
- Logs: Alloy 수집 경로, label 또는 Loki 전송 설정 변경
- Dashboard: Grafana dashboard 또는 data source 변경
- Alert: alert rule, 임계치 또는 알림 경로 변경
- Configuration Changes: port, endpoint, retention 또는 저장 경로 변경
-->

-

## Verification

<!--
실행한 검증과 결과를 작성합니다.

예:
- Prometheus Targets에서 대상이 UP 상태임을 확인
- Loki에서 특정 service label의 로그 조회 확인
- Grafana dashboard에서 변경한 panel의 데이터 표시 확인

관련 설정을 변경한 경우에만 설정 검사 명령이나 alert 발생 테스트를 추가합니다.
-->

-

- [ ] 변경한 설정의 형식과 서비스 시작을 확인했습니다.
- [ ] 변경한 metric 또는 log가 정상적으로 수집되는지 확인했습니다.
- [ ] Grafana에서 수집된 데이터를 조회했습니다.
- [ ] 기존 수집 대상과 dashboard에 영향을 주지 않는지 확인했습니다.
- [ ] 설정값이나 사용 방법이 변경됐다면 관련 문서를 수정했습니다.

<!--
## To Reviewer

label 설계, metric 의미, dashboard 해석, alert 임계치,
후속 작업 또는 알려진 제한 사항이 있을 때만 작성합니다.
-->