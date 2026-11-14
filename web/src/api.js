async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    // The API answers a plain "Not found" for a route the running server doesn't have: usually a plugin added in an
    // update while the old server process is still running.
    if (res.status === 404 && path.startsWith('/plugins/') && data?.error === 'Not found') {
      throw new Error('The dashboard server doesn’t know this plugin yet - restart the server (and rebuild the web app) after updating.');
    }
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
};
