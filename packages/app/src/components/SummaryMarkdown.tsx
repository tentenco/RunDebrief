import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  presentSummaryState,
  shouldCollapseSummary,
} from "../lib/summary-presentation";
import type { Summary } from "../types";
import { MarkdownContent } from "./MarkdownContent";

interface SummaryMarkdownProps {
  summary: Summary;
  className?: string;
}

export function SummaryMarkdown({
  summary,
  className,
}: SummaryMarkdownProps) {
  const { t } = useTranslation();
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const presented = presentSummaryState(summary);
  const markdown =
    presented ?? t("detail.structuredSummaryUnavailable");
  const collapsible = presented !== null && shouldCollapseSummary(markdown);
  const classes = ["summary-disclosure", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div
        id={contentId}
        ref={contentRef}
        className={[
          "summary-preview",
          collapsible && !expanded ? "is-collapsed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <MarkdownContent
          codeActionsEnabled={!collapsible || expanded}
          className="summary-markdown"
          markdown={markdown}
        />
      </div>
      {collapsible && (
        <button
          className="summary-toggle"
          type="button"
          ref={toggleRef}
          aria-controls={contentId}
          aria-expanded={expanded}
          onClick={() => {
            if (
              expanded &&
              contentRef.current?.contains(document.activeElement)
            ) {
              toggleRef.current?.focus();
            }
            setExpanded((current) => !current);
          }}
        >
          {expanded ? t("detail.showLess") : t("detail.showMore")}
        </button>
      )}
    </div>
  );
}
