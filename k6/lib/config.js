// k6 실행 설정. 모든 값은 `k6 run -e NAME=value` 로 받는다.
// 토큰은 기본값을 두지 않는다. 저장소에 남지 않도록 실행할 때만 넘긴다.

function required(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`환경 변수 ${name} 가 필요하다 (k6 run -e ${name}=...)`);
  }
  return value;
}

function optional(name, fallback) {
  return __ENV[name] || fallback;
}

function trimSlash(url) {
  return url.replace(/\/+$/, '');
}

export const config = Object.freeze({
  // 서버 NodePort (orbit docs/phase1.md §4)
  serverUrl: trimSlash(optional('SERVER_URL', 'http://192.168.100.102:30080')),
  // 매니페스트 downloadUrl 의 scheme·host·port 를 바꿀 주소. SSH 터널처럼 내부 IP 에 직접 닿지 않을 때만 쓴다.
  cdnUrlOverride: __ENV.CDN_URL ? trimSlash(__ENV.CDN_URL) : null,
  // 실행 구분값. smoke fixture 의 차종 이름에 붙는다.
  runId: optional('RUN_ID', `${Date.now()}`),
  adminToken: () => required('ADMIN_TOKEN'),
  enrollmentKey: () => required('ENROLLMENT_KEY'),
});
