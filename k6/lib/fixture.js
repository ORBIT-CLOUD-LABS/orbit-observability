// 시험 데이터(fixture) 준비. setup() 에서만 호출하고 측정 대상에서 제외한다.
// 서버에 삭제 API 가 없으므로 이미 있으면 재사용하고, 남은 데이터는 k6/scripts/cleanup.sh 로 지운다.
import http from 'k6/http';
import crypto from 'k6/crypto';
import { config } from './config.js';

// k6 가 만드는 차종은 모두 이 접두어로 시작한다 (cleanup.sh 의 삭제 조건).
export const MODEL_PREFIX = 'K6-';
// 부하 실험은 실행마다 DB 행 수가 달라지지 않도록 이 차종을 계속 재사용한다.
export const LOAD_MODEL = `${MODEL_PREFIX}LOAD`;
export const FROM_VERSION = '1.0.0';
export const TARGET_VERSION = '2.0.0';

const HW_VERSION = 'K6-HW1';
const REGION = 'K6';
const CAMPAIGN_DAYS = 30;
const API = `${config.serverUrl}/api/v1`;
const FIXTURE_TAG = 'fixture';

export function smokeModel(runId) {
  return `${MODEL_PREFIX}SMOKE-${runId}`;
}

export function vehicleIds(model, count) {
  return Array.from({ length: count }, (_, i) => `${model.toLowerCase()}-${String(i + 1).padStart(4, '0')}`);
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function params(name, token, extraHeaders = {}) {
  return {
    headers: { ...bearer(token), ...extraHeaders },
    tags: { name: `${FIXTURE_TAG}:${name}`, phase: FIXTURE_TAG },
  };
}

function expectJson(res, statuses, action) {
  if (!statuses.includes(res.status)) {
    throw new Error(`${action} 실패: HTTP ${res.status} ${res.body}`);
  }
  return res.json();
}

function findArtifact(model, version) {
  const res = http.get(`${API}/admin/artifacts?model=${encodeURIComponent(model)}`,
    params('artifact-list', config.adminToken()));
  const found = expectJson(res, [200], '파일 목록 조회').artifacts.find((a) => a.version === version);
  return found ? { artifactId: found.artifactId, sha256: found.sha256, fileSize: found.fileSize } : null;
}

function registerArtifact(model, version, sizeBytes) {
  const data = crypto.randomBytes(sizeBytes);
  const body = {
    file: http.file(data, 'firmware.bin', 'application/octet-stream'),
    model,
    version,
    sha256: crypto.sha256(data, 'hex'),
  };
  const res = http.post(`${API}/admin/artifacts`, body, params('artifact-register', config.adminToken()));
  const created = expectJson(res, [201], '파일 등록');
  return { artifactId: created.artifactId, sha256: created.sha256, fileSize: created.fileSize };
}

function findActiveCampaign(model, targetVersion) {
  const res = http.get(`${API}/admin/campaigns?status=ACTIVE&model=${encodeURIComponent(model)}`,
    params('campaign-list', config.adminToken()));
  const found = expectJson(res, [200], '캠페인 목록 조회').campaigns.find((c) => c.targetVersion === targetVersion);
  return found ? found.campaignId : null;
}

function registerCampaign(model, artifactId, targetVersion) {
  const now = Date.now();
  const body = {
    name: `k6 ${model}`,
    artifactId,
    targetVersion,
    target: {
      model,
      hwVersions: [HW_VERSION],
      regions: [REGION],
      currentVersionMin: FROM_VERSION,
      currentVersionMax: FROM_VERSION,
    },
    startAt: new Date(now - 60 * 1000).toISOString(),
    endAt: new Date(now + CAMPAIGN_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
  const res = http.post(`${API}/admin/campaigns`, JSON.stringify(body),
    params('campaign-register', config.adminToken(), { 'Content-Type': 'application/json' }));
  return expectJson(res, [201], '캠페인 등록').campaignId;
}

// 재등록은 200 과 함께 새 토큰을 발급하므로 같은 차량 ID 를 계속 써도 행이 늘지 않는다.
function registerVehicle(model, vehicleId) {
  const body = { vehicleId, model, hwVersion: HW_VERSION, region: REGION, currentVersion: FROM_VERSION };
  const res = http.post(`${API}/vehicles/register`, JSON.stringify(body),
    params('vehicle-register', config.enrollmentKey(), { 'Content-Type': 'application/json' }));
  const registered = expectJson(res, [200, 201], `차량 등록(${vehicleId})`);
  return { vehicleId: registered.vehicleId, token: registered.vehicleToken };
}

// model 의 파일·캠페인이 있으면 재사용하고 없으면 만든 뒤, vehicleCount 대의 차량을 등록한다.
export function prepareFixture({ model, vehicleCount, firmwareSizeBytes }) {
  if (!model.startsWith(MODEL_PREFIX)) {
    throw new Error(`fixture 차종은 ${MODEL_PREFIX} 로 시작해야 한다: ${model}`);
  }
  const artifact = findArtifact(model, TARGET_VERSION)
    || registerArtifact(model, TARGET_VERSION, firmwareSizeBytes);
  const campaignId = findActiveCampaign(model, TARGET_VERSION)
    || registerCampaign(model, artifact.artifactId, TARGET_VERSION);
  const vehicles = vehicleIds(model, vehicleCount).map((id) => registerVehicle(model, id));
  return { model, fromVersion: FROM_VERSION, targetVersion: TARGET_VERSION, artifact, campaignId, vehicles };
}
