/**
 * 영업일 계산 유틸 (정산일 D+1 + 공휴일 순연에 사용).
 *
 * 날짜는 'YYYY-MM-DD'(KST 기준 날짜) 문자열로만 다룬다. 내부적으로 UTC 기준
 * Date로 파싱해 로컬 타임존 영향을 배제한다 — 서버 타임존과 무관하게 결정적이다.
 * 공휴일은 외부에서 주입(ReadonlySet)한다. 음력·대체공휴일은 매년 바뀌므로
 * 특일정보 API 등 권위 있는 소스에서 채운 셋을 넘겨야 한다. ([[korean-holidays]])
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDate(dateStr: string): Date {
  if (!DATE_RE.test(dateStr)) {
    throw new Error(`날짜는 YYYY-MM-DD 형식이어야 합니다: ${dateStr}`);
  }
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  // 2026-02-30 같은 존재하지 않는 날짜 거부 (롤오버 검증).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`유효하지 않은 날짜입니다: ${dateStr}`);
  }
  return dt;
}

function format(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addCalendarDays(dateStr: string, n: number): string {
  const dt = toUtcDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + n);
  return format(dt);
}

/** 토(6)·일(0) 여부. */
export function isWeekend(dateStr: string): boolean {
  const day = toUtcDate(dateStr).getUTCDay();
  return day === 0 || day === 6;
}

/** 주말도 공휴일도 아니면 영업일. */
export function isBusinessDay(dateStr: string, holidays: ReadonlySet<string> = new Set()): boolean {
  return !isWeekend(dateStr) && !holidays.has(dateStr);
}

/** 다음 영업일(입력일 다음날부터, 주말/공휴일을 건너뜀). */
export function nextBusinessDay(
  dateStr: string,
  holidays: ReadonlySet<string> = new Set(),
): string {
  let cur = addCalendarDays(dateStr, 1);
  while (!isBusinessDay(cur, holidays)) {
    cur = addCalendarDays(cur, 1);
  }
  return cur;
}

/**
 * 영업일 기준 n일 후. n=0이면 입력일 그대로 반환(영업일 여부 무관).
 * 정산일 계산에서 '처리완료일 + D영업일'을 구할 때 사용한다.
 */
export function addBusinessDays(
  dateStr: string,
  n: number,
  holidays: ReadonlySet<string> = new Set(),
): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`영업일 수는 0 이상의 정수여야 합니다: ${n}`);
  }
  let cur = dateStr;
  for (let i = 0; i < n; i += 1) {
    cur = nextBusinessDay(cur, holidays);
  }
  return cur;
}
