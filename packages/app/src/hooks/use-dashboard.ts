import { useCallback, useEffect, useRef, useState } from "react";
import { reportRuntimeError } from "../data/runtime-diagnostics";
import i18n from "../i18n";
import { withTimeout } from "../lib/timeout";
import type {
  DashboardRepository,
  DashboardSnapshot,
  ProjectDetail,
  ProjectPatch,
  SessionTurnLogState,
} from "../types";

const POLL_INTERVAL_MS = 5_000;
export const INDEX_QUERY_TIMEOUT_MS = 5_000;
const TURN_LOG_TIMEOUT_MS = 30_000;
const TURN_LOG_CACHE_LIMIT = 5;
const IDLE_TURN_LOG: SessionTurnLogState = {
  status: "idle",
  page: null,
  error: null,
};

export function useDashboard(repository: DashboardRepository | null) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [turnLogs, setTurnLogs] = useState<
    ReadonlyMap<number, SessionTurnLogState>
  >(new Map());
  const selectedRef = useRef<number | null>(null);
  const snapshotRef = useRef<DashboardSnapshot | null>(null);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const turnLogScopeRef = useRef(0);
  const turnLogRequestsRef = useRef(new Map<number, Promise<void>>());
  const turnLogsRef = useRef<ReadonlyMap<number, SessionTurnLogState>>(
    new Map(),
  );
  selectedRef.current = selectedProjectId;
  snapshotRef.current = snapshot;
  turnLogsRef.current = turnLogs;

  const loadTurnLog = useCallback(
    (sessionId: number, scope = turnLogScopeRef.current): Promise<void> => {
      if (!repository) return Promise.resolve();
      const existing = turnLogRequestsRef.current.get(sessionId);
      if (existing) return existing;

      const pending = (async () => {
        if (scope === turnLogScopeRef.current) {
          setTurnLogs((current) =>
            withTurnLogState(current, sessionId, {
              status: "loading",
              page: current.get(sessionId)?.page ?? null,
              error: null,
            }),
          );
        }
        try {
          const page = await withTimeout(
            repository.loadSessionTurnLog(sessionId, 20),
            TURN_LOG_TIMEOUT_MS,
            i18n.t("errors.turnLogTimeout"),
          );
          if (scope === turnLogScopeRef.current) {
            setTurnLogs((current) =>
              withTurnLogState(current, sessionId, {
                status: "ready",
                page,
                error: null,
              }),
            );
          }
        } catch (caught) {
          reportRuntimeError(caught);
          if (scope === turnLogScopeRef.current) {
            setTurnLogs((current) =>
              withTurnLogState(current, sessionId, {
                status: "error",
                page: null,
                error: messageFrom(caught),
              }),
            );
          }
        }
      })();
      turnLogRequestsRef.current.set(sessionId, pending);
      void pending.finally(() => {
        if (turnLogRequestsRef.current.get(sessionId) === pending) {
          turnLogRequestsRef.current.delete(sessionId);
        }
      });
      return pending;
    },
    [repository],
  );

  const refresh = useCallback((): Promise<boolean> => {
    if (!repository) return Promise.resolve(false);
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const pending = (async () => {
      try {
        const nextSnapshot = await withTimeout(
          repository.loadSnapshot(),
          INDEX_QUERY_TIMEOUT_MS,
          i18n.t("errors.indexTimeout"),
        );
        setSnapshot(nextSnapshot);
        const selected = selectedRef.current;
        if (selected !== null) {
          const nextDetail = await withTimeout(
            repository.loadProjectDetail(selected),
            INDEX_QUERY_TIMEOUT_MS,
            i18n.t("errors.detailRefreshTimeout"),
          );
          setDetail(nextDetail);
          const latestSession = nextDetail.sessions[0];
          if (latestSession && !turnLogsRef.current.has(latestSession.id)) {
            void loadTurnLog(latestSession.id);
          }
        }
        setError(null);
        return true;
      } catch (caught) {
        reportRuntimeError(caught);
        setError(messageFrom(caught));
        return false;
      }
    })();
    refreshPromiseRef.current = pending;
    void pending.finally(() => {
      if (refreshPromiseRef.current === pending) {
        refreshPromiseRef.current = null;
      }
    });
    return pending;
  }, [loadTurnLog, repository]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (snapshotRef.current) void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectProject = useCallback(
    async (projectId: number | null) => {
      const scope = turnLogScopeRef.current + 1;
      turnLogScopeRef.current = scope;
      turnLogRequestsRef.current.clear();
      setTurnLogs(new Map());
      setSelectedProjectId(projectId);
      if (projectId === null || !repository) {
        setDetail(null);
        return;
      }
      try {
        setBusy(`detail:${projectId}`);
        const nextDetail = await withTimeout(
          repository.loadProjectDetail(projectId),
          INDEX_QUERY_TIMEOUT_MS,
          i18n.t("errors.detailTimeout"),
        );
        setDetail(nextDetail);
        const latestSession = nextDetail.sessions[0];
        if (latestSession) void loadTurnLog(latestSession.id, scope);
        setError(null);
      } catch (caught) {
        reportRuntimeError(caught);
        setError(messageFrom(caught));
      } finally {
        setBusy(null);
      }
    },
    [loadTurnLog, repository],
  );

  const updateProject = useCallback(
    async (projectId: number, patch: ProjectPatch) => {
      if (!repository) return;
      try {
        setBusy(`project:${projectId}`);
        await repository.updateProject(projectId, patch);
        await refresh();
      } catch (caught) {
        reportRuntimeError(caught);
        setError(messageFrom(caught));
      } finally {
        setBusy(null);
      }
    },
    [refresh, repository],
  );

  const acknowledge = useCallback(
    async (summaryId: number) => {
      if (!repository) return;
      try {
        setBusy(`summary:${summaryId}`);
        await repository.setAcknowledged(summaryId, true);
        await refresh();
      } catch (caught) {
        reportRuntimeError(caught);
        setError(messageFrom(caught));
      } finally {
        setBusy(null);
      }
    },
    [refresh, repository],
  );

  return {
    snapshot,
    detail,
    selectedProjectId,
    error,
    busy,
    turnLogs,
    refresh,
    selectProject,
    loadTurnLog,
    updateProject,
    acknowledge,
  };
}

export function idleTurnLogState(): SessionTurnLogState {
  return IDLE_TURN_LOG;
}

function withTurnLogState(
  current: ReadonlyMap<number, SessionTurnLogState>,
  sessionId: number,
  state: SessionTurnLogState,
): ReadonlyMap<number, SessionTurnLogState> {
  const next = new Map(current);
  next.delete(sessionId);
  next.set(sessionId, state);
  while (next.size > TURN_LOG_CACHE_LIMIT) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
