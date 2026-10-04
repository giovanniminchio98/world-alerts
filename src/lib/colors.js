// Map colours. Severity is always also communicated by size, icons or text.
export const HINT_COLORS = {
  blue: '#6f8fb3',
  yellow: '#d9a900',
  orange: '#e8711a',
  red: '#cf3434',
  green: '#2f9a5c',
  gray: '#8a94a3',
};

export const colorFor = (hint) => HINT_COLORS[hint] || HINT_COLORS.gray;

export const FIRE_COLORS = {
  strong: '#d4421c', // high confidence and recent (< 24 h)
  medium: '#ef8a2c', // nominal confidence or 24–48 h old
  weak: '#efc76f', //   low confidence or older than 48 h
};

export function fireColorKey(confidence, ageMinutes) {
  if (confidence === 0 || ageMinutes > 2880) return 'weak';
  if (confidence === 2 && ageMinutes <= 1440) return 'strong';
  return 'medium';
}
