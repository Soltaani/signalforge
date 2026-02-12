const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'source',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
]);

export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.toLowerCase().trim();
  }

  // Upgrade http to https
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
  }

  // Lowercase hostname
  url.hostname = url.hostname.toLowerCase();

  // Strip tracking params
  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param.toLowerCase())) {
      url.searchParams.delete(param);
    }
  }

  // Sort remaining params for determinism
  url.searchParams.sort();

  // Strip trailing slash from pathname
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  // Strip fragment
  url.hash = '';

  return url.toString();
}
