export const MAX_DECIMAL_PLACES = 2;

const decimal = new Intl.NumberFormat('en-US', {
  useGrouping:false,
  maximumFractionDigits:MAX_DECIMAL_PLACES
});

export function formatDecimal(value) {
  if (value == null) return '';
  if (!Number.isFinite(value)) return String(value);
  const formatted = decimal.format(value);
  return formatted === '-0' ? '0' : formatted;
}

export function decimalInputValue(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return value;
  const match = String(value).match(/^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))([eE][+-]?\d+)?$/);
  if (!match || !Number.isFinite(Number(value))) return value;
  return match[3] || (match[1]??match[2]??'').length > MAX_DECIMAL_PLACES
    ? formatDecimal(Number(value))
    : value;
}
