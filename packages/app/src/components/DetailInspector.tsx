import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  clampDetailWidth,
  DETAIL_WIDTH_DEFAULT,
  DETAIL_WIDTH_MIN,
  DETAIL_WIDTH_STEP,
  detailWidthMaximum,
  readDetailWidth,
  writeDetailWidth,
} from "../lib/view-preferences";

interface DetailInspectorProps {
  sidebarVisible: boolean;
  children: ReactNode;
}

interface DragOrigin {
  clientX: number;
  width: number;
}

export function DetailInspector({
  sidebarVisible,
  children,
}: DetailInspectorProps) {
  const { t } = useTranslation();
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [width, setWidth] = useState(() =>
    readDetailWidth(
      window.localStorage,
      window.innerWidth,
      sidebarVisible,
    ),
  );
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<DragOrigin | null>(null);
  const maximum = useMemo(
    () => detailWidthMaximum(viewportWidth, sidebarVisible),
    [sidebarVisible, viewportWidth],
  );
  const setClampedWidth = useCallback(
    (nextWidth: number) => {
      setWidth(clampDetailWidth(nextWidth, viewportWidth, sidebarVisible));
    },
    [sidebarVisible, viewportWidth],
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setWidth((current) =>
      clampDetailWidth(current, viewportWidth, sidebarVisible),
    );
  }, [sidebarVisible, viewportWidth]);

  useEffect(() => {
    writeDetailWidth(window.localStorage, width);
  }, [width]);

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("is-resizing-detail");
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const origin = dragOrigin.current;
      if (!origin) return;
      setClampedWidth(origin.width + origin.clientX - event.clientX);
    };
    const stopDragging = () => {
      dragOrigin.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      document.body.classList.remove("is-resizing-detail");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging, setClampedWidth]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    document.body.classList.add("is-resizing-detail");
    dragOrigin.current = {
      clientX: event.clientX,
      width,
    };
    setDragging(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = width + DETAIL_WIDTH_STEP;
    if (event.key === "ArrowRight") nextWidth = width - DETAIL_WIDTH_STEP;
    if (event.key === "Home") nextWidth = DETAIL_WIDTH_MIN;
    if (event.key === "End") nextWidth = maximum;
    if (nextWidth === null) return;
    event.preventDefault();
    setClampedWidth(nextWidth);
  };

  const resetWidth = () => setClampedWidth(DETAIL_WIDTH_DEFAULT);

  return (
    <div
      className="detail-inspector"
      data-resizing={dragging}
      style={
        {
          "--detail-current-width": `${width}px`,
        } as CSSProperties
      }
    >
      <div
        className="detail-resizer"
        role="separator"
        tabIndex={0}
        aria-label={t("inspector.resize")}
        aria-orientation="vertical"
        aria-valuemin={DETAIL_WIDTH_MIN}
        aria-valuemax={maximum}
        aria-valuenow={width}
        aria-valuetext={t("inspector.pixels", { width })}
        title={t("inspector.resizeHelp")}
        onDoubleClick={resetWidth}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
      />
      {children}
    </div>
  );
}
