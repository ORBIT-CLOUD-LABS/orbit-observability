// 차량이 호출하는 서버 API (체크인·매니페스트). 부하 측정 대상이다.
// 응답 판정은 시나리오가 하도록 응답 객체를 그대로 돌려준다.
// URL 에 차량 ID 가 들어가므로 요청은 name tag 로 묶고, 시나리오는 systemTags 에서 url 을 빼야 한다.
import http from 'k6/http';
import { config } from './config.js';

const API = `${config.serverUrl}/api/v1/vehicles`;

function params(name, token) {
  return {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    tags: { name },
  };
}

function vehiclePath(vehicleId) {
  return `${API}/${encodeURIComponent(vehicleId)}`;
}

// lastUpdate 를 넘기면 업데이트 결과 보고를 함께 보낸다 ({ campaignId, result, failureReason, ... }).
export function checkIn(vehicle, currentVersion, lastUpdate) {
  const body = lastUpdate ? { currentVersion, lastUpdate } : { currentVersion };
  return http.post(`${vehiclePath(vehicle.vehicleId)}/check-in`, JSON.stringify(body),
    params('check-in', vehicle.token));
}

export function getManifest(vehicle, campaignId) {
  return http.get(`${vehiclePath(vehicle.vehicleId)}/campaigns/${campaignId}/manifest`,
    params('manifest', vehicle.token));
}
