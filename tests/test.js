(() => {
  "use strict";

  const results = document.getElementById("results");
  let failures = 0;

  function test(name, callback) {
    const item = document.createElement("li");
    try {
      callback();
      item.textContent = `통과: ${name}`;
    } catch (error) {
      failures += 1;
      item.textContent = `실패: ${name} — ${error.message}`;
    }
    results.append(item);
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  test("사용자가 제공한 별 좌표 자료를 읽는다", () => {
    assert(STARS.length === 63, `별 개수: ${STARS.length}`);
    assert(STARS.some((star) => star[0] === "북극성"), "별 자료에서 북극성을 찾지 못했습니다.");
    assert(LINES.length === 38 && CONS.length === 28, "별자리 선 또는 별자리 목록의 수가 다릅니다.");
  });

  test("방위각 정규화 범위가 0° 이상 360° 미만이다", () => {
    assert(Astro.normalize(-90) === 270, "음수 방위각 처리 오류");
    assert(Astro.normalize(360) === 0, "360° 방위각 처리 오류");
  });

  test("한국 표준시 날짜 입력을 UTC 시각으로 변환한다", () => {
    const milliseconds = Astro.dateMilliseconds("2026-10-25", 1200);
    assert(new Date(milliseconds).toISOString() === "2026-10-25T11:00:00.000Z", "UTC+9 시각 변환 오류");
  });

  test("참고 시뮬레이터의 달 위치 검증값과 일치한다", () => {
    const moon = Astro.bodyAt("moon", Astro.dateMilliseconds("2026-10-25", 1200), 37.818, 127.062);
    assert(Math.abs(moon.apparentAltitude - 35.7) < 0.2, `달 고도: ${moon.apparentAltitude.toFixed(2)}°`);
    assert(Math.abs(moon.azimuth - 103.3) < 0.2, `달 방위각: ${moon.azimuth.toFixed(2)}°`);
  });

  test("태양과 행성 좌표 계산 결과가 유효 범위다", () => {
    const milliseconds = Astro.dateMilliseconds("2026-10-25", 1200);
    for (const id of ["sun", "saturn", "jupiter", "mars", "venus", "mercury"]) {
      const body = Astro.bodyAt(id, milliseconds, 37.818, 127.062);
      assert(body.azimuth >= 0 && body.azimuth < 360, `${id} 방위각 범위 오류`);
      assert(body.altitude >= -90 && body.altitude <= 90, `${id} 고도 범위 오류`);
    }
  });

  test("제공된 모든 별에서 수평 좌표를 계산한다", () => {
    const milliseconds = Astro.dateMilliseconds("2026-10-25", 1200);
    const positions = STARS.map((star) => Astro.starAt(star, milliseconds, 37.818, 127.062));
    assert(positions.length === STARS.length, "별 좌표 개수가 달라졌습니다.");
    assert(positions.every((position) => Number.isFinite(position.azimuth) && Number.isFinite(position.altitude)), "계산 결과에 유효하지 않은 위치가 있습니다.");
  });

  const summary = document.createElement("p");
  summary.textContent = failures === 0 ? "모든 검증을 통과했습니다." : `${failures}개 검증이 실패했습니다.`;
  document.body.append(summary);
})();
