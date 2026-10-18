(() => {
  "use strict";

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const KST = 9 * 60 * 60 * 1000;
  const normalize = (angle) => angle - Math.floor(angle / 360) * 360;
  const sin = (angle) => Math.sin(angle * RAD);
  const cos = (angle) => Math.cos(angle * RAD);
  const atan2 = (y, x) => Math.atan2(y, x) * DEG;
  const dayNumber = (milliseconds) => milliseconds / 86400000 + 2440587.5 - 2451543.5;
  const dateMilliseconds = (dateText, minutes) => {
    const [year, month, day] = dateText.split("-").map(Number);
    return Date.UTC(year, month - 1, day) - KST + minutes * 60000;
  };

  function solveKepler(meanAnomaly, eccentricity) {
    let eccentricAnomaly = meanAnomaly + eccentricity * DEG * sin(meanAnomaly) * (1 + eccentricity * cos(meanAnomaly));
    for (let index = 0; index < 8; index += 1) {
      const delta = (eccentricAnomaly - eccentricity * DEG * sin(eccentricAnomaly) - meanAnomaly) / (1 - eccentricity * cos(eccentricAnomaly));
      eccentricAnomaly -= delta;
      if (Math.abs(delta) < 1e-6) break;
    }
    return eccentricAnomaly;
  }

  function orbit(node, inclination, perihelion, axis, eccentricity, anomaly) {
    const eccentricAnomaly = solveKepler(anomaly, eccentricity);
    const xOrbit = axis * (cos(eccentricAnomaly) - eccentricity);
    const yOrbit = axis * Math.sqrt(1 - eccentricity ** 2) * sin(eccentricAnomaly);
    const trueAnomaly = atan2(yOrbit, xOrbit);
    const radius = Math.hypot(xOrbit, yOrbit);
    const x = radius * (cos(node) * cos(trueAnomaly + perihelion) - sin(node) * sin(trueAnomaly + perihelion) * cos(inclination));
    const y = radius * (sin(node) * cos(trueAnomaly + perihelion) + cos(node) * sin(trueAnomaly + perihelion) * cos(inclination));
    const z = radius * sin(trueAnomaly + perihelion) * sin(inclination);
    return { longitude: normalize(atan2(y, x)), latitude: atan2(z, Math.hypot(x, y)), radius };
  }

  function sunPosition(day) {
    const perihelion = 282.9404 + 4.70935e-5 * day;
    const eccentricity = 0.016709 - 1.151e-9 * day;
    const meanAnomaly = normalize(356.047 + 0.9856002585 * day);
    const eccentricAnomaly = meanAnomaly + eccentricity * DEG * sin(meanAnomaly) * (1 + eccentricity * cos(meanAnomaly));
    const x = cos(eccentricAnomaly) - eccentricity;
    const y = Math.sqrt(1 - eccentricity ** 2) * sin(eccentricAnomaly);
    const longitude = normalize(atan2(y, x) + perihelion);
    const radius = Math.hypot(x, y);
    return { longitude, latitude: 0, radius, x: radius * cos(longitude), y: radius * sin(longitude), meanAnomaly, perihelion };
  }

  const ELEMENTS = {
    mercury: (day) => [48.3313 + 3.24587e-5 * day, 7.0047 + 5e-8 * day, 29.1241 + 1.01444e-5 * day, 0.387098, 0.205635 + 5.59e-10 * day, 168.6562 + 4.0923344368 * day],
    venus: (day) => [76.6799 + 2.4659e-5 * day, 3.3946 + 2.75e-8 * day, 54.891 + 1.38374e-5 * day, 0.72333, 0.006773 - 1.302e-9 * day, 48.0052 + 1.6021302244 * day],
    mars: (day) => [49.5574 + 2.11081e-5 * day, 1.8497 - 1.78e-8 * day, 286.5016 + 2.92961e-5 * day, 1.523688, 0.093405 + 2.516e-9 * day, 18.6021 + 0.5240207766 * day],
    jupiter: (day) => [100.4542 + 2.76854e-5 * day, 1.303 - 1.557e-7 * day, 273.8777 + 1.64505e-5 * day, 5.20256, 0.048498 + 4.469e-9 * day, 19.895 + 0.0830853001 * day],
    saturn: (day) => [113.6634 + 2.3898e-5 * day, 2.4886 - 1.081e-7 * day, 339.3939 + 2.97661e-5 * day, 9.55475, 0.055546 - 9.499e-9 * day, 316.967 + 0.0334442282 * day]
  };

  function eclipticToEquatorial(longitude, latitude, radius, day) {
    const obliquity = 23.4393 - 3.563e-7 * day;
    const x = radius * cos(latitude) * cos(longitude);
    const y0 = radius * cos(latitude) * sin(longitude);
    const z0 = radius * sin(latitude);
    const y = y0 * cos(obliquity) - z0 * sin(obliquity);
    const z = y0 * sin(obliquity) + z0 * cos(obliquity);
    return { ra: normalize(atan2(y, x)), dec: atan2(z, Math.hypot(x, y)) };
  }

  function moonPosition(day) {
    const node = 125.1228 - 0.0529538083 * day;
    const perihelion = 318.0634 + 0.1643573223 * day;
    const meanAnomaly = normalize(115.3654 + 13.0649929509 * day);
    const base = orbit(node, 5.1454, perihelion, 60.2666, 0.0549, meanAnomaly);
    const sun = sunPosition(day);
    const solarLongitude = sun.meanAnomaly + sun.perihelion;
    const lunarLongitude = meanAnomaly + perihelion + node;
    const elongation = lunarLongitude - solarLongitude;
    const argument = lunarLongitude - node;
    const longitude = base.longitude - 1.274 * sin(meanAnomaly - 2 * elongation) + 0.658 * sin(2 * elongation) - 0.186 * sin(sun.meanAnomaly) - 0.059 * sin(2 * meanAnomaly - 2 * elongation) - 0.057 * sin(meanAnomaly - 2 * elongation + sun.meanAnomaly) + 0.053 * sin(meanAnomaly + 2 * elongation) + 0.046 * sin(2 * elongation - sun.meanAnomaly) + 0.041 * sin(meanAnomaly - sun.meanAnomaly) - 0.035 * sin(elongation) - 0.031 * sin(meanAnomaly + sun.meanAnomaly) - 0.015 * sin(2 * argument - 2 * elongation) + 0.011 * sin(meanAnomaly - 4 * elongation);
    const latitude = base.latitude - 0.173 * sin(argument - 2 * elongation) - 0.055 * sin(meanAnomaly - argument - 2 * elongation) - 0.046 * sin(meanAnomaly + argument - 2 * elongation) + 0.033 * sin(argument + 2 * elongation) + 0.017 * sin(2 * meanAnomaly + argument);
    const radius = base.radius - 0.58 * cos(meanAnomaly - 2 * elongation) - 0.46 * cos(2 * elongation);
    return { longitude: normalize(longitude), latitude, radius };
  }

  function planetPosition(name, day) {
    const [node, inclination, perihelion, axis, eccentricity, meanAnomaly] = ELEMENTS[name](day);
    const planet = orbit(node, inclination, perihelion, axis, eccentricity, normalize(meanAnomaly));
    if (name === "jupiter" || name === "saturn") {
      const jupiterAnomaly = normalize(ELEMENTS.jupiter(day)[5]);
      const saturnAnomaly = normalize(ELEMENTS.saturn(day)[5]);
      if (name === "jupiter") {
        planet.longitude += -0.332 * sin(2 * jupiterAnomaly - 5 * saturnAnomaly - 67.6) - 0.056 * sin(2 * jupiterAnomaly - 2 * saturnAnomaly + 21) + 0.042 * sin(3 * jupiterAnomaly - 5 * saturnAnomaly + 21) - 0.036 * sin(jupiterAnomaly - 2 * saturnAnomaly) + 0.022 * cos(jupiterAnomaly - saturnAnomaly) + 0.023 * sin(2 * jupiterAnomaly - 3 * saturnAnomaly + 52) - 0.016 * sin(jupiterAnomaly - 5 * saturnAnomaly - 69);
      } else {
        planet.longitude += 0.812 * sin(2 * jupiterAnomaly - 5 * saturnAnomaly - 67.6) - 0.229 * cos(2 * jupiterAnomaly - 4 * saturnAnomaly - 2) + 0.119 * sin(jupiterAnomaly - 2 * saturnAnomaly - 3) + 0.046 * sin(2 * jupiterAnomaly - 6 * saturnAnomaly - 69) + 0.014 * sin(jupiterAnomaly - 3 * saturnAnomaly + 32);
        planet.latitude += -0.02 * cos(2 * jupiterAnomaly - 4 * saturnAnomaly - 2) + 0.018 * sin(2 * jupiterAnomaly - 6 * saturnAnomaly - 49);
      }
    }
    const sun = sunPosition(day);
    const xHelio = planet.radius * cos(planet.latitude) * cos(planet.longitude);
    const yHelio = planet.radius * cos(planet.latitude) * sin(planet.longitude);
    const zHelio = planet.radius * sin(planet.latitude);
    const xGeo = xHelio + sun.x;
    const yGeo = yHelio + sun.y;
    const zGeo = zHelio;
    const distance = Math.hypot(xGeo, yGeo, zGeo);
    const phaseAngle = Math.acos(Math.max(-1, Math.min(1, (planet.radius ** 2 + distance ** 2 - sun.radius ** 2) / (2 * planet.radius * distance)))) * DEG;
    const baseMagnitude = { mercury: -0.36, venus: -4.34, mars: -1.51, jupiter: -9.25, saturn: -9 }[name];
    const phase = { mercury: 0.027 * phaseAngle + 2.2e-13 * phaseAngle ** 6, venus: 0.013 * phaseAngle + 4.2e-7 * phaseAngle ** 3, mars: 0.016 * phaseAngle, jupiter: 0.014 * phaseAngle, saturn: 0.044 * phaseAngle }[name];
    return { longitude: normalize(atan2(yGeo, xGeo)), latitude: atan2(zGeo, Math.hypot(xGeo, yGeo)), radius: distance, magnitude: baseMagnitude + 5 * Math.log10(planet.radius * distance) + phase };
  }

  function localSiderealDegrees(day, longitude) {
    const sun = sunPosition(day);
    const utcHour = (day - Math.floor(day)) * 24;
    return normalize(sun.meanAnomaly + sun.perihelion + 180 + utcHour * 15 + longitude);
  }

  function toHorizontal(rightAscension, declination, sidereal, latitude) {
    const hourAngle = sidereal - rightAscension;
    const x = cos(hourAngle) * cos(declination);
    const y = sin(hourAngle) * cos(declination);
    const z = sin(declination);
    const xHorizontal = x * sin(latitude) - z * cos(latitude);
    const zHorizontal = x * cos(latitude) + z * sin(latitude);
    return { altitude: Math.asin(Math.max(-1, Math.min(1, zHorizontal))) * DEG, azimuth: normalize(atan2(y, xHorizontal) + 180) };
  }

  function refraction(altitude) {
    if (altitude < -1.5) return 0;
    return 1.02 / Math.tan((altitude + 10.3 / (altitude + 5.11)) * RAD) / 60;
  }

  function bodyAt(id, milliseconds, latitude, longitude) {
    const day = dayNumber(milliseconds);
    const sidereal = localSiderealDegrees(day, longitude);
    let equatorial;
    let extra = {};
    if (id === "sun") {
      const sun = sunPosition(day);
      equatorial = eclipticToEquatorial(sun.longitude, 0, sun.radius, day);
      extra = { magnitude: -26.7 };
    } else if (id === "moon") {
      const moon = moonPosition(day);
      equatorial = eclipticToEquatorial(moon.longitude, moon.latitude, moon.radius, day);
      const parallax = Math.asin(1 / moon.radius) * DEG;
      const geocentricLatitude = latitude - 0.1924 * sin(2 * latitude);
      const rho = 0.99833 + 0.00167 * cos(2 * latitude);
      const hourAngle = sidereal - equatorial.ra;
      const angle = atan2(Math.tan(geocentricLatitude * RAD), cos(hourAngle));
      const rightAscension = equatorial.ra - parallax * rho * cos(geocentricLatitude) * sin(hourAngle) / cos(equatorial.dec);
      const declination = Math.abs(angle) < 1e-6 ? equatorial.dec - parallax * rho * sin(-equatorial.dec) * cos(hourAngle) : equatorial.dec - parallax * rho * sin(geocentricLatitude) * sin(angle - equatorial.dec) / sin(angle);
      equatorial = { ra: normalize(rightAscension), dec: declination };
      const sun = sunPosition(day);
      const elongation = Math.acos(Math.max(-1, Math.min(1, cos(moon.latitude) * cos(moon.longitude - sun.longitude)))) * DEG;
      const illumination = (1 - cos(elongation)) / 2;
      const age = normalize(moon.longitude - sun.longitude) / 360 * 29.530588;
      extra = { illumination, age, magnitude: -12.7 + 0.026 * (180 - elongation) + 4e-9 * (180 - elongation) ** 4, distanceKm: moon.radius * 6378.14 };
    } else {
      const planet = planetPosition(id, day);
      equatorial = eclipticToEquatorial(planet.longitude, planet.latitude, planet.radius, day);
      extra = { magnitude: planet.magnitude, distanceAu: planet.radius };
    }
    const horizontal = toHorizontal(equatorial.ra, equatorial.dec, sidereal, latitude);
    return { id, ra: equatorial.ra, dec: equatorial.dec, ...horizontal, apparentAltitude: horizontal.altitude + refraction(horizontal.altitude), ...extra };
  }

  function starAt(star, milliseconds, latitude, longitude) {
    const day = dayNumber(milliseconds);
    const sidereal = localSiderealDegrees(day, longitude);
    const rightAscension = star[1] * 15;
    const declination = star[2];
    const obliquity = 23.4393;
    const x = cos(declination) * cos(rightAscension);
    const y = cos(declination) * sin(rightAscension);
    const z = sin(declination);
    const yEcliptic = y * cos(obliquity) + z * sin(obliquity);
    const zEcliptic = -y * sin(obliquity) + z * cos(obliquity);
    const longitudeEcliptic = atan2(yEcliptic, x) + 3.82394e-5 * (day - 1.5);
    const latitudeEcliptic = atan2(zEcliptic, Math.hypot(x, yEcliptic));
    const equatorial = eclipticToEquatorial(longitudeEcliptic, latitudeEcliptic, 1, day);
    return toHorizontal(equatorial.ra, equatorial.dec, sidereal, latitude);
  }

  const eventCache = new Map();

  function riseSet(id, dateText, latitude, longitude) {
    const cacheKey = `${id}|${dateText}|${latitude}|${longitude}`;
    if (eventCache.has(cacheKey)) return eventCache.get(cacheKey);
    const threshold = id === "sun" || id === "moon" ? -0.833 : -0.567;
    const result = { rise: null, set: null, transit: null, maxAltitude: -99 };
    let previous = null;
    for (let minute = 720; minute <= 2160; minute += 5) {
      const position = bodyAt(id, dateMilliseconds(dateText, minute), latitude, longitude);
      if (previous) {
        if (previous.altitude < threshold && position.altitude >= threshold && result.rise === null) result.rise = previous.minute + 5 * (threshold - previous.altitude) / (position.altitude - previous.altitude);
        if (previous.altitude >= threshold && position.altitude < threshold && result.set === null) result.set = previous.minute + 5 * (threshold - previous.altitude) / (position.altitude - previous.altitude);
      }
      if (position.altitude > result.maxAltitude) {
        result.maxAltitude = position.altitude;
        result.transit = minute;
      }
      previous = { altitude: position.altitude, minute };
    }
    eventCache.set(cacheKey, result);
    return result;
  }

  function twilightEnd(dateText, latitude, longitude, altitude) {
    let previous = null;
    for (let minute = 900; minute <= 1500; minute += 2) {
      const current = bodyAt("sun", dateMilliseconds(dateText, minute), latitude, longitude).altitude;
      if (previous !== null && previous >= altitude && current < altitude) return minute - 2 + 2 * (altitude - previous) / (current - previous);
      previous = current;
    }
    return null;
  }

  function moonPhaseName(age) {
    if (age < 1.5 || age > 28) return "삭";
    if (age < 6.4) return "초승달";
    if (age < 8.4) return "상현달";
    if (age < 13.8) return "차가는 달";
    if (age < 15.8) return "보름달";
    if (age < 21.2) return "기우는 달";
    if (age < 23.2) return "하현달";
    return "그믐달";
  }

  window.Astro = Object.freeze({
    bodyAt,
    dateMilliseconds,
    moonPhaseName,
    normalize,
    refraction,
    riseSet,
    starAt,
    twilightEnd
  });
})();
