(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KST = 9 * 60 * 60 * 1000;
  const MAGNETIC_DECLINATION = 8.5;
  const BODIES = [
    { id: "moon", name: "달", color: "--c-moon" },
    { id: "saturn", name: "토성", color: "--c-saturn" },
    { id: "jupiter", name: "목성", color: "--c-jupiter" },
    { id: "mars", name: "화성", color: "--c-mars" },
    { id: "venus", name: "금성", color: "--c-venus" },
    { id: "mercury", name: "수성", color: "--c-mercury" }
  ];
  const BODY_NAMES = Object.fromEntries(BODIES.map((body) => [body.id, body.name]));
  const DIRECTIONS = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"];
  const STATE_KEY = "night-sky-sim-state-v2";
  const RECORD_KEY = "night-sky-sim-observations-v1";
  const canvas = $("sky");
  const context = canvas.getContext("2d");
  const state = {
    date: "2026-10-25",
    minute: 1200,
    latitude: 37.818,
    longitude: 127.062,
    place: "양주 덕계동",
    view: "dome",
    selected: "moon",
    sky: "suburb",
    lines: true,
    names: true,
    constellations: true
  };
  const ar = {
    fov: 70, azimuth: 150, altitude: 35,
    forward: null, up: null, right: null,
    sensor: false, gotReading: false, sampled: false, offset: 0, pending: false
  };
  const SKY_BASE = { city: 4, suburb: 5, rural: 6.2 };
  const MOON_SCALE = { city: 0.55, suburb: 0.85, rural: 1 };
  let width = 0;
  let height = 0;
  let hits = [];
  let playTimer = null;
  let dragPoint = null;
  let panoramaCenter = 150;
  let records = readStorage(RECORD_KEY, []);

  function readStorage(key, fallback) {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : fallback;
    } catch (error) {
      console.error(`저장된 설정을 읽지 못했습니다 (${key}).`, error);
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`설정을 저장하지 못했습니다 (${key}).`, error);
      return false;
    }
    return true;
  }

  function formatMinute(minute) {
    const rounded = Math.round(minute);
    const hour = Math.floor(rounded / 60) % 24;
    const minutes = rounded % 60;
    return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function formatAngle(value, digits = 1) {
    return Number.isFinite(value) ? `${value.toFixed(digits)}°` : "—";
  }

  function directionName(azimuth) {
    return DIRECTIONS[Math.round(((azimuth % 360) + 360) % 360 / 22.5) % 16];
  }

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function timeAt(minute = state.minute, date = state.date) {
    return Astro.dateMilliseconds(date, minute);
  }

  function getPosition(id, minute = state.minute, date = state.date) {
    return Astro.bodyAt(id, timeAt(minute, date), state.latitude, state.longitude);
  }

  function apparentStar(star, minute = state.minute, date = state.date) {
    return Astro.starAt(star, timeAt(minute, date), state.latitude, state.longitude);
  }

  function updateCanvasSize() {
    if (!canvas || !canvas.parentElement) return;
    const availableWidth = canvas.parentElement.clientWidth;
    const screenHeight = window.innerHeight || 700;
    const logicalHeight = state.view === "dome"
      ? Math.min(availableWidth, 760)
      : state.view === "ar"
        ? Math.round(Math.min(availableWidth * 1.25, Math.max(320, screenHeight * 0.72)))
        : Math.round(availableWidth * 0.56);
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.style.height = `${logicalHeight}px`;
    canvas.width = Math.round(availableWidth * pixelRatio);
    canvas.height = Math.round(logicalHeight * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    width = availableWidth;
    height = logicalHeight;
  }

  const rev = Astro.normalize;
  const rad = (degrees) => degrees * Math.PI / 180;
  const enu = (altitude, azimuth) => [Math.cos(rad(altitude)) * Math.sin(rad(azimuth)), Math.cos(rad(altitude)) * Math.cos(rad(azimuth)), Math.sin(rad(altitude))];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalizeVector = (vector) => {
    const length = Math.hypot(...vector) || 1;
    return vector.map((value) => value / length);
  };

  function setManualDirection() {
    ar.forward = enu(ar.altitude, ar.azimuth);
    ar.right = [Math.cos(rad(ar.azimuth)), -Math.sin(rad(ar.azimuth)), 0];
    ar.up = cross(ar.right, ar.forward);
  }

  function arCenter() {
    return {
      altitude: Math.asin(Math.max(-1, Math.min(1, ar.forward[2]))) * 180 / Math.PI,
      azimuth: rev(Math.atan2(ar.forward[0], ar.forward[1]) * 180 / Math.PI)
    };
  }

  function project(altitude, azimuth) {
    if (state.view === "ar") {
      const direction = enu(altitude, azimuth);
      const depth = dot(direction, ar.forward);
      if (depth <= 0.08) return { x: -9999, y: -9999, visible: false };
      const focalLength = (width / 2) / Math.tan(rad(ar.fov / 2));
      const x = width / 2 + focalLength * dot(direction, ar.right) / depth;
      const y = height / 2 - focalLength * dot(direction, ar.up) / depth;
      return { x, y, visible: x > -width && x < 2 * width && y > -height && y < 2 * height };
    }
    if (state.view === "dome") {
      const radius = Math.min(width, height) / 2 - 26;
      const pointRadius = radius * (90 - altitude) / 90;
      return { x: width / 2 - pointRadius * Math.sin(rad(azimuth)), y: height / 2 - pointRadius * Math.cos(rad(azimuth)), visible: altitude >= -2 };
    }
    const span = 140;
    const delta = ((azimuth - panoramaCenter + 540) % 360) - 180;
    const ground = height - 34;
    return { x: width / 2 + delta / span * width, y: ground - altitude / 80 * (ground - 14), visible: Math.abs(delta) <= span / 2 + 6 && altitude >= -2 };
  }

  function angularSeparation(altA, azA, altB, azB) {
    const cosine = Math.sin(rad(altA)) * Math.sin(rad(altB)) + Math.cos(rad(altA)) * Math.cos(rad(altB)) * Math.cos(rad(azA - azB));
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  }

  function skyBrightness(minute = state.minute, options = {}) {
    const sun = getPosition("sun", minute);
    const moon = getPosition("moon", minute);
    const base = SKY_BASE[state.sky];
    let twilight = 0;
    if (sun.altitude > -18) twilight = sun.altitude >= -6 ? base - 1 : (base - 1) * ((sun.altitude + 18) / 12) ** 1.6;
    let moonlight = 0;
    if (!options.withoutMoon && moon.altitude > 0) {
      moonlight = 1.9 * moon.illumination ** 1.5 * (0.35 + 0.65 * Math.sin(rad(moon.altitude))) * MOON_SCALE[state.sky];
    }
    return { limit: Math.max(0.5, base - Math.max(twilight, 0) - moonlight), base, twilight: Math.max(twilight, 0), moonlight, sun, moon };
  }

  function estimatedStarCount(limitMagnitude) {
    const table = [[-1, 2], [0, 4], [1, 15], [2, 48], [3, 171], [4, 513], [5, 1602], [6, 4800], [6.5, 8500]];
    let count = 2;
    for (let index = 1; index < table.length; index += 1) {
      if (limitMagnitude <= table[index][0]) {
        const [lowMag, lowCount] = table[index - 1];
        const [highMag, highCount] = table[index];
        count = Math.exp(Math.log(lowCount) + (Math.log(highCount) - Math.log(lowCount)) * (limitMagnitude - lowMag) / (highMag - lowMag));
        break;
      }
      count = table[index][1];
    }
    return Math.round(count * 0.5 * 0.62);
  }

  function airExtinction(altitude) {
    if (altitude <= 0) return 9;
    return 0.25 * (Math.min(1 / Math.sin(rad(Math.max(altitude, 3))), 19) - 1);
  }

  function drawLabel(text, x, y, color, bold = false) {
    context.font = `${bold ? "600 " : ""}12px "Pretendard", "Malgun Gothic", sans-serif`;
    context.fillStyle = color;
    context.textBaseline = "middle";
    context.fillText(text, x, y);
  }

  function drawMoon(point, moon, sun, radius) {
    const moonVector = enu(moon.altitude, moon.azimuth);
    const sunVector = enu(sun.altitude, sun.azimuth);
    const projection = dot(moonVector, sunVector);
    const tangent = normalizeVector(sunVector.map((value, index) => value - projection * moonVector[index]));
    const litPoint = normalizeVector(moonVector.map((value, index) => value + 0.05 * tangent[index]));
    const litAltitude = Math.asin(litPoint[2]) * 180 / Math.PI;
    const litAzimuth = rev(Math.atan2(litPoint[0], litPoint[1]) * 180 / Math.PI);
    const projectedLitPoint = project(litAltitude, litAzimuth);
    const angle = Math.atan2(projectedLitPoint.y - point.y, projectedLitPoint.x - point.x);
    const illumination = moon.illumination;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(angle);
    context.fillStyle = css("--panel2");
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = css("--c-moon");
    context.beginPath();
    context.moveTo(0, -radius);
    context.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
    for (let index = 0; index <= 40; index += 1) {
      const phase = Math.PI / 2 - Math.PI * index / 40;
      context.lineTo(radius * (1 - 2 * illumination) * Math.cos(phase), radius * Math.sin(phase));
    }
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawObjects(sun, moon, brightness) {
    hits = [];
    const stars = STARS.map((star) => ({ data: star, position: apparentStar(star) }));
    const byName = new Map(stars.map((entry) => [entry.data[0], entry]));
    if (state.lines) {
      context.strokeStyle = css("--grid");
      context.lineWidth = 1;
      for (const [firstName, secondName] of LINES) {
        const first = byName.get(firstName);
        const second = byName.get(secondName);
        if (!first || !second || first.position.altitude < 0 || second.position.altitude < 0) continue;
        const start = project(first.position.altitude, first.position.azimuth);
        const end = project(second.position.altitude, second.position.azimuth);
        if (!start.visible || !end.visible || Math.hypot(start.x - end.x, start.y - end.y) > width * (state.view === "ar" ? 2 : 0.5)) continue;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      }
    }

    if (state.constellations) {
      context.font = '500 12px "Pretendard", "Malgun Gothic", sans-serif';
      context.textAlign = "center";
      context.fillStyle = css("--accent");
      context.globalAlpha = 0.68;
      for (const [name, members] of CONS) {
        const visibleMembers = members.map((member) => byName.get(member)).filter((member) => member && member.position.altitude > 0);
        if (visibleMembers.length < Math.ceil(members.length / 2)) continue;
        const center = visibleMembers.reduce((sum, member) => {
          const vector = enu(member.position.altitude, member.position.azimuth);
          return sum.map((value, index) => value + vector[index]);
        }, [0, 0, 0]);
        const vector = normalizeVector(center);
        const altitude = Math.asin(vector[2]) * 180 / Math.PI;
        const azimuth = rev(Math.atan2(vector[0], vector[1]) * 180 / Math.PI);
        if (altitude < 2) continue;
        const point = project(altitude, azimuth);
        if (point.visible) context.fillText(name, point.x, point.y);
      }
      context.globalAlpha = 1;
      context.textAlign = "left";
    }

    for (const { data, position } of stars) {
      if (position.altitude < 0) continue;
      const point = project(position.altitude, position.azimuth);
      if (!point.visible) continue;
      const moonGlare = moon.altitude > 0
        ? Math.max(0, (20 - angularSeparation(position.altitude, position.azimuth, moon.altitude, moon.azimuth)) / 20) * 1.2 * moon.illumination
        : 0;
      const visible = data[3] + airExtinction(position.altitude) + moonGlare <= brightness.limit;
      const radius = Math.max(0.8, 3.6 - data[3] * 0.85);
      context.globalAlpha = visible ? 1 : 0.18;
      context.fillStyle = css("--star");
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      if (state.names && visible && LABEL_ALWAYS.includes(data[0])) drawLabel(data[0], point.x + radius + 4, point.y, css("--muted"));
      hits.push({ x: point.x, y: point.y, kind: "star", name: data[0], magnitude: data[3], altitude: position.altitude + Astro.refraction(position.altitude), azimuth: position.azimuth, visible });
    }

    for (const body of BODIES) {
      const position = body.id === "moon" ? moon : getPosition(body.id);
      if (position.altitude < -0.5) continue;
      const point = project(position.altitude, position.azimuth);
      if (!point.visible) continue;
      const color = css(body.color);
      if (body.id === "moon") {
        drawMoon(point, position, sun, state.view === "dome" ? 10 : 13);
      } else {
        const radius = Math.max(2.6, 5 - position.magnitude * 0.7);
        context.fillStyle = color;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
        if (body.id === "saturn") {
          context.strokeStyle = color;
          context.beginPath();
          context.ellipse(point.x, point.y, radius * 2.1, radius * 0.55, -0.35, 0, Math.PI * 2);
          context.stroke();
        }
      }
      if (state.selected === body.id) {
        context.strokeStyle = css("--accent");
        context.beginPath();
        context.arc(point.x, point.y, body.id === "moon" ? 19 : 12, 0, Math.PI * 2);
        context.stroke();
      }
      drawLabel(BODY_NAMES[body.id], point.x + 11, point.y - 9, color, true);
      hits.push({ x: point.x, y: point.y, kind: "body", id: body.id, name: BODY_NAMES[body.id], altitude: position.apparentAltitude, azimuth: position.azimuth, radius: 14 });
    }

    if (sun.altitude > -0.5) {
      const point = project(sun.altitude, sun.azimuth);
      if (point.visible) {
        context.fillStyle = css("--accent");
        context.beginPath();
        context.arc(point.x, point.y, 9, 0, Math.PI * 2);
        context.fill();
        drawLabel("태양", point.x + 13, point.y, css("--accent"), true);
      }
    }
  }

  function drawDome(sun, moon, brightness) {
    const radius = Math.min(width, height) / 2 - 26;
    const gradient = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius);
    gradient.addColorStop(0, css("--sky-top"));
    gradient.addColorStop(0.75, css("--sky-low"));
    gradient.addColorStop(1, brightness.sun.altitude > -18 ? "#233958" : css("--sky-low"));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    context.fill();
    context.save();
    context.beginPath();
    context.arc(width / 2, height / 2, radius + 1, 0, Math.PI * 2);
    context.clip();
    context.strokeStyle = css("--grid");
    context.setLineDash([3, 5]);
    for (const altitude of [30, 60]) {
      context.beginPath();
      context.arc(width / 2, height / 2, radius * (90 - altitude) / 90, 0, Math.PI * 2);
      context.stroke();
    }
    context.setLineDash([]);
    drawObjects(sun, moon, brightness);
    context.restore();
    context.strokeStyle = css("--muted");
    context.beginPath();
    context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    context.stroke();
    for (const [label, azimuth] of [["북", 0], ["동", 90], ["남", 180], ["서", 270]]) {
      const edge = radius + 14;
      context.fillStyle = azimuth === 180 ? css("--accent") : css("--fg");
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = '700 14px "Malgun Gothic", sans-serif';
      context.fillText(label, width / 2 - edge * Math.sin(rad(azimuth)), height / 2 - edge * Math.cos(rad(azimuth)));
    }
    context.textAlign = "left";
  }

  function drawPanorama(sun, moon, brightness) {
    const ground = height - 34;
    const gradient = context.createLinearGradient(0, 0, 0, ground);
    gradient.addColorStop(0, css("--sky-top"));
    gradient.addColorStop(0.7, css("--sky-low"));
    gradient.addColorStop(1, brightness.sun.altitude > -18 ? "#233958" : css("--sky-low"));
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, ground);
    context.strokeStyle = css("--grid");
    context.setLineDash([3, 5]);
    context.font = "11px Consolas, monospace";
    context.fillStyle = css("--muted");
    for (let altitude = 10; altitude <= 70; altitude += 10) {
      const y = project(altitude, panoramaCenter).y;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
      context.fillText(`${altitude}°`, 4, y - 7);
    }
    context.setLineDash([]);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, ground);
    context.clip();
    drawObjects(sun, moon, brightness);
    context.restore();
    context.fillStyle = css("--panel2");
    context.fillRect(0, ground, width, height - ground);
    context.strokeStyle = css("--muted");
    context.beginPath();
    context.moveTo(0, ground);
    context.lineTo(width, ground);
    context.stroke();
    context.textAlign = "center";
    for (let azimuth = 0; azimuth < 360; azimuth += 15) {
      const point = project(0, azimuth);
      if (point.x < 10 || point.x > width - 10 || !point.visible) continue;
      const cardinal = azimuth % 45 === 0;
      context.fillStyle = cardinal ? azimuth === 180 ? css("--accent") : css("--fg") : css("--muted");
      context.font = cardinal ? '700 13px "Malgun Gothic", sans-serif' : "11px Consolas, monospace";
      context.fillText(cardinal ? directionName(azimuth) : `${azimuth}°`, point.x, ground + 17);
    }
    context.textAlign = "left";
  }

  function drawAr(sun, moon, brightness) {
    const center = arCenter();
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, css("--sky-top"));
    gradient.addColorStop(1, center.altitude < 25 && brightness.sun.altitude > -18 ? "#233958" : css("--sky-low"));
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = css("--grid");
    context.setLineDash([3, 5]);
    for (const altitude of [30, 60]) {
      context.beginPath();
      let drawing = false;
      for (let azimuth = 0; azimuth <= 360; azimuth += 2) {
        const point = project(altitude, azimuth);
        if (point.visible) {
          if (drawing) context.lineTo(point.x, point.y);
          else context.moveTo(point.x, point.y);
          drawing = true;
        } else drawing = false;
      }
      context.stroke();
    }
    context.setLineDash([]);
    drawObjects(sun, moon, brightness);
    context.strokeStyle = css("--muted");
    context.lineWidth = 2;
    context.beginPath();
    let drawing = false;
    for (let azimuth = 0; azimuth <= 360; azimuth += 1) {
      const point = project(0, azimuth);
      if (point.visible) {
        if (drawing) context.lineTo(point.x, point.y);
        else context.moveTo(point.x, point.y);
        drawing = true;
      } else drawing = false;
    }
    context.stroke();
    context.textAlign = "center";
    for (let azimuth = 0; azimuth < 360; azimuth += 45) {
      const point = project(0, azimuth);
      if (!point.visible || point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
      context.fillStyle = azimuth === 180 ? css("--accent") : css("--fg");
      context.font = '700 14px "Malgun Gothic", sans-serif';
      context.fillText(directionName(azimuth), point.x, point.y + 16);
    }
    context.textAlign = "left";
    context.strokeStyle = css("--accent");
    context.beginPath();
    context.arc(width / 2, height / 2, 16, 0, Math.PI * 2);
    context.moveTo(width / 2 - 26, height / 2);
    context.lineTo(width / 2 - 10, height / 2);
    context.moveTo(width / 2 + 10, height / 2);
    context.lineTo(width / 2 + 26, height / 2);
    context.moveTo(width / 2, height / 2 - 26);
    context.lineTo(width / 2, height / 2 - 10);
    context.moveTo(width / 2, height / 2 + 10);
    context.lineTo(width / 2, height / 2 + 26);
    context.stroke();
    const closest = constellationNearDirection(center);
    context.fillStyle = css("--panel");
    context.globalAlpha = 0.88;
    context.fillRect(8, 8, Math.min(width - 16, 300), 48);
    context.globalAlpha = 1;
    context.fillStyle = css("--fg");
    context.font = '600 12px "Malgun Gothic", sans-serif';
    context.fillText(`방향 ${directionName(center.azimuth)} ${center.azimuth.toFixed(0)}° · 고도 ${center.altitude.toFixed(0)}° · 시야 ${ar.fov}°`, 16, 25);
    context.fillStyle = css("--accent");
    context.fillText(center.altitude < -2 ? "땅을 보고 있어요. 휴대폰을 위로 드세요." : closest || "이 방향에 표시할 별자리가 없습니다.", 16, 45);
  }

  function constellationNearDirection(center) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const [name, memberNames] of CONS) {
      const members = memberNames.map((memberName) => STARS.find((star) => star[0] === memberName)).filter(Boolean);
      if (!members.length) continue;
      const average = members.reduce((sum, star) => {
        const position = apparentStar(star);
        const vector = enu(position.altitude, position.azimuth);
        return sum.map((value, index) => value + vector[index]);
      }, [0, 0, 0]);
      const direction = normalizeVector(average);
      const separation = Math.acos(Math.max(-1, Math.min(1, dot(direction, enu(center.altitude, center.azimuth))))) * 180 / Math.PI;
      if (separation < nearestDistance) {
        nearest = name;
        nearestDistance = separation;
      }
    }
    return nearestDistance < 30 ? `가운데 근처: ${nearest}` : "가운데 근처에 밝은 별자리가 없어요.";
  }

  function moonPhaseName(age) {
    return Astro.moonPhaseName(age);
  }

  function riseSetForSelected() {
    return Astro.riseSet(state.selected, state.date, state.latitude, state.longitude);
  }

  function renderObjectCard(sun, moon, brightness) {
    const position = state.selected === "moon" ? moon : getPosition(state.selected);
    const events = riseSetForSelected();
    const aboveHorizon = position.altitude > 0;
    const condition = !aboveHorizon
      ? '<span class="pill bad">지평선 아래</span>'
      : position.apparentAltitude < 15
        ? '<span class="pill warn">낮음 · 건물에 가릴 수 있음</span>'
        : '<span class="pill good">관측 좋음</span>';
    const extra = state.selected === "moon"
      ? `<dt>위상</dt><dd>${moonPhaseName(position.age)}</dd><dt>밝은 면</dt><dd>${(position.illumination * 100).toFixed(1)}%</dd><dt>월령</dt><dd>${position.age.toFixed(1)}일</dd><dt>지구와 거리</dt><dd>${Math.round(position.distanceKm).toLocaleString()} km</dd>`
      : `<dt>밝기 (등급)</dt><dd>${position.magnitude.toFixed(1)}</dd><dt>지구와 거리</dt><dd>${position.distanceAu.toFixed(2)} AU</dd>`;
    $("objCard").innerHTML = `
      <div class="objname"><b>${BODY_NAMES[state.selected]}</b>${condition}</div>
      <div class="big"><div><div class="k">고도</div><div class="v">${formatAngle(position.apparentAltitude)}</div></div><div><div class="k">방위각 · ${aboveHorizon ? directionName(position.azimuth) : "—"}</div><div class="v">${formatAngle(position.azimuth)}</div></div></div>
      <dl class="kv"><dt>뜨는 시각</dt><dd>${events.rise == null ? "—" : formatMinute(events.rise)}</dd><dt>남중 시각 · 고도</dt><dd>${formatMinute(events.transit)} · ${formatAngle(events.maxAltitude + Astro.refraction(events.maxAltitude))}</dd><dt>지는 시각</dt><dd>${events.set == null ? "—" : formatMinute(events.set)}</dd><dt>적경 · 적위</dt><dd>${(position.ra / 15).toFixed(2)}h · ${formatAngle(position.dec)}</dd>${extra}</dl>
      <div class="tipbox"><span class="muted small">관측 정보</span><br>${state.selected === "moon" ? `달의 밝은 면이 ${Math.round(position.illumination * 100)}%입니다.` : `${BODY_NAMES[state.selected]}의 위치와 밝기는 선택한 시각 기준입니다.`}</div>`;
    $("skyNote").textContent = `태양 고도 ${sun.altitude.toFixed(1)}° (${sun.altitude > -6 ? "아직 밝음" : sun.altitude > -18 ? "박명" : "완전히 어두움"}) · 맨눈 한계 등급 약 ${brightness.limit.toFixed(1)}등급 · 흐린 별은 지금 맨눈으로 보기 어려울 수 있어요.`;
    for (const body of BODIES) {
      const chip = document.querySelector(`.chip[data-id="${body.id}"]`);
      const bodyPosition = body.id === "moon" ? moon : getPosition(body.id);
      chip?.classList.toggle("below", bodyPosition.altitude < 0);
      chip?.setAttribute("aria-pressed", String(state.selected === body.id));
    }
    renderBrightness(brightness);
  }

  function renderBrightness(brightness) {
    $("nelmNow").textContent = `${brightness.limit.toFixed(1)}등급`;
    $("countNow").textContent = `약 ${estimatedStarCount(brightness.limit).toLocaleString()}개`;
    const withoutMoon = skyBrightness(state.minute, { withoutMoon: true });
    const entries = [["관측지 기본", brightness.base], ["박명 영향", -brightness.twilight], ["달빛 영향", -brightness.moonlight], ["달이 없다면", withoutMoon.limit]];
    $("bars").innerHTML = entries.map(([name, value], index) => {
      const percent = index === 1 || index === 2 ? Math.min(100, Math.abs(value) / 6.5 * 100) : Math.min(100, value / 6.5 * 100);
      return `<div class="b"><span>${name}</span><div class="meter"><span style="width:${percent}%;${index === 1 || index === 2 ? "background:var(--warn)" : ""}"></span></div><span class="num">${value.toFixed(1)}</span></div>`;
    }).join("") + `<p class="small muted">달이 없을 때 약 ${estimatedStarCount(withoutMoon.limit).toLocaleString()}개 → 지금 약 ${estimatedStarCount(brightness.limit).toLocaleString()}개</p>`;
  }

  function renderEvents() {
    const events = [];
    const sunEvents = Astro.riseSet("sun", state.date, state.latitude, state.longitude);
    if (sunEvents.set !== null) events.push([sunEvents.set, "해 짐"]);
    const darkness = Astro.twilightEnd(state.date, state.latitude, state.longitude, -18);
    if (darkness !== null) events.push([darkness, "완전히 어두워짐"]);
    const moonEvents = Astro.riseSet("moon", state.date, state.latitude, state.longitude);
    if (moonEvents.rise !== null) events.push([moonEvents.rise, "달 뜸"]);
    events.push([moonEvents.transit, `달 남중 · 고도 ${moonEvents.maxAltitude.toFixed(0)}°`]);
    if (moonEvents.set !== null) events.push([moonEvents.set, "달 짐"]);
    for (const id of ["saturn", "jupiter", "mars"]) {
      const bodyEvents = Astro.riseSet(id, state.date, state.latitude, state.longitude);
      if (bodyEvents.rise !== null && bodyEvents.rise < 1800) events.push([bodyEvents.rise, `${BODY_NAMES[id]} 뜸`]);
      if (bodyEvents.transit < 1800 && bodyEvents.maxAltitude > 0) events.push([bodyEvents.transit, `${BODY_NAMES[id]} 남중 · 고도 ${bodyEvents.maxAltitude.toFixed(0)}°`]);
      if (bodyEvents.set !== null && bodyEvents.set < 1800) events.push([bodyEvents.set, `${BODY_NAMES[id]} 짐`]);
    }
    $("events").innerHTML = events
      .filter(([minute]) => minute >= 900 && minute <= 1860)
      .sort((a, b) => a[0] - b[0])
      .map(([minute, name]) => `<li><span class="t">${formatMinute(minute)}${minute >= 1440 ? "⁺¹" : ""}</span><span>${name}</span></li>`)
      .join("");
    $("ticks").innerHTML = Array.from({ length: 8 }, (_, index) => {
      const minute = 960 + index * 120;
      return `<span style="left:${index / 7 * 100}%">${formatMinute(minute)}</span>`;
    }).join("");
  }

  function updateTimeControls() {
    $("time").value = String(state.minute);
    $("clock").textContent = `${formatMinute(state.minute)}${state.minute >= 1440 ? "⁺¹" : ""}`;
  }

  function renderForecast() {
    const step = Number($("step").value);
    const rows = [];
    for (let minute = 1050; minute <= 1500; minute += step) {
      rows.push({
        minute,
        sun: getPosition("sun", minute),
        moon: getPosition("moon", minute),
        saturn: getPosition("saturn", minute),
        jupiter: getPosition("jupiter", minute),
        limit: skyBrightness(minute).limit
      });
    }
    const cells = (position) => position.altitude < 0
      ? '<td class="dim">지평선 아래</td><td class="dim">—</td>'
      : `<td>${formatAngle(position.apparentAltitude)}</td><td>${formatAngle(position.azimuth)} ${directionName(position.azimuth)}</td>`;
    $("predTable").innerHTML = `<thead><tr><th>시각</th><th>태양 고도</th><th>달 고도</th><th>달 방위각</th><th>달 밝기</th><th>토성 고도</th><th>토성 방위각</th><th>목성 고도</th><th>목성 방위각</th><th>맨눈 한계</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.sun.altitude < -18 ? "dark" : ""}"><td>${formatMinute(row.minute)}</td><td>${formatAngle(row.sun.altitude)}</td>${cells(row.moon)}<td>${(row.moon.illumination * 100).toFixed(0)}%</td>${cells(row.saturn)}${cells(row.jupiter)}<td>${row.limit.toFixed(1)}</td></tr>`).join("")}</tbody>`;
    return rows;
  }

  function forecastCsv() {
    const rows = renderForecast();
    const pair = (position) => position.altitude < 0 ? ["", ""] : [position.apparentAltitude.toFixed(1), position.azimuth.toFixed(1)];
    return ["날짜,시각,태양고도,달고도,달방위각,달밝기%,토성고도,토성방위각,목성고도,목성방위각,맨눈한계등급",
      ...rows.map((row) => [state.date, formatMinute(row.minute), row.sun.altitude.toFixed(1), ...pair(row.moon), (row.moon.illumination * 100).toFixed(0), ...pair(row.saturn), ...pair(row.jupiter), row.limit.toFixed(1)].join(","))
    ].join("\n");
  }

  function recordPrediction(record) {
    const [hour, minute] = record.time.split(":").map(Number);
    let totalMinutes = hour * 60 + minute;
    if (totalMinutes < 720) totalMinutes += 1440;
    return getPosition(record.target, totalMinutes, record.date);
  }

  function signedAzimuthDifference(measured, predicted) {
    return ((measured - predicted + 540) % 360) - 180;
  }

  function renderMeasurements() {
    $("measTable").innerHTML = `<thead><tr><th>모둠</th><th>대상</th><th>날짜 · 시각</th><th>측정 고도</th><th>예측 고도</th><th>고도 오차</th><th>측정 방위각</th><th>예측 방위각</th><th>방위각 오차</th><th></th></tr></thead><tbody>${records.map((record, index) => {
      const predicted = recordPrediction(record);
      const azimuth = record.azimuth === null ? null : record.magnetic ? rev(record.azimuth - MAGNETIC_DECLINATION) : record.azimuth;
      const altitudeError = record.altitude - predicted.apparentAltitude;
      const azimuthError = azimuth === null ? null : signedAzimuthDifference(azimuth, predicted.azimuth);
      return `<tr><td>${escapeHtml(record.group || "—")}</td><td>${BODY_NAMES[record.target]}</td><td>${record.date.slice(5)} ${record.time}</td><td>${formatAngle(record.altitude)}</td><td>${formatAngle(predicted.apparentAltitude)}</td><td>${altitudeError >= 0 ? "+" : ""}${altitudeError.toFixed(1)}°</td><td>${azimuth === null ? "—" : formatAngle(azimuth)}</td><td>${formatAngle(predicted.azimuth)}</td><td>${azimuthError === null ? "—" : `${azimuthError >= 0 ? "+" : ""}${azimuthError.toFixed(1)}°`}</td><td><button type="button" data-delete-record="${index}" aria-label="측정 기록 삭제">삭제</button></td></tr>`;
    }).join("")}</tbody>`;
    $("mSummary").textContent = `저장된 관측 기록 ${records.length}건`;
    renderChart();
  }

  function renderChart() {
    const target = $("chartTarget").value || "moon";
    const recordsForTarget = records.filter((record) => record.target === target);
    const chartWidth = 680;
    const chartHeight = 300;
    const left = 52;
    const top = 24;
    const bottom = 48;
    const plotHeight = chartHeight - top - bottom;
    const plotWidth = chartWidth - left - 16;
    const x = (minute) => left + (minute - 960) / 840 * plotWidth;
    const y = (altitude) => top + (90 - altitude) / 100 * plotHeight;
    const points = [];
    for (let minute = 960; minute <= 1800; minute += 15) {
      const position = getPosition(target, minute);
      if (position.altitude > -10) points.push([x(minute), y(position.apparentAltitude)]);
    }
    const line = points.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
    const grid = [0, 30, 60, 90].map((altitude) => `<line x1="${left}" x2="${chartWidth - 16}" y1="${y(altitude)}" y2="${y(altitude)}" stroke="var(--line)"/><text x="${left - 8}" y="${y(altitude) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${altitude}°</text>`).join("");
    const measured = recordsForTarget.map((record) => {
      const [hour, minute] = record.time.split(":").map(Number);
      const total = (hour * 60 + minute) < 720 ? hour * 60 + minute + 1440 : hour * 60 + minute;
      return `<circle cx="${x(total)}" cy="${y(record.altitude)}" r="5" fill="var(--warn)"><title>${escapeHtml(record.group)} ${record.date} ${record.time}: ${record.altitude.toFixed(1)}°</title></circle>`;
    }).join("");
    $("chart").innerHTML = `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${BODY_NAMES[target]}의 예측 고도와 관측값 그래프">${grid}<line x1="${left}" x2="${chartWidth - 16}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>${measured}<text x="${left}" y="${chartHeight - 12}" fill="var(--muted)" font-size="12">16:00</text><text x="${chartWidth - 16}" y="${chartHeight - 12}" text-anchor="end" fill="var(--muted)" font-size="12">다음 날 06:00</text></svg>`;
    $("chartTitle").textContent = `${BODY_NAMES[target]}: 예측 고도와 실측값`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function measurementCsv() {
    return ["모둠,대상,날짜,시각,측정고도,예측고도,고도오차,측정방위각,예측방위각,방위각오차", ...records.map((record) => {
      const predicted = recordPrediction(record);
      const azimuth = record.azimuth === null ? null : record.magnetic ? rev(record.azimuth - MAGNETIC_DECLINATION) : record.azimuth;
      const error = azimuth === null ? "" : signedAzimuthDifference(azimuth, predicted.azimuth).toFixed(1);
      return [record.group, BODY_NAMES[record.target], record.date, record.time, record.altitude, predicted.apparentAltitude.toFixed(1), (record.altitude - predicted.apparentAltitude).toFixed(1), azimuth === null ? "" : azimuth.toFixed(1), predicted.azimuth.toFixed(1), error].join(",");
    })].join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      $("toast").textContent = "복사했어요. 문서나 스프레드시트에 붙여 넣으세요.";
    } catch {
      $("copybox").hidden = false;
      $("copybox").value = text;
      $("copybox").focus();
      $("copybox").select();
      $("toast").textContent = "자동 복사가 막혀 있어요. 선택한 내용을 복사해 주세요.";
    }
  }

  function render() {
    if (!Array.isArray(STARS) || !Array.isArray(LINES) || !Array.isArray(CONS)) {
      $("skyNote").textContent = "별 자료를 불러오지 못했습니다. data.js 파일을 확인해 주세요.";
      return;
    }
    if (!width) updateCanvasSize();
    const brightness = skyBrightness();
    const sun = brightness.sun;
    const moon = brightness.moon;
    if (state.view === "pano") {
      const selected = state.selected === "moon" ? moon : getPosition(state.selected);
      panoramaCenter = selected.altitude > -5 ? Math.round(selected.azimuth / 5) * 5 : 180;
    }
    updateTimeControls();
    context.clearRect(0, 0, width, height);
    const redMode = document.documentElement.dataset.red === "1";
    context.fillStyle = redMode ? "#120202" : css("--bg");
    context.fillRect(0, 0, width, height);
    if (state.view === "dome") drawDome(sun, moon, brightness);
    else if (state.view === "pano") drawPanorama(sun, moon, brightness);
    else drawAr(sun, moon, brightness);
    renderObjectCard(sun, moon, brightness);
  }

  function renderAll() {
    updateCanvasSize();
    renderEvents();
    render();
    renderForecast();
    renderMeasurements();
  }

  function chooseBody(id) {
    state.selected = id;
    render();
  }

  function setView(view) {
    state.view = view;
    for (const [id, name] of [["vDome", "dome"], ["vPano", "pano"], ["vAr", "ar"]]) $(id).setAttribute("aria-pressed", String(view === name));
    $("arBar").hidden = view !== "ar";
    if (view !== "ar" && ar.sensor) stopSensor();
    if (view === "ar" && !ar.sensor) {
      const position = getPosition(state.selected);
      if (position.altitude > 0) {
        ar.azimuth = position.azimuth;
        ar.altitude = Math.min(80, position.altitude);
        setManualDirection();
      }
    }
    canvas.style.cursor = view === "ar" ? "grab" : "crosshair";
    updateCanvasSize();
    render();
  }

  function showSensorMessage(message, success) {
    $("arMsg").textContent = message;
    $("arMsg").className = `small ${success === true ? "msg-ok" : success === false ? "msg-bad" : ""}`;
  }

  function redrawArSoon() {
    if (ar.pending) return;
    ar.pending = true;
    requestAnimationFrame(() => {
      ar.pending = false;
      render();
    });
  }

  function onOrientation(event) {
    let alpha = event.alpha;
    if (event.webkitCompassHeading != null) alpha = 360 - event.webkitCompassHeading;
    if (alpha == null || event.beta == null || event.gamma == null) return;
    ar.gotReading = true;
    const a = rad(alpha);
    const b = rad(event.beta);
    const g = rad(event.gamma);
    const cosA = Math.cos(a), sinA = Math.sin(a), cosB = Math.cos(b), sinB = Math.sin(b), cosG = Math.cos(g), sinG = Math.sin(g);
    const xAxis = [cosA * cosG - sinA * sinB * sinG, cosG * sinA + cosA * sinB * sinG, -cosB * sinG];
    const yAxis = [-cosB * sinA, cosA * cosB, sinB];
    const zAxis = [cosG * sinA * sinB + cosA * sinG, sinA * sinG - cosA * cosG * sinB, cosB * cosG];
    const rawForward = zAxis.map((value) => -value);
    const screenAngle = rad((screen.orientation?.angle ?? window.orientation ?? 0));
    const screenUp = xAxis.map((value, index) => Math.sin(screenAngle) * value + Math.cos(screenAngle) * yAxis[index]);
    const correction = rad(($("arDecl").checked ? -MAGNETIC_DECLINATION : 0) + ar.offset);
    const rotateNorth = (vector) => [vector[0] * Math.cos(correction) + vector[1] * Math.sin(correction), -vector[0] * Math.sin(correction) + vector[1] * Math.cos(correction), vector[2]];
    const nextForward = normalizeVector(rotateNorth(rawForward));
    const nextUp = normalizeVector(rotateNorth(screenUp));
    const blend = ar.sampled ? 0.3 : 1;
    ar.forward = normalizeVector(ar.forward.map((value, index) => value + (nextForward[index] - value) * blend));
    ar.up = normalizeVector(ar.up.map((value, index) => value + (nextUp[index] - value) * blend));
    ar.up = normalizeVector(ar.up.map((value, index) => value - dot(ar.up, ar.forward) * ar.forward[index]));
    ar.right = cross(ar.forward, ar.up);
    ar.sampled = true;
    redrawArSoon();
  }

  async function startSensor() {
    try {
      if (typeof DeviceOrientationEvent === "undefined") throw new Error("이 기기는 방향 센서를 지원하지 않습니다.");
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") throw new Error("방향 센서 권한이 허용되지 않았습니다.");
      }
      ar.eventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
      ar.gotReading = false;
      ar.sampled = false;
      ar.sensor = true;
      window.addEventListener(ar.eventName, onOrientation, true);
      $("arSensor").textContent = "센서 끄기";
      showSensorMessage("센서를 켰어요. 화면 뒷면을 하늘로 향해 보세요.", true);
      window.setTimeout(() => {
        if (ar.sensor && !ar.gotReading) {
          stopSensor();
          showSensorMessage("센서 신호가 없습니다. 화면을 손가락으로 끌어 하늘을 둘러보세요.", false);
        }
      }, 3000);
    } catch (error) {
      showSensorMessage(`${error.message} 화면을 끌어 방향을 조절할 수 있어요.`, false);
    }
  }

  function stopSensor() {
    if (ar.eventName) window.removeEventListener(ar.eventName, onOrientation, true);
    ar.sensor = false;
    $("arSensor").textContent = "센서 켜기";
    const center = arCenter();
    ar.azimuth = center.azimuth;
    ar.altitude = center.altitude;
    setManualDirection();
    canvas.style.cursor = "grab";
  }

  function parseCoordinates(raw) {
    const text = String(raw || "").trim();
    const match = text.match(/@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/)
      || text.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/)
      || text.match(/(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (!match) return null;
    let latitude = Number(match[1]);
    let longitude = Number(match[2]);
    if (Math.abs(latitude) > 90 && Math.abs(longitude) <= 90) [latitude, longitude] = [longitude, latitude];
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
  }

  function saveCurrentLocation(name = state.place) {
    state.place = name || "사용자 지정 장소";
    state.latitude = Number(state.latitude.toFixed(5));
    state.longitude = Number(state.longitude.toFixed(5));
    $("placeName").textContent = state.place;
    $("placeCoord").textContent = `${Math.abs(state.latitude).toFixed(4)}°${state.latitude >= 0 ? "N" : "S"} · ${Math.abs(state.longitude).toFixed(4)}°${state.longitude >= 0 ? "E" : "W"}`;
    $("lat").value = state.latitude;
    $("lon").value = state.longitude;
    writeStorage(STATE_KEY, { date: state.date, latitude: state.latitude, longitude: state.longitude, place: state.place, sky: state.sky });
    renderSavedPlaces();
    renderAll();
  }

  function renderSavedPlaces() {
    const saved = readStorage("night-sky-sim-places-v1", []);
    $("savedList").innerHTML = saved.map((place, index) => `<span class="chip"><button type="button" data-place="${index}">${escapeHtml(place.name)}</button><button type="button" class="x" data-delete-place="${index}" aria-label="${escapeHtml(place.name)} 삭제">×</button></span>`).join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function nearestHit(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let closest = null;
    let distance = Infinity;
    for (const hit of hits) {
      const currentDistance = Math.hypot(hit.x - x, hit.y - y);
      const threshold = hit.kind === "body" ? hit.radius + 6 : 12;
      if (currentDistance < threshold && (currentDistance < distance || (closest?.kind === "star" && hit.kind === "body"))) {
        closest = hit;
        distance = currentDistance;
      }
    }
    return { closest, x, y };
  }

  function installEvents() {
    $("legend").innerHTML = BODIES.map((body) => `<button class="chip" type="button" data-id="${body.id}" aria-pressed="false"><i style="background:var(${body.color})"></i>${body.name}</button>`).join("");
    $("legend").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-id]");
      if (button) chooseBody(button.dataset.id);
    });
    $("btnPlace").addEventListener("click", () => {
      const open = $("placePanel").hidden;
      $("placePanel").hidden = !open;
      $("btnPlace").setAttribute("aria-expanded", String(open));
      $("btnPlace").textContent = open ? "닫기" : "장소 바꾸기";
    });
    $("coordApply").addEventListener("click", () => {
      const coordinates = parseCoordinates($("coordIn").value);
      if (!coordinates) {
        $("coordMsg").textContent = "좌표를 읽지 못했어요. 위도, 경도 순서로 입력해 주세요.";
        $("coordMsg").className = "small msg-bad";
        return;
      }
      state.latitude = coordinates.latitude;
      state.longitude = coordinates.longitude;
      saveCurrentLocation($("placeNameIn").value.trim() || "사용자 지정 장소");
      $("coordMsg").textContent = "관측 장소를 바꿨어요.";
      $("coordMsg").className = "small msg-ok";
    });
    for (const id of ["lat", "lon"]) $(id).addEventListener("change", () => {
      const latitude = Number($("lat").value);
      const longitude = Number($("lon").value);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        $("coordMsg").textContent = "위도 -90°~90°, 경도 -180°~180° 범위를 확인해 주세요.";
        $("coordMsg").className = "small msg-bad";
        return;
      }
      state.latitude = latitude;
      state.longitude = longitude;
      saveCurrentLocation($("placeNameIn").value.trim() || "사용자 지정 장소");
    });
    $("btnGps").addEventListener("click", () => {
      if (!navigator.geolocation) {
        $("gpsMsg").textContent = "이 브라우저에서는 GPS 위치를 사용할 수 없습니다.";
        $("gpsMsg").className = "small msg-bad";
        return;
      }
      $("gpsMsg").textContent = "위치를 찾고 있습니다.";
      navigator.geolocation.getCurrentPosition((position) => {
        state.latitude = position.coords.latitude;
        state.longitude = position.coords.longitude;
        saveCurrentLocation($("placeNameIn").value.trim() || "현재 위치");
        $("gpsMsg").textContent = `현재 위치를 적용했습니다. 오차 약 ${Math.round(position.coords.accuracy)}m`;
        $("gpsMsg").className = "small msg-ok";
      }, (error) => {
        $("gpsMsg").textContent = error.code === 1 ? "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요." : "위치를 확인하지 못했습니다. 좌표를 직접 입력해 주세요.";
        $("gpsMsg").className = "small msg-bad";
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
    $("savePlace").addEventListener("click", () => {
      const name = $("placeNameIn").value.trim();
      if (!name) {
        $("placeNameIn").focus();
        $("coordMsg").textContent = "저장할 장소 이름을 적어 주세요.";
        $("coordMsg").className = "small msg-bad";
        return;
      }
      const places = readStorage("night-sky-sim-places-v1", []).filter((place) => place.name !== name);
      places.unshift({ name, latitude: state.latitude, longitude: state.longitude });
      if (!writeStorage("night-sky-sim-places-v1", places.slice(0, 12))) {
        $("coordMsg").textContent = "장소를 저장할 수 없습니다. 브라우저 저장 공간을 확인해 주세요.";
        $("coordMsg").className = "small msg-bad";
        return;
      }
      state.place = name;
      saveCurrentLocation(name);
      $("placeNameIn").value = "";
      $("coordMsg").textContent = `${name} 장소를 저장했습니다.`;
      $("coordMsg").className = "small msg-ok";
    });
    $("savedList").addEventListener("click", (event) => {
      const saved = readStorage("night-sky-sim-places-v1", []);
      const removeIndex = event.target.dataset.deletePlace;
      if (removeIndex !== undefined) {
        saved.splice(Number(removeIndex), 1);
        writeStorage("night-sky-sim-places-v1", saved);
        renderSavedPlaces();
        return;
      }
      const index = event.target.dataset.place;
      if (index === undefined || !saved[index]) return;
      state.latitude = saved[index].latitude;
      state.longitude = saved[index].longitude;
      saveCurrentLocation(saved[index].name);
    });

    $("date").addEventListener("change", () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test($("date").value)) return;
      state.date = $("date").value;
      $("mDate").value = state.date;
      renderAll();
    });
    $("time").addEventListener("input", () => {
      state.minute = Number($("time").value);
      render();
    });
    $("btnPlay").addEventListener("click", () => {
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
        $("btnPlay").textContent = "▶ 재생";
        return;
      }
      $("btnPlay").textContent = "❚❚ 멈춤";
      playTimer = window.setInterval(() => {
        state.minute = state.minute + 4 > 1800 ? 960 : state.minute + 4;
        render();
      }, 100);
    });
    $("vDome").addEventListener("click", () => setView("dome"));
    $("vPano").addEventListener("click", () => setView("pano"));
    $("vAr").addEventListener("click", () => setView("ar"));
    $("optLines").addEventListener("change", () => { state.lines = $("optLines").checked; render(); });
    $("optNames").addEventListener("change", () => { state.names = $("optNames").checked; render(); });
    $("optCons").addEventListener("change", () => { state.constellations = $("optCons").checked; render(); });
    $("arSensor").addEventListener("click", () => ar.sensor ? (stopSensor(), showSensorMessage("센서를 껐어요. 화면을 끌어 둘러볼 수 있어요."), render()) : startSensor());
    $("arIn").addEventListener("click", () => { ar.fov = Math.max(30, ar.fov - 10); render(); });
    $("arOut").addEventListener("click", () => { ar.fov = Math.min(110, ar.fov + 10); render(); });
    $("arCal").addEventListener("click", () => {
      const position = getPosition(state.selected);
      if (position.altitude < 0) {
        showSensorMessage("선택한 천체가 지평선 아래에 있어 보정할 수 없습니다.", false);
      } else if (!ar.sensor) {
        ar.azimuth = position.azimuth;
        ar.altitude = Math.min(89.5, position.apparentAltitude);
        setManualDirection();
        render();
        showSensorMessage("선택한 천체를 화면 가운데에 맞췄습니다.", true);
      } else {
        const center = arCenter();
        const difference = ((position.azimuth - center.azimuth + 540) % 360) - 180;
        ar.offset += difference;
        showSensorMessage(`방향을 ${difference >= 0 ? "+" : ""}${difference.toFixed(1)}° 보정했습니다.`, true);
      }
    });
    $("arDecl").addEventListener("change", () => { if (ar.sensor) showSensorMessage("나침반 보정 설정을 바꿨어요. 센서를 다시 켜 주세요."); });
    $("btnRed").addEventListener("click", () => {
      const enabled = document.documentElement.dataset.red !== "1";
      document.documentElement.dataset.red = enabled ? "1" : "0";
      $("btnRed").setAttribute("aria-pressed", String(enabled));
      render();
    });
    $("skyType").addEventListener("change", () => { state.sky = $("skyType").value; renderAll(); });
    $("step").addEventListener("change", renderForecast);
    $("copyPred").addEventListener("click", () => copyText(forecastCsv()));
    $("copyMeas").addEventListener("click", () => copyText(measurementCsv()));
    $("clearEx").addEventListener("click", () => {
      records = [];
      writeStorage(RECORD_KEY, records);
      renderMeasurements();
    });
    $("measTable").addEventListener("click", (event) => {
      const index = Number(event.target.dataset.deleteRecord);
      if (!Number.isInteger(index) || index < 0 || index >= records.length) return;
      records.splice(index, 1);
      writeStorage(RECORD_KEY, records);
      renderMeasurements();
    });
    const bodyOptions = BODIES.map((body) => `<option value="${body.id}">${body.name}</option>`).join("");
    $("mTarget").innerHTML = bodyOptions;
    $("chartTarget").innerHTML = bodyOptions;
    $("mTarget").addEventListener("change", () => {
      $("chartTarget").value = $("mTarget").value;
      renderChart();
    });
    $("chartTarget").addEventListener("change", renderChart);
    $("mForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const altitude = Number($("mAlt").value);
      const azimuth = $("mAz").value.trim() === "" ? null : Number($("mAz").value);
      if (!Number.isFinite(altitude) || altitude < -5 || altitude > 90 || (azimuth !== null && (!Number.isFinite(azimuth) || azimuth < 0 || azimuth > 360))) {
        $("toast").textContent = "고도는 -5°~90°, 방위각은 0°~360° 범위로 입력해 주세요.";
        return;
      }
      records.push({
        target: $("mTarget").value,
        date: $("mDate").value,
        time: $("mTime").value,
        altitude,
        azimuth,
        group: $("mWho").value.trim(),
        magnetic: $("mMag").checked
      });
      if (!writeStorage(RECORD_KEY, records)) {
        records.pop();
        $("toast").textContent = "기록을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.";
        return;
      }
      renderMeasurements();
      $("mAlt").value = "";
      $("mAz").value = "";
      $("toast").textContent = "관측 기록을 저장했습니다.";
    });
    for (const [tabId, panelId] of [["t1", "p1"], ["t2", "p2"], ["t3", "p3"]]) {
      $(tabId).addEventListener("click", () => {
        for (const [otherTab, otherPanel] of [["t1", "p1"], ["t2", "p2"], ["t3", "p3"]]) {
          $(otherTab).setAttribute("aria-selected", String(otherTab === tabId));
          $(otherPanel).hidden = otherPanel !== panelId;
        }
        if (panelId === "p2") renderChart();
      });
    }
    canvas.addEventListener("mousemove", (event) => {
      const { closest, x, y } = nearestHit(event);
      const tip = $("tip");
      if (!closest || state.view === "ar") {
        tip.hidden = true;
        return;
      }
      tip.hidden = false;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.textContent = `${closest.name} · 고도 ${closest.altitude.toFixed(1)}° · 방위 ${closest.azimuth.toFixed(0)}° ${directionName(closest.azimuth)}${closest.kind === "star" ? ` · ${closest.magnitude.toFixed(1)}등급${closest.visible ? "" : " · 어두워 보이지 않을 수 있음"}` : ""}`;
    });
    canvas.addEventListener("mouseleave", () => { $("tip").hidden = true; });
    canvas.addEventListener("click", (event) => {
      if (dragPoint?.moved) return;
      const { closest } = nearestHit(event);
      if (closest?.kind === "body") chooseBody(closest.id);
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (state.view !== "ar" || ar.sensor) return;
      dragPoint = { x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragPoint || state.view !== "ar" || ar.sensor) return;
      const deltaX = event.clientX - dragPoint.x;
      const deltaY = event.clientY - dragPoint.y;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) dragPoint.moved = true;
      const scale = ar.fov / width;
      ar.azimuth = rev(ar.azimuth - deltaX * scale);
      ar.altitude = Math.max(-10, Math.min(89.5, ar.altitude + deltaY * scale));
      dragPoint.x = event.clientX;
      dragPoint.y = event.clientY;
      setManualDirection();
      redrawArSoon();
    });
    const finishDrag = () => {
      if (dragPoint) {
        canvas.style.cursor = "grab";
        window.setTimeout(() => { dragPoint = null; }, 0);
      }
    };
    canvas.addEventListener("pointerup", finishDrag);
    canvas.addEventListener("pointercancel", finishDrag);
    canvas.addEventListener("wheel", (event) => {
      if (state.view !== "ar") return;
      event.preventDefault();
      ar.fov = Math.max(30, Math.min(110, ar.fov + (event.deltaY > 0 ? 5 : -5)));
      render();
    }, { passive: false });
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") { state.minute = Math.min(1800, state.minute + 10); render(); event.preventDefault(); }
      if (event.key === "ArrowLeft") { state.minute = Math.max(960, state.minute - 10); render(); event.preventDefault(); }
    });
    window.addEventListener("resize", () => {
      window.clearTimeout(window.resizeTimer);
      window.resizeTimer = window.setTimeout(() => { updateCanvasSize(); render(); }, 120);
    });
  }

  function initialize() {
    const saved = readStorage(STATE_KEY, null);
    if (saved && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
      state.latitude = saved.latitude;
      state.longitude = saved.longitude;
      state.place = saved.place || state.place;
      state.sky = SKY_BASE[saved.sky] ? saved.sky : state.sky;
      $("skyType").value = state.sky;
    }
    $("date").value = state.date;
    $("mDate").value = state.date;
    $("lat").value = state.latitude;
    $("lon").value = state.longitude;
    $("placeName").textContent = state.place;
    $("placeCoord").textContent = `${state.latitude.toFixed(4)}°N · ${state.longitude.toFixed(4)}°E`;
    $("time").value = String(state.minute);
    $("mTarget").innerHTML = BODIES.map((body) => `<option value="${body.id}">${body.name}</option>`).join("");
    $("chartTarget").innerHTML = $("mTarget").innerHTML;
    $("mTarget").value = state.selected;
    $("chartTarget").value = state.selected;
    setManualDirection();
    installEvents();
    renderSavedPlaces();
    renderAll();
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("sw.js").catch((error) => {
        $("gpsMsg").textContent = `오프라인 저장을 설정하지 못했습니다: ${error.message}`;
      });
    }
  }

  initialize();
})();
