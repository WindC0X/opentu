export function isEmbeddedInNewApi(location: Location = window.location): boolean {
  const pathname = location.pathname || '';
  return pathname === '/creative' || pathname.startsWith('/creative/');
}
