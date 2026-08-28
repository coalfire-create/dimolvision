import { createApp } from '../apps/api/dist/app.js';

/**
 * Vercel 서버리스 진입점 — 디몰비전 Express API 를 그대로 서빙한다.
 * `api/[...slug]` 캐치올이라 `/api/*` 전 경로가 이 함수로 들어오고, Express 가 라우팅한다.
 */
export default createApp();
