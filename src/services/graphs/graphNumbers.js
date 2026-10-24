const decimal = new Intl.NumberFormat("ru-RU", { useGrouping: false, maximumSignificantDigits: 10 });
const scientific = new Intl.NumberFormat("ru-RU", {
  useGrouping: false, notation: "scientific", maximumSignificantDigits: 10,
});

// Each label carries its complete value. In particular, 5000 must never look
// like the Russian decimal number 5,000 because of browser-locale grouping.
export function formatGraphNumber(value) {
  if (!Number.isFinite(value)) return "";
  const magnitude = Math.abs(value);
  return (magnitude !== 0 && (magnitude < 1e-6 || magnitude >= 1e9) ? scientific : decimal).format(value);
}
