import type { Components } from "react-markdown";
import {
  Children,
  isValidElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";

type CopyState = "idle" | "copying" | "copied" | "failed";

interface MarkdownContentProps {
  markdown: string;
  className?: string;
  codeActionsEnabled?: boolean;
}

export function MarkdownContent({
  markdown,
  className,
  codeActionsEnabled = true,
}: MarkdownContentProps) {
  const { t } = useTranslation();
  const safeComponents = useMemo<Components>(
    () => ({
      a({ children }) {
        return (
          <span
            className="markdown-link"
            role="note"
            aria-label={t("markdown.externalLinkDisabled")}
            title={t("markdown.externalLinkHelp")}
          >
            {children}
            <span aria-hidden="true"> ↗</span>
          </span>
        );
      },
      img({ alt }) {
        const description =
          alt?.trim() || t("markdown.missingImageDescription");
        return (
          <span
            className="markdown-image-placeholder"
            role="note"
            aria-label={t("markdown.remoteImageBlocked", { description })}
          >
            {t("markdown.imageBlocked", { description })}
          </span>
        );
      },
      pre({ children }) {
        const codeElement = Children.toArray(children).find(isValidElement);
        if (!codeElement) return <pre>{children}</pre>;
        const codeProps = codeElement.props as {
          children?: ReactNode;
          className?: string;
        };
        return (
          <MarkdownCodeBlock
            actionsEnabled={codeActionsEnabled}
            code={textContent(codeProps.children).replace(/\n$/, "")}
            language={normalizedLanguage(codeProps.className)}
          >
            {codeElement}
          </MarkdownCodeBlock>
        );
      },
    }),
    [codeActionsEnabled, t],
  );
  const classes = ["markdown-content", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <ReactMarkdown
        components={safeComponents}
        rehypePlugins={[rehypeHighlight]}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownCodeBlock({
  actionsEnabled,
  children,
  code,
  language,
}: {
  actionsEnabled: boolean;
  children: ReactNode;
  code: string;
  language: "ts" | "json" | "bash" | null;
}) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const handleCopy = async () => {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
    }
    resetTimer.current = window.setTimeout(() => {
      setCopyState("idle");
      resetTimer.current = null;
    }, 1_600);
  };

  const copyLabel =
    copyState === "copied"
      ? t("markdown.copiedCode")
      : copyState === "failed"
        ? t("markdown.copyCodeFailed")
        : t("markdown.copyCode");

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span data-language={language ?? "code"}>
          {language ?? t("markdown.codeLabel")}
        </span>
        {actionsEnabled && (
          <button
            type="button"
            aria-live="polite"
            disabled={copyState === "copying"}
            onClick={handleCopy}
          >
            {copyLabel}
          </button>
        )}
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function normalizedLanguage(
  className: string | undefined,
): "ts" | "json" | "bash" | null {
  const language = className
    ?.split(/\s+/)
    .find((value) => value.startsWith("language-"))
    ?.slice("language-".length)
    .toLocaleLowerCase();
  if (language === "ts" || language === "typescript") return "ts";
  if (language === "json") return "json";
  if (
    language === "bash" ||
    language === "sh" ||
    language === "shell" ||
    language === "zsh"
  ) {
    return "bash";
  }
  return null;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textContent(node.props.children);
  }
  return "";
}
