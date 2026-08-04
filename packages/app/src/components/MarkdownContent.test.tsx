// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders GFM structure and highlights fenced code", () => {
    const { container } = render(
      <MarkdownContent
        markdown={[
          "# Release gate",
          "",
          "- preserve context",
          "- verify output",
          "",
          "| Gate | State |",
          "| --- | --- |",
          "| Build | ~~pending~~ passed |",
          "",
          "```ts",
          "const ready = true;",
          "```",
        ].join("\n")}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Release gate" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("pending").tagName).toBe("DEL");
    expect(container.querySelector(".hljs-keyword")).toHaveTextContent("const");
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("blocks raw HTML, remote images, and in-webview links", () => {
    const { container } = render(
      <MarkdownContent
        markdown={[
          '<script data-secret="true">alert("no")</script>',
          '<img src="https://tracker.invalid/raw.png" alt="raw tracker">',
          "![diagram](https://tracker.invalid/diagram.png)",
          "[Open external docs](https://example.com/docs)",
        ].join("\n\n")}
      />,
    );

    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("a")).not.toBeInTheDocument();
    expect(container.querySelector("[src]")).not.toBeInTheDocument();
    expect(container.querySelector("[href]")).not.toBeInTheDocument();
    expect(screen.getByText("圖片已封鎖：diagram")).toBeInTheDocument();
    expect(screen.getByText(/Open external docs/)).toBeInTheDocument();
    expect(
      screen.getByRole("note", { name: "外部連結已停用" }),
    ).toBeInTheDocument();
  });

  it("copies the exact highlighted fenced-code text and confirms completion", async () => {
    const code = ["const nested = {", "  ready: true,", "};", ""].join("\n");
    render(
      <MarkdownContent markdown={["```typescript", code, "```"].join("\n")} />,
    );

    const copy = screen.getByRole("button", { name: "複製程式碼" });
    copy.focus();
    fireEvent.keyDown(copy, { key: "Enter" });
    fireEvent.click(copy);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code),
    );
    expect(copy).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "已複製" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("uses localized code fallback labels for unknown or missing languages", () => {
    render(
      <MarkdownContent
        markdown={["```ruby", "puts 'ready'", "```", "", "```", "plain", "```"].join(
          "\n",
        )}
      />,
    );

    expect(screen.getAllByText("程式碼")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "複製程式碼" }),
    ).toHaveLength(2);
  });

  it("reports clipboard failures without changing the rendered code", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("denied"),
    );
    const { container } = render(
      <MarkdownContent markdown={"```json\n{\"ready\":true}\n```"} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "複製程式碼" }));

    expect(
      await screen.findByRole("button", { name: "無法複製程式碼" }),
    ).toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent(
      '{"ready":true}',
    );
    expect(screen.getByText("json")).toBeInTheDocument();
  });

  it("clears copied-state timers when a code block unmounts", async () => {
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const { unmount } = render(
      <MarkdownContent markdown={"```bash\npnpm test\n```"} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "複製程式碼" }));
    await screen.findByRole("button", { name: "已複製" });
    unmount();

    expect(clearTimeout).toHaveBeenCalled();
    clearTimeout.mockRestore();
  });
});
