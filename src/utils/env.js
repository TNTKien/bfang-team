const parseEnvBoolean = (value, defaultValue = false) => {
  if (value == null) return Boolean(defaultValue);
  const raw = String(value).trim().toLowerCase();
  if (!raw) return Boolean(defaultValue);
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return Boolean(defaultValue);
};

module.exports = {
  parseEnvBoolean
};
