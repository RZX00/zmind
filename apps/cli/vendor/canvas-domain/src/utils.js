function nowIso(nowProvider) {
  const now = typeof nowProvider === 'function' ? nowProvider() : new Date();
  return now.toISOString();
}

function deepMerge(target, patch) {
  if (!isObject(target) || !isObject(patch)) {
    return patch;
  }

  const merged = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      merged[key] = value.slice();
      continue;
    }
    if (isObject(value) && isObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  nowIso,
  deepMerge,
  isObject,
};
