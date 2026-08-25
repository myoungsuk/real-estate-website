import { handleAdminApi } from "./admin-api.mjs";

export function isAdminApiPath(pathname) {
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (isAdminApiPath(url.pathname)) {
    return handleAdminApi(request, env);
  }

  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return new Response("Static asset binding is unavailable.", { status: 503 });
  }
  return env.ASSETS.fetch(request);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
