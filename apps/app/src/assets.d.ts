/** 정적 이미지 에셋(png/jpg) import 타입 선언 — Metro 번들러가 모듈 ID(number)로 해석한다. */
declare module '*.png' {
  const value: number;
  export default value;
}
declare module '*.jpg' {
  const value: number;
  export default value;
}
