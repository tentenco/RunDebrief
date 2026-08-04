import { useCallback, useEffect, useRef, useState } from "react";
import { reportRuntimeError } from "../data/runtime-diagnostics";
import i18n from "../i18n";
import { withTimeout } from "../lib/timeout";
import type { DashboardRepository, RuntimeStatus } from "../types";

const STATUS_POLL_INTERVAL_MS = 10_000;
const STATUS_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 75_000;

export function useRuntimeStatus(
  repository: DashboardRepository | null,
) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"status" | "install" | "settings" | null>(
    null,
  );
  const statusPromiseRef = useRef<Promise<RuntimeStatus | null> | null>(null);

  const refresh = useCallback((): Promise<RuntimeStatus | null> => {
    if (!repository) return Promise.resolve(null);
    if (statusPromiseRef.current) return statusPromiseRef.current;

    const pending = (async () => {
      try {
        setBusy((current) => current ?? "status");
        const next = await withTimeout(
          repository.loadRuntimeStatus(),
          STATUS_TIMEOUT_MS,
          i18n.t("errors.runtimeStatusTimeout"),
        );
        setStatus(next);
        setServiceError(null);
        return next;
      } catch (caught) {
        reportRuntimeError(caught);
        setServiceError(messageFrom(caught));
        return null;
      } finally {
        setBusy((current) => (current === "status" ? null : current));
      }
    })();
    statusPromiseRef.current = pending;
    void pending.finally(() => {
      if (statusPromiseRef.current === pending) {
        statusPromiseRef.current = null;
      }
    });
    return pending;
  }, [repository]);

  const install = useCallback(async (): Promise<boolean> => {
    if (!repository) return false;
    try {
      setBusy("install");
      const next = await withTimeout(
        repository.installDaemon(),
        INSTALL_TIMEOUT_MS,
        i18n.t("errors.daemonStartTimeout"),
      );
      setStatus(next);
      if (!next.daemon.running) {
        throw new Error(i18n.t("errors.daemonNotRunning"));
      }
      setServiceError(null);
      return true;
    } catch (caught) {
      reportRuntimeError(caught);
      setServiceError(messageFrom(caught));
      return false;
    } finally {
      setBusy(null);
    }
  }, [repository]);

  const openPrivacySecurity = useCallback(async (): Promise<boolean> => {
    if (!repository) return false;
    try {
      setBusy("settings");
      await withTimeout(
        repository.openPrivacySecurity(),
        STATUS_TIMEOUT_MS,
        i18n.t("errors.privacyTimeout"),
      );
      setPrivacyError(null);
      return true;
    } catch (caught) {
      reportRuntimeError(caught);
      setPrivacyError(messageFrom(caught));
      return false;
    } finally {
      setBusy(null);
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(
      () => void refresh(),
      STATUS_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [refresh]);

  return {
    status,
    serviceError,
    privacyError,
    busy,
    refresh,
    install,
    openPrivacySecurity,
  };
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
