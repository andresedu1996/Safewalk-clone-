const EARTH_RADIUS_M = 6371000;

export function haversineDistance(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function nearestDistanceToRoute(position, routePoints) {
  if (!routePoints.length) return Number.POSITIVE_INFINITY;

  let min = Number.POSITIVE_INFINITY;
  for (const point of routePoints) {
    const d = haversineDistance(position, point);
    if (d < min) min = d;
  }

  return min;
}

export function formatCoord(value) {
  return value.toFixed(5);
}

export function formatTime(date) {
  return date.toLocaleTimeString("es-GT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}