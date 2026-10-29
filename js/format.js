/* Number formatting helpers - Indian system (lakh / crore) */
const LAKH = 1e5, CRORE = 1e7;

/** ₹ amount in lakh/crore: 4,52,30,000 -> "₹4.52 Cr", 2,35,000 -> "₹2.35 L" */
function inr(v, digits = 2) {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= CRORE) return `${s}₹${(a / CRORE).toFixed(digits)} Cr`;
  if (a >= LAKH) return `${s}₹${(a / LAKH).toFixed(digits)} L`;
  return `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
}
/** compact ₹ for chart axes */
const inrAxis = v => inr(v, 1);
/** integer with Indian digit grouping: 1234567 -> "12,34,567" */
const num = v => Math.round(v).toLocaleString("en-IN");
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
