# 요구사항 참조

요구사항의 원본(source of truth)은 orbit 레포에 있다. 이 레포에 복사하지 않는다.

## 위치

| 항목 | 값 |
| --- | --- |
| 레포 | https://github.com/ORBIT-CLOUD-LABS/orbit |
| 경로 | `docs/` |

## 읽는 방법

1. 로컬 경로가 있으면 읽기 전에 `git -C ../orbit pull` 로 최신화한다.
2. 로컬에 없으면 GitHub 에서 읽는다.

   ```bash
   # 파일 목록
   gh api repos/ORBIT-CLOUD-LABS/orbit/contents/docs --jq '.[].name'
   # 파일 내용
   gh api repos/ORBIT-CLOUD-LABS/orbit/contents/docs/<파일명> -H 'Accept: application/vnd.github.raw'
   ```

3. 둘 다 안 되면 추측해서 작성하지 말고 사용자에게 요구사항을 요청한다.

## Phase1

Phase1 작업은 orbit `docs/phase1.md` 를 먼저 읽는다. 관측할 대상(OTA 서버, Origin·Edge, VM), 실험 완료 기준, 서버 메트릭 경로·포트 등 다른 저장소와 함께 쓰는 값이 이 문서에 있다.

- `phase1.md` 와 다른 문서(`infrastructure-plan.md`, `flow.md`)가 다르면 `phase1.md` 를 따른다.
- `phase1.md` 의 값이 **미확정**이면 그 값을 확정된 것처럼 설정에 고정하지 말고 사용자에게 확인한다.

## k6 부하 실험

실험 기준은 orbit Issue 에 있다. 서버 실험은 ORBIT-CLOUD-LABS/orbit#23, CDN 실험은 ORBIT-CLOUD-LABS/orbit#24 를 먼저 읽는다. API 요청·응답 형식은 orbit `docs/api.md` 와 orbit-server 코드를 따른다.

| 항목 | 기준 |
| --- | --- |
| 실행 위치 | ASTRA 밖 호스트에서 내부망 NodePort 로 호출 (서버 `30080`, Edge `30081`). ASTRA 안 VM 에서 실행하면 서버와 물리 CPU 를 나눠 써 결과가 왜곡된다 |
| 실험 분리 | 서버 부하와 CDN 부하를 동시에 실행하지 않는다. 실행 중에는 측정 대상의 이미지·설정을 바꾸지 않는다 |
| 서버 부하 대상 | 차량 API(체크인 → 매니페스트)만. 관리자 API(파일·캠페인 등록)와 차량 등록은 fixture 준비에만 쓰고 측정에서 제외한다 |
| fixture | 차종(model)은 `K6-` 로 시작한다. 부하 실험은 고정 fixture(`K6-LOAD`, 고정 차량 ID)를 재사용해 실행마다 DB 행 수가 달라지지 않게 한다. 부하 중에는 `lastUpdate` 를 보내지 않는다 |
| 차량 분리 | VU 마다 다른 차량을 쓴다. 같은 차량 행을 여러 VU 가 갱신하면 행 잠금이 병목이 된다 |
| tag | 요청은 `name` tag(`check-in`, `manifest` 등)로 묶는다. 차량 ID·토큰을 tag 나 URL label 로 남기지 않는다 |
| 결과 전송 | k6 지표는 Prometheus remote write(`http://192.168.100.107:9090/api/v1/write`)로 보낸다 |
| 결과 문서 | run ID 별 조건·원시 결과·판정은 orbit 레포에 남긴다 (Org CONTRIBUTING: 시험 결과는 orbit) |
| 정리 | 서버에 삭제 API 가 없으므로 `K6-` 데이터는 DB·NFS 에서 정리 스크립트로 지운다. 사람이 확인 후 직접 실행한다 |

## 규칙

- 설정을 작성하기 전에 관련 요구사항을 먼저 읽는다.
- 요구사항 문서는 읽기만 한다. orbit 레포를 수정하지 않는다.
- 요구사항이 모호하거나 실제 구성과 다르면 임의로 해석하지 말고 질문한다.
