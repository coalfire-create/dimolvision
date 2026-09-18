#!/usr/bin/env node
/**
 * Expo 웹 export 후처리 — 빌드된 index.html 에 공유·검색용 메타 태그를 주입한다.
 *
 * Expo 가 만드는 index.html 은 title 과 favicon 만 담고 있어서, 링크를 공유하면
 * 미리보기 카드가 뜨지 않는다(카카오톡·슬랙·X 등). 일반 투표가 걸린 공모전에서는
 * 이게 그대로 클릭률 차이가 되므로 채워 넣는다.
 *
 * 이 앱은 expo-router 를 쓰지 않아 `app/+html.tsx` 로 head 를 커스터마이즈할 수 없다.
 * 그래서 빌드 산출물을 직접 손대는 방식이 가장 단순하고 확실하다.
 * 같은 파일에 두 번 돌려도 안전하다(주입 표식을 확인한다).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

const file = argv[2] ?? 'apps/app/dist/index.html';

const SITE_URL = 'https://dimolvision.vercel.app';
const TITLE = '디몰비전 — 철거 현장 사진 AI 분석';
const DESCRIPTION =
  '철거 현장 사진 한 장으로 구성 소재 식별, 권장 철거 공정, 석면 등 위험요소 경고, ' +
  '폐기물 물량 추정까지. 회원가입·로그인 없이 바로 체험하세요.';

const MARKER = '<!-- dimolvision:meta -->';

const META = `${MARKER}
    <meta name="description" content="${DESCRIPTION}" />
    <meta name="theme-color" content="#0F172A" />
    <link rel="canonical" href="${SITE_URL}/" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="디몰비전" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:url" content="${SITE_URL}/" />
    <meta property="og:title" content="${TITLE}" />
    <meta property="og:description" content="${DESCRIPTION}" />
    <meta property="og:image" content="${SITE_URL}/og-image.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="철거 현장 사진을 AI 로 분석하는 디몰비전 소개 이미지" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${TITLE}" />
    <meta name="twitter:description" content="${DESCRIPTION}" />
    <meta name="twitter:image" content="${SITE_URL}/og-image.jpg" />`;

let html = await readFile(file, 'utf8');

if (html.includes(MARKER)) {
  console.log(`[inject-meta] 이미 주입됨 — 건너뜀 (${file})`);
} else {
  // 한국어 서비스이므로 문서 언어를 ko 로 바로잡는다(스크린리더·검색 노출).
  html = html.replace('<html lang="en">', '<html lang="ko">');
  html = html.replace('</head>', `  ${META}\n  </head>`);
  await writeFile(file, html, 'utf8');
  console.log(`[inject-meta] 메타 태그 주입 완료 (${file})`);
}
