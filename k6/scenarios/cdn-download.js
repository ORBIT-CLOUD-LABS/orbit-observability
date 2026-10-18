// CDN 캐시·Edge 실험용 다운로드 부하 (ORBIT-CLOUD-LABS/orbit#24, #16). 차량이 매니페스트로 받은 Edge 주소에서 같은 파일을 받는다.
//
// k6 run -e ADMIN_TOKEN=... -e ENROLLMENT_KEY=... \
//   [-e STAGES=5:1m,20:3m] [-e FIRMWARE_SIZE_MB=10] [-e HASH_RATIO=0.05] k6/scenarios/cdn-download.js
//
// STAGES           목표 다운로드 요청률(요청/s):시간 목록. ramping-arrival-rate 로 직선으로 오르내린다 (server-hpa 와 같은 형식)
// FIRMWARE_SIZE_MB 시험 파일 크기. 크기마다 차종(K6-CDN-<N>MB)이 따로 있어 한 번 등록한 파일을 계속 쓴다
// HASH_RATIO       SHA-256 까지 검증할 요청 비율(0~1). 크기는 매번 검증하고, 해시는 k6 CPU 를 아끼려고 일부만 한다
// MAX_VUS          최대 VU. 다운로드가 느려지면 VU 가 모자라 dropped iterations 가 생긴다
//
// 결과 지표 (Prometheus 로 함께 보낸다):
//   cdn_requests{cache, edge}   Edge 응답 헤더 X-Cache-Status·X-Edge-ID 별 요청 수 (HIT/MISS 비율, Edge 별 분산)
//   cdn_bytes{cache, edge}      받은 byte
//   http_req_duration{name="download"}  다운로드 시간 (P95 등)
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { config } from '../lib/config.js';
import { prepareFixture, MODEL_PREFIX } from '../lib/fixture.js';
import { checkIn, getManifest } from '../lib/vehicle-api.js';
import { resolveDownloadUrl } from '../lib/cdn.js';

const SIZE_MB = positiveInt('FIRMWARE_SIZE_MB', 10);
const HASH_RATIO = ratio('HASH_RATIO', 0.05);
const MAX_VUS = positiveInt('MAX_VUS', 100);
const STAGES = parseStages(__ENV.STAGES || '5:1m,20:3m');
const MODEL = `${MODEL_PREFIX}CDN-${SIZE_MB}MB`;

const cdnRequests = new Counter('cdn_requests');
const cdnBytes = new Counter('cdn_bytes');

function positiveInt(name, fallback) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} 는 1 이상의 정수여야 한다: ${__ENV[name]}`);
  }
  return value;
}

function ratio(name, fallback) {
  const value = Number(__ENV[name] ?? fallback);
  if (Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${name} 는 0~1 이어야 한다: ${__ENV[name]}`);
  }
  return value;
}

function parseStages(text) {
  return text.split(',').map((item) => {
    const match = item.trim().match(/^(\d+):(\d+[smh])$/);
    if (!match) {
      throw new Error(`STAGES 형식은 <요청률>:<시간>(예: 20:2m) 목록이어야 한다: ${item}`);
    }
    return { target: Number(match[1]), duration: match[2] };
  });
}

export const options = {
  setupTimeout: '5m',
  // 다운로드 URL 에는 차량 ID 가 없지만 server-hpa 와 같은 기준으로 url tag 는 남기지 않는다.
  systemTags: ['status', 'method', 'name', 'group', 'check', 'error', 'error_code', 'scenario', 'expected_response'],
  tags: { run_id: config.runId, experiment: 'cdn-download' },
  scenarios: {
    downloads: {
      executor: 'ramping-arrival-rate',
      startRate: STAGES[0].target,
      timeUnit: '1s',
      stages: STAGES,
      preAllocatedVUs: Math.min(20, MAX_VUS),
      maxVUs: MAX_VUS,
    },
  },
  // 판정 기준이 아니다. 요약에 다운로드 지표를 따로 보이게 하기 위한 기준선이다.
  thresholds: {
    'http_req_duration{name:download}': ['p(95)<5000'],
    'http_req_failed{name:download}': ['rate<0.01'],
  },
};

// 차량 1대로 매니페스트를 받아 Edge 다운로드 주소·크기·해시를 정한다. 측정 대상(download)에서 빠진다.
export function setup() {
  const f = prepareFixture({ model: MODEL, vehicleCount: 1, firmwareSizeBytes: SIZE_MB * 1024 * 1024 });
  const vehicle = f.vehicles[0];
  const target = checkIn(vehicle, f.fromVersion);
  if (target.status !== 200 || target.json('updateTarget') !== true) {
    throw new Error(`체크인 실패 또는 업데이트 대상 아님: HTTP ${target.status} ${target.body}`);
  }
  const manifest = getManifest(vehicle, target.json('campaignId'));
  if (manifest.status !== 200) {
    throw new Error(`매니페스트 실패: HTTP ${manifest.status} ${manifest.body}`);
  }
  const m = manifest.json();
  const url = resolveDownloadUrl(m.downloadUrl);
  console.log(`run_id=${config.runId} model=${MODEL} url=${url} size=${m.fileSize} sha256=${m.sha256} `
    + `stages=${JSON.stringify(STAGES)}`);
  return { url, fileSize: m.fileSize, sha256: m.sha256 };
}

export default function (f) {
  const res = http.get(f.url, { responseType: 'binary', tags: { name: 'download' } });
  const cache = res.headers['X-Cache-Status'] || 'none';
  const edge = res.headers['X-Edge-Id'] || res.headers['X-Edge-ID'] || 'none';
  const size = res.body ? res.body.byteLength : 0;
  cdnRequests.add(1, { cache, edge });
  cdnBytes.add(size, { cache, edge });

  const checks = {
    'download 200': (r) => r.status === 200,
    '크기 일치': () => size === f.fileSize,
  };
  if (Math.random() < HASH_RATIO) {
    checks['해시 일치'] = (r) => Boolean(r.body) && crypto.sha256(r.body, 'hex') === f.sha256;
  }
  check(res, checks);
}
