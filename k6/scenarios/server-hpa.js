// orbit-server HPA·복구 실험용 부하 (ORBIT-CLOUD-LABS/orbit#23). 차량 API(체크인 → 매니페스트)만 측정한다.
//
// k6 run -e ADMIN_TOKEN=... -e ENROLLMENT_KEY=... \
//   [-e STAGES=10:1m,50:2m,100:3m,10:1m] [-e VEHICLES=100] [-e UPDATE_RATIO=0.1] k6/scenarios/server-hpa.js
//
// STAGES       목표 요청률(iteration/s):유지 시간 목록. ramping-arrival-rate 로 차례대로 이동한다.
// VEHICLES     등록할 차량 수 = 최대 VU 수. VU 하나가 차량 하나를 맡아 같은 차량 행을 동시에 갱신하지 않는다.
// UPDATE_RATIO 업데이트 대상 비율(0~1). 대상이면 체크인 뒤 매니페스트까지 호출하고, 아니면 체크인만 한다.
//
// fixture 는 K6-LOAD 를 재사용해 실행마다 DB 행 수가 달라지지 않게 한다. 부하 중에는 결과 보고(lastUpdate)를 보내지 않는다.
import { check } from 'k6';
import exec from 'k6/execution';
import { config } from '../lib/config.js';
import { prepareFixture, LOAD_MODEL } from '../lib/fixture.js';
import { checkIn, getManifest } from '../lib/vehicle-api.js';

const DEFAULT_STAGES = '10:1m,50:2m,100:3m,100:3m,10:2m';
const VEHICLES = positiveInt('VEHICLES', 100);
const UPDATE_RATIO = ratio('UPDATE_RATIO', 0.1);
const STAGES = parseStages(__ENV.STAGES || DEFAULT_STAGES);

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
      throw new Error(`STAGES 형식은 <요청률>:<시간>(예: 50:2m) 목록이어야 한다: ${item}`);
    }
    return { target: Number(match[1]), duration: match[2] };
  });
}

export const options = {
  setupTimeout: '5m',
  // URL 에 차량 ID 가 들어가므로 url tag 를 남기지 않는다.
  systemTags: ['status', 'method', 'name', 'group', 'check', 'error', 'error_code', 'scenario', 'expected_response'],
  // Prometheus 에서 실행을 구분하는 label. 값은 실행마다 하나라 시계열이 늘지 않는다.
  tags: { run_id: config.runId, experiment: 'server-hpa' },
  scenarios: {
    vehicles: {
      executor: 'ramping-arrival-rate',
      startRate: STAGES[0].target,
      timeUnit: '1s',
      stages: STAGES,
      preAllocatedVUs: VEHICLES,
      maxVUs: VEHICLES,
    },
  },
  // 판정 기준이 아니다. 요약에 name 별 값을 따로 보이게 하기 위한 기준선이며, 판정은 orbit#23 기준으로 한다.
  thresholds: {
    'http_req_duration{name:check-in}': ['p(95)<1000'],
    'http_req_duration{name:manifest}': ['p(95)<1000'],
    'http_req_failed{name:check-in}': ['rate<0.01'],
    'http_req_failed{name:manifest}': ['rate<0.01'],
    dropped_iterations: ['count==0'],
  },
};

export function setup() {
  const fixture = prepareFixture({ model: LOAD_MODEL, vehicleCount: VEHICLES, firmwareSizeBytes: 1024 * 1024 });
  console.log(`run_id=${config.runId} model=${fixture.model} campaignId=${fixture.campaignId} `
    + `vehicles=${fixture.vehicles.length} update_ratio=${UPDATE_RATIO} stages=${JSON.stringify(STAGES)}`);
  return fixture;
}

export default function (f) {
  const vehicle = f.vehicles[(exec.vu.idInTest - 1) % f.vehicles.length];
  const isTarget = Math.random() < UPDATE_RATIO;
  // 대상이 아닌 차량은 이미 목표 버전을 설치한 상태로 체크인한다.
  const res = checkIn(vehicle, isTarget ? f.fromVersion : f.targetVersion);
  const ok = check(res, {
    'check-in 200': (r) => r.status === 200,
    'check-in 대상 판정': (r) => r.status === 200 && r.json('updateTarget') === isTarget,
  });
  if (!ok || !isTarget) {
    return;
  }
  check(getManifest(vehicle, f.campaignId), {
    'manifest 200': (r) => r.status === 200,
  });
}
