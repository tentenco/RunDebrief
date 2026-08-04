// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixtureRepository } from "../test/fixtures";
import { useRuntimeStatus } from "./use-runtime-status";

describe("useRuntimeStatus error channels", () => {
  it("keeps service and privacy failures isolated and clears only the successful channel", async () => {
    const repository = new FixtureRepository();
    const originalStatus = repository.loadRuntimeStatus.bind(repository);
    const originalPrivacy = repository.openPrivacySecurity.bind(repository);
    const { result } = renderHook(() => useRuntimeStatus(repository));

    await waitFor(() => expect(result.current.status).not.toBeNull());
    await waitFor(() => expect(result.current.busy).toBeNull());

    repository.loadRuntimeStatus = async () => {
      throw new Error("service unavailable");
    };
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.serviceError).toBe("service unavailable");
    expect(result.current.privacyError).toBeNull();
    expect(result.current.status?.daemon.running).toBe(true);

    repository.openPrivacySecurity = async () => {
      throw new Error("privacy unavailable");
    };
    await act(async () => {
      await result.current.openPrivacySecurity();
    });
    expect(result.current.serviceError).toBe("service unavailable");
    expect(result.current.privacyError).toBe("privacy unavailable");

    repository.loadRuntimeStatus = originalStatus;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.serviceError).toBeNull();
    expect(result.current.privacyError).toBe("privacy unavailable");

    repository.openPrivacySecurity = originalPrivacy;
    await act(async () => {
      await result.current.openPrivacySecurity();
    });
    expect(result.current.serviceError).toBeNull();
    expect(result.current.privacyError).toBeNull();
  });

  it("routes daemon install failures to the service channel only", async () => {
    const repository = new FixtureRepository();
    repository.installDaemon = async () => {
      throw new Error("install unavailable");
    };
    const { result } = renderHook(() => useRuntimeStatus(repository));

    await waitFor(() => expect(result.current.status).not.toBeNull());
    await act(async () => {
      await result.current.install();
    });

    expect(result.current.serviceError).toBe("install unavailable");
    expect(result.current.privacyError).toBeNull();
  });
});
