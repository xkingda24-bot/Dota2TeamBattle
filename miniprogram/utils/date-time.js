function formatDateTime(value) {
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? (numeric > 0 && numeric < 1e11 ? numeric * 1000 : numeric)
    : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  const pad = (part) => String(part).padStart(2, '0');
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

module.exports = { formatDateTime };
