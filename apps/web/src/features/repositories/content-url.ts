// Never accept an absolute, protocol-relative, or escaped-host URL from source content.
export function contentUrl(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020]/.test(path))
    return undefined;
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.startsWith('//') || /[\\\u0000-\u0020]/.test(decoded)) return undefined;
    const url = new URL(path, 'https://github.com');
    return url.origin === 'https://github.com' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
