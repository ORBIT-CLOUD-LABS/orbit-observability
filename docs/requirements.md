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

## 규칙

- 설정을 작성하기 전에 관련 요구사항을 먼저 읽는다.
- 요구사항 문서는 읽기만 한다. orbit 레포를 수정하지 않는다.
- 요구사항이 모호하거나 실제 구성과 다르면 임의로 해석하지 말고 질문한다.
