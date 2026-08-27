/**
 * 한국 공휴일 셋 빌더 (정산일 공휴일 순연에 사용).
 *
 * ⚠️ 아래는 매년 날짜가 고정인 '양력' 공휴일만 포함한다. 음력 공휴일(설날·추석·
 *   부처님오신날)과 대체공휴일은 해마다 날짜가 바뀌므로 여기서 하드코딩하지 않는다.
 *   반드시 공공데이터포털 '특일정보'(한국천문연구원) API 등 권위 있는 소스에서 받은
 *   날짜를 `extraHolidays`로 주입해야 한다. 이 값이 틀리면 정산일이 틀어지는
 *   금전 사고로 이어지므로, 운영 반영 전 반드시 실제 공휴일 데이터로 검증한다.
 */

/** 매년 고정(양력) 공휴일. 'MM-DD'. */
export const FIXED_SOLAR_HOLIDAYS: readonly string[] = [
  '01-01', // 신정
  '03-01', // 삼일절
  '05-05', // 어린이날
  '06-06', // 현충일
  '08-15', // 광복절
  '10-03', // 개천절
  '10-09', // 한글날
  '12-25', // 성탄절
];

/** 특정 연도의 고정 공휴일을 'YYYY-MM-DD'로. */
export function solarHolidaysForYear(year: number): string[] {
  return FIXED_SOLAR_HOLIDAYS.map((md) => `${year}-${md}`);
}

/**
 * 정산일 계산에 넘길 공휴일 셋을 만든다.
 * @param years 대상 연도들 (고정 공휴일 자동 포함)
 * @param extraHolidays 음력·대체공휴일 등 외부(특일정보 API)에서 받은 'YYYY-MM-DD'
 */
export function buildKoreanHolidaySet(
  years: number[],
  extraHolidays: string[] = [],
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const y of years) {
    for (const d of solarHolidaysForYear(y)) {
      set.add(d);
    }
  }
  for (const d of extraHolidays) {
    set.add(d);
  }
  return set;
}
