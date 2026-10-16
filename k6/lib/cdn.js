// CDN Edge 에서 펌웨어를 받는다. 매니페스트의 downloadUrl 을 그대로 쓰고,
// CDN_URL 이 주어지면 scheme·host·port 만 바꾼다 (SSH 터널처럼 내부 IP 에 직접 닿지 않을 때).
import http from 'k6/http';
import { config } from './config.js';

const ORIGIN_PATTERN = /^https?:\/\/[^/]+/;

export function resolveDownloadUrl(downloadUrl) {
  if (!config.cdnUrlOverride) {
    return downloadUrl;
  }
  if (!ORIGIN_PATTERN.test(downloadUrl)) {
    throw new Error(`downloadUrl 형식이 아니다: ${downloadUrl}`);
  }
  return downloadUrl.replace(ORIGIN_PATTERN, config.cdnUrlOverride);
}

// 본문 해시를 검증할 수 있도록 binary 로 받는다. Edge 응답 헤더(X-Cache-Status, X-Edge-ID)는 res.headers 에 있다.
export function download(downloadUrl) {
  return http.get(resolveDownloadUrl(downloadUrl), {
    responseType: 'binary',
    tags: { name: 'download' },
  });
}
