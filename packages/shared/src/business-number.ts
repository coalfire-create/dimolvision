/**
 * 사업자등록번호(10자리) 정규화·검증·마스킹 유틸.
 *
 * 순수 함수만 모아 프론트(입력 즉시 형식 검증)와 백엔드(올바로 회원 검증 전
 * 사전 검증)에서 동일 로직을 공유한다. 실제 올바로 API 호출/회원 조회는 여기서
 * 하지 않는다 — 연동 코드는 apps/api 쪽에 두고 사람이 diff를 검토한다.
 */

/** 하이픈·공백 등을 제거하고 숫자만 남긴다. */
export function normalizeBusinessNumber(input: string): string {
  return input.replace(/\D/g, '');
}

/** 정규화 후 10자리 숫자인지(형식) 확인. */
export function isValidBusinessNumberFormat(input: string): boolean {
  return /^\d{10}$/.test(normalizeBusinessNumber(input));
}

/**
 * 국세청 사업자등록번호 체크섬 검증.
 * 가중치 [1,3,7,1,3,7,1,3,5]를 앞 9자리에 곱해 합산하고, 9번째 자리에는
 * (자릿수*5)의 십의 자리를 더한 뒤 (10 - 합%10)%10 이 마지막 자리와 같아야 유효.
 */
export function isValidBusinessNumberChecksum(input: string): boolean {
  const digits = normalizeBusinessNumber(input);
  if (!/^\d{10}$/.test(digits)) {
    return false;
  }

  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const nums = digits.split('').map(Number);

  let sum = weights.reduce((acc, w, i) => acc + w * (nums[i] ?? 0), 0);
  sum += Math.floor(((nums[8] ?? 0) * 5) / 10);

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === nums[9];
}

/** 형식 + 체크섬 모두 통과해야 유효한 사업자등록번호. */
export function isValidBusinessNumber(input: string): boolean {
  return isValidBusinessNumberFormat(input) && isValidBusinessNumberChecksum(input);
}

/** 표준 표기(123-45-67890). 형식이 아니면 정규화 문자열을 그대로 반환. */
export function formatBusinessNumber(input: string): string {
  const d = normalizeBusinessNumber(input);
  if (!/^\d{10}$/.test(d)) {
    return d;
  }
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/**
 * 로그·화면 노출용 마스킹. 뒤 5자리를 가린다 (예: 123-45-*****).
 * CLAUDE.md 절대 규칙 — 사업자등록번호 등 PII는 로그에 평문으로 남기지 않는다.
 */
export function maskBusinessNumber(input: string): string {
  const d = normalizeBusinessNumber(input);
  if (!/^\d{10}$/.test(d)) {
    return '***';
  }
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-*****`;
}
