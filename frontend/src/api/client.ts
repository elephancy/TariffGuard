import { mockAlerts, mockAudit, mockOperators, mockOverview, mockSessions, mockTariffs, mockTariffVersions } from "../data/mockData";
import type { AlertRecord, AuditSummary, CreatedOperator, Operator, Overview, SessionPage, SessionRow, TariffListItem, TariffVersion } from "./types";
import { authExpiredEvent, getAccessToken } from "../auth";

const useMocks = import.meta.env.VITE_USE_MOCKS === "true" || !import.meta.env.VITE_API_BASE_URL;
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

export async function getOverview(date: string): Promise<Overview> {
  if (useMocks) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    return mockOverview;
  }
  const response = await authorizedFetch(`${apiBaseUrl}/overview?date=${date}`);
  if (!response.ok) {
    throw new Error(`Overview request failed with ${response.status}`);
  }
  return response.json() as Promise<Overview>;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await authorizedFetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function authorizedFetch(url: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getAccessToken();
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    window.dispatchEvent(new Event(authExpiredEvent));
    throw new Error("Your session has expired. Sign in again.");
  }
  if (response.status === 429) {
    throw new Error("The API request limit was reached. Please retry shortly.");
  }
  return response;
}

async function sendJson<T>(path: string, body: unknown): Promise<T> {
  const response = await authorizedFetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getSessions(cursor?: string, status?: string, limit = 100, search = ""): Promise<SessionPage> {
  if (useMocks) {
    await delay();
    const normalized = search.trim().toLowerCase();
    const statusFiltered = status && status !== "ALL"
      ? mockSessions.filter((item) => item.status === status)
      : mockSessions;
    const sessions = normalized
      ? statusFiltered.filter((item) => [item.sessionId, item.chargerId, item.userId].some((value) => value.toLowerCase().includes(normalized)))
      : statusFiltered;
    const offset = cursor ? Number(cursor) || 0 : 0;
    const nextOffset = offset + limit;
    return {
      sessions: sessions.slice(offset, nextOffset),
      nextCursor: nextOffset < sessions.length ? String(nextOffset) : null,
      total: sessions.length,
      stats: {
        total: sessions.length,
        attention: sessions.filter((item) => item.status === "FLAGGED" || item.status === "REJECTED").length,
        estimatedRevenue: sessions.reduce((sum, item) => sum + Number(item.price?.displayTotal ?? 0), 0).toFixed(2),
      },
    };
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (status && status !== "ALL") params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  return getJson<SessionPage>(`/sessions?${params}`);
}

export async function getSession(sessionId: string): Promise<SessionRow> {
  if (useMocks) {
    await delay();
    const session = mockSessions.find((item) => item.sessionId === sessionId);
    if (!session) throw new Error("Session not found");
    return session;
  }
  return getJson<SessionRow>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function getTariffs(): Promise<TariffListItem[]> {
  if (useMocks) {
    await delay();
    return mockTariffs;
  }
  const result = await getJson<{ tariffs: TariffListItem[] }>("/tariffs");
  return result.tariffs;
}

export async function getTariffVersions(tariffId: string): Promise<TariffVersion[]> {
  if (useMocks) {
    await delay();
    return mockTariffVersions[tariffId] ?? [];
  }
  const result = await getJson<{ versions: TariffVersion[] }>(`/tariffs/${encodeURIComponent(tariffId)}/versions`);
  return result.versions;
}

export async function createTariff(tariff: TariffVersion): Promise<TariffVersion> {
  if (useMocks) {
    await delay();
    return tariff;
  }
  return sendJson<TariffVersion>("/tariffs", tariff);
}

export async function invalidateSession(sessionId: string, reason: string): Promise<SessionRow> {
  if (useMocks) {
    await delay();
    const session = await getSession(sessionId);
    return { ...session, status: "INVALIDATED", validationFlags: [...(session.validationFlags ?? []), { code: "MANUALLY_INVALIDATED", severity: "LOW", message: reason }] };
  }
  return sendJson<SessionRow>(`/sessions/${encodeURIComponent(sessionId)}/invalidate`, { reason });
}

export async function getOperators(): Promise<Operator[]> {
  if (useMocks) {
    await delay();
    return mockOperators;
  }
  const result = await getJson<{ users: Operator[] }>("/admin/users");
  return result.users;
}

export async function createOperator(email: string, role: "operator" | "admin"): Promise<CreatedOperator> {
  if (useMocks) {
    await delay();
    return { username: `mock-${Date.now()}`, email, role, temporaryPassword: "Demo-Temporary9!" };
  }
  return sendJson<CreatedOperator>("/admin/users", { email, role });
}

export async function setOperatorEnabled(username: string, enabled: boolean): Promise<void> {
  if (useMocks) {
    await delay();
    return;
  }
  await sendJson(`/admin/users/${encodeURIComponent(username)}/status`, { enabled });
}

export async function getAlerts(date: string): Promise<AlertRecord[]> {
  if (useMocks) {
    await delay();
    return mockAlerts;
  }
  const result = await getJson<{ alerts: AlertRecord[] }>(`/alerts?date=${encodeURIComponent(date)}`);
  return result.alerts;
}

export async function getAudit(date: string): Promise<AuditSummary> {
  if (useMocks) {
    await delay();
    return { ...mockAudit, date };
  }
  return getJson<AuditSummary>(`/audit/daily?date=${encodeURIComponent(date)}`);
}

function delay() {
  return new Promise((resolve) => window.setTimeout(resolve, 180));
}
