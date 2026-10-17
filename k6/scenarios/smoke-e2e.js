// OTA 전체 흐름 smoke (ORBIT-CLOUD-LABS/orbit#37). 부하 실험이 아니라 클러스터 배포본이 끝까지 동작하는지 1회 확인한다.
// 흐름: 파일·캠페인·차량 준비 → 체크인 → 매니페스트 → Edge 다운로드(크기·해시) → 결과 보고 → 대상 해제 확인
//
// k6 run -e ADMIN_TOKEN=... -e ENROLLMENT_KEY=... [-e SERVER_URL=...] [-e CDN_URL=...] k6/scenarios/smoke-e2e.js
// 실행마다 K6-SMOKE-<RUN_ID> 차종이 새로 생긴다. 확인 후 k6/scripts/cleanup.sh 로 지운다.
import { check, fail } from 'k6';
import crypto from 'k6/crypto';
import { config } from '../lib/config.js';
import { prepareFixture, smokeModel } from '../lib/fixture.js';
import { checkIn, getManifest } from '../lib/vehicle-api.js';
import { download } from '../lib/cdn.js';

const FIRMWARE_SIZE_BYTES = Number(__ENV.FIRMWARE_SIZE_MB || 1) * 1024 * 1024;

export const options = {
  vus: 1,
  iterations: 1,
  setupTimeout: '2m',
  // URL 에 차량 ID 가 들어가므로 url tag 를 남기지 않는다.
  systemTags: ['status', 'method', 'name', 'group', 'check', 'error', 'error_code', 'scenario', 'expected_response'],
  // Prometheus 에서 실행을 구분하는 label. server-hpa 와 같은 이름을 써서 대시보드 run_id 변수로 고를 수 있게 한다.
  tags: { run_id: config.runId, experiment: 'smoke-e2e' },
  thresholds: {
    // 하나라도 실패하면 k6 가 0 이 아닌 코드로 끝난다.
    checks: ['rate==1'],
  },
};

export function setup() {
  const fixture = prepareFixture({
    model: smokeModel(config.runId),
    vehicleCount: 1,
    firmwareSizeBytes: FIRMWARE_SIZE_BYTES,
  });
  console.log(`fixture: model=${fixture.model} artifactId=${fixture.artifact.artifactId} campaignId=${fixture.campaignId}`);
  return fixture;
}

function step(name, res, checks) {
  const ok = check(res, checks, { step: name });
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${name}: HTTP ${res.status}${res.error ? ` (${res.error})` : ''}`);
  if (!ok) {
    fail(`${name} 실패: HTTP ${res.status} ${typeof res.body === 'string' ? res.body : ''}`);
  }
  return res;
}

export default function (f) {
  const vehicle = f.vehicles[0];
  const expectedPath = `/firmware/${f.model}/${f.targetVersion}/firmware.bin`;

  const target = step('체크인 (업데이트 대상 판정)', checkIn(vehicle, f.fromVersion), {
    'status 200': (r) => r.status === 200,
    '업데이트 대상': (r) => r.json('updateTarget') === true,
    '캠페인 일치': (r) => r.json('campaignId') === f.campaignId,
  });

  const manifest = step('매니페스트', getManifest(vehicle, target.json('campaignId')), {
    'status 200': (r) => r.status === 200,
    '목표 버전': (r) => r.json('targetVersion') === f.targetVersion,
    '해시 일치': (r) => r.json('sha256') === f.artifact.sha256,
    '크기 일치': (r) => r.json('fileSize') === f.artifact.fileSize,
    '파일 경로 규칙': (r) => String(r.json('downloadUrl')).endsWith(expectedPath),
  }).json();
  console.log(`downloadUrl: ${manifest.downloadUrl}`);

  const file = step('Edge 다운로드', download(manifest.downloadUrl), {
    'status 200': (r) => r.status === 200,
    '크기 일치': (r) => Boolean(r.body) && r.body.byteLength === manifest.fileSize,
    '해시 일치': (r) => Boolean(r.body) && crypto.sha256(r.body, 'hex') === manifest.sha256,
    'Edge 응답': (r) => Boolean(r.headers['X-Cache-Status']),
  });
  console.log(`edge: X-Edge-ID=${file.headers['X-Edge-Id'] || file.headers['X-Edge-ID']} X-Cache-Status=${file.headers['X-Cache-Status']}`);

  const report = { campaignId: f.campaignId, result: 'SUCCEEDED', finishedAt: new Date().toISOString() };
  step('결과 보고 후 체크인 (대상 해제)', checkIn(vehicle, f.targetVersion, report), {
    'status 200': (r) => r.status === 200,
    '업데이트 대상 아님': (r) => r.json('updateTarget') === false,
  });
}

export function teardown(f) {
  console.log(`정리 대상 차종: ${f.model} (k6/scripts/cleanup.sh ${f.model})`);
}
