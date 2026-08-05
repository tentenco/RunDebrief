#!/usr/bin/env python3
"""Audit release locales and capture privacy-safe public screenshots.

Run this against @debrief/app with VITE_DEBRIEF_DEMO=1. The script only uses
the app's built-in synthetic demo repository and writes 1280x800 PNG assets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright


VIEWPORT = {"width": 1280, "height": 800}
LOCALE_HEADINGS = {
    "en": "Handoff Overview",
    "zh-Hant": "接手總覽",
    "zh-CN": "交接总览",
}
SETTINGS_HEADINGS = {
    "en": "Settings",
    "zh-Hant": "設定",
    "zh-CN": "设置",
}
LOCALE_VALUES = ["en", "zh-Hant", "zh-CN"]
LOCALE_LABELS = {
    "en": ["English", "繁體中文", "简体中文"],
    "zh-Hant": ["English", "繁體中文", "简体中文"],
    "zh-CN": ["English", "繁体中文", "简体中文"],
}
TRADITIONAL_ONLY = re.compile(
    r"[專設儲開載選尋導覽執機檢應隱權介檔資庫錄連線獲讀偵測複製調曳雙擊鎖碼覆體餘驗證與]"
)
CJK = re.compile(r"[\u3400-\u9fff]")
USER_PATH = re.compile(r"/Users/[^/\s<>'\"]+")
FORBIDDEN_PRIVATE_MARKERS = (
    "ekc-m5max",
    "Claude-Code-Local",
    "gatewayKey",
    "summaryModel",
    "sk-",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:1420")
    parser.add_argument(
        "--chrome",
        default="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def axe_path(root: Path) -> Path:
    matches = sorted(
        root.glob(
            "node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js"
        )
    )
    if not matches:
        raise AssertionError("axe-core runtime was not found under node_modules/.pnpm")
    return matches[-1]


def new_context(browser: Browser, locale: str = "en-US") -> BrowserContext:
    return browser.new_context(
        viewport=VIEWPORT,
        device_scale_factor=1,
        locale=locale,
        color_scheme="light",
    )


def settle(page: Page, heading: str) -> None:
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name=heading, level=1, exact=True).wait_for(
        state="visible"
    )
    page.evaluate("() => document.fonts.ready")
    page.emulate_media(reduced_motion="reduce", color_scheme="light")
    page.add_style_tag(
        content="""
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            caret-color: transparent !important;
          }
        """
    )


def html_locale(page: Page) -> str:
    return page.evaluate("() => document.documentElement.lang")


def stored_locale(page: Page) -> str | None:
    return page.evaluate("() => localStorage.getItem('debrief-locale')")


def open_settings(page: Page, locale: str) -> None:
    page.keyboard.press("Meta+,")
    page.get_by_role(
        "heading", name=SETTINGS_HEADINGS[locale], level=1, exact=True
    ).wait_for(state="visible")


def locale_options(page: Page) -> tuple[list[str], list[str]]:
    options = page.locator(
        '.settings-language-options input[name="debrief-locale"]'
    )
    labels = page.locator(".settings-language-options label span")
    return (
        options.evaluate_all("elements => elements.map(element => element.value)"),
        labels.all_inner_texts(),
    )


def assert_locale_options(page: Page, locale: str) -> None:
    values, labels = locale_options(page)
    if values != LOCALE_VALUES:
        raise AssertionError(f"locale order mismatch: {values}")
    if labels != LOCALE_LABELS[locale]:
        raise AssertionError(f"locale labels mismatch: {labels}")


def audit_axe(page: Page, axe: Path) -> dict[str, int]:
    if not page.evaluate("() => typeof window.axe !== 'undefined'"):
        page.add_script_tag(path=str(axe))
    results: dict[str, Any] = page.evaluate(
        """async () => await window.axe.run(document, {
          resultTypes: ['violations'],
          rules: { 'color-contrast': { enabled: true } }
        })"""
    )
    violations = results["violations"]
    critical = [item for item in violations if item.get("impact") == "critical"]
    contrast = [item for item in violations if item.get("id") == "color-contrast"]
    if critical or contrast:
        details = [
            {
                "id": item["id"],
                "impact": item.get("impact"),
                "targets": [node["target"] for node in item["nodes"]],
            }
            for item in critical + contrast
        ]
        raise AssertionError(f"axe release gate failed: {json.dumps(details)}")
    return {
        "violations": len(violations),
        "critical": len(critical),
        "color_contrast": len(contrast),
    }


def assert_scene_locale(page: Page, locale: str) -> None:
    text = page.locator("body").inner_text()
    if locale == "en":
        match = CJK.search(text)
        if match:
            raise AssertionError(
                f"English release scene contains CJK text near: {text[max(0, match.start()-24):match.start()+48]!r}"
            )
    elif locale == "zh-CN":
        scan_text = text.replace("繁體中文", "")
        match = TRADITIONAL_ONLY.search(scan_text)
        if match:
            raise AssertionError(
                f"zh-CN release scene contains Traditional-only glyph {match.group()!r} near: "
                f"{scan_text[max(0, match.start()-24):match.start()+48]!r}"
            )


def assert_privacy(page: Page) -> None:
    content: str = page.evaluate(
        """() => {
          const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0 &&
              rect.width > 0 && rect.height > 0;
          };
          const attributes = [
            'aria-label', 'title', 'alt', 'href', 'src', 'value', 'placeholder'
          ];
          const surface = [document.body.innerText];
          for (const element of document.body.querySelectorAll('*')) {
            if (!visible(element)) continue;
            for (const name of attributes) {
              const value = element.getAttribute(name);
              if (value) surface.push(value);
            }
          }
          return surface.join(String.fromCharCode(10));
        }"""
    )
    for marker in FORBIDDEN_PRIVATE_MARKERS:
        if marker.lower() in content.lower():
            raise AssertionError(f"private marker visible in release DOM: {marker}")
    paths = sorted(set(USER_PATH.findall(content)))
    unsafe = [value for value in paths if not value.startswith("/Users/demo")]
    if unsafe:
        raise AssertionError(f"non-synthetic user paths visible: {unsafe}")


def run_locale_gate(browser: Browser, base_url: str, axe: Path) -> dict[str, Any]:
    context = new_context(browser)
    page = context.new_page()
    page.goto(f"{base_url}/?theme=light", wait_until="networkidle")
    settle(page, LOCALE_HEADINGS["en"])
    open_settings(page, "en")
    assert_locale_options(page, "en")

    persistence: list[dict[str, str]] = []
    for locale, label in (
        ("zh-Hant", "繁體中文"),
        ("zh-CN", "简体中文"),
        ("en", "English"),
    ):
        page.get_by_role("radio", name=label, exact=True).click()
        page.get_by_role(
            "heading", name=SETTINGS_HEADINGS[locale], level=1, exact=True
        ).wait_for(state="visible")
        if html_locale(page) != locale or stored_locale(page) != locale:
            raise AssertionError(
                f"locale did not apply/persist: {locale}, html={html_locale(page)}, storage={stored_locale(page)}"
            )
        page.reload(wait_until="networkidle")
        settle(page, LOCALE_HEADINGS[locale])
        open_settings(page, locale)
        assert_locale_options(page, locale)
        if not page.get_by_role("radio", name=label, exact=True).is_checked():
            raise AssertionError(f"locale selection did not survive reload: {locale}")
        persistence.append(
            {"locale": locale, "html_lang": html_locale(page), "stored": stored_locale(page) or ""}
        )
    context.close()

    fallback_context = new_context(browser, locale="fr-FR")
    fallback_page = fallback_context.new_page()
    fallback_page.goto(f"{base_url}/?theme=light", wait_until="networkidle")
    settle(fallback_page, LOCALE_HEADINGS["en"])
    fallback_page.evaluate(
        "() => localStorage.setItem('debrief-locale', 'unsupported-locale')"
    )
    fallback_page.reload(wait_until="networkidle")
    settle(fallback_page, LOCALE_HEADINGS["en"])
    if html_locale(fallback_page) != "en":
        raise AssertionError("unsupported browser/storage locale did not fall back to English")
    fallback_page.goto(
        f"{base_url}/?locale=zh-Hans&theme=light", wait_until="networkidle"
    )
    settle(fallback_page, LOCALE_HEADINGS["zh-CN"])
    if html_locale(fallback_page) != "zh-CN":
        raise AssertionError("zh-Hans URL alias did not normalize to zh-CN")
    fallback_context.close()

    matrix: list[dict[str, Any]] = []
    matrix_context = new_context(browser)
    matrix_page = matrix_context.new_page()
    for locale in LOCALE_VALUES:
        for theme in ("light", "dark"):
            matrix_page.goto(
                f"{base_url}/?locale={locale}&theme={theme}",
                wait_until="networkidle",
            )
            settle(matrix_page, LOCALE_HEADINGS[locale])
            open_settings(matrix_page, locale)
            assert_locale_options(matrix_page, locale)
            actual_theme = matrix_page.evaluate(
                "() => document.documentElement.dataset.theme"
            )
            if actual_theme != theme:
                raise AssertionError(
                    f"theme mismatch for {locale}/{theme}: {actual_theme}"
                )
            if locale == "zh-CN":
                assert_scene_locale(matrix_page, locale)
            matrix.append(
                {
                    "locale": locale,
                    "theme": theme,
                    "axe": audit_axe(matrix_page, axe),
                }
            )
    matrix_context.close()
    return {
        "order": LOCALE_VALUES,
        "labels": LOCALE_LABELS,
        "persistence": persistence,
        "fallback": "unsupported -> en; zh-Hans -> zh-CN",
        "settings_matrix": matrix,
    }


def capture_scene(
    page: Page,
    target: Path,
    locale: str,
    state: str,
    axe: Path,
) -> dict[str, Any]:
    assert_scene_locale(page, locale)
    assert_privacy(page)
    axe_result = audit_axe(page, axe)
    target.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(target), animations="disabled")
    data = target.read_bytes()
    return {
        "path": str(target.relative_to(repo_root())),
        "locale": locale,
        "state": state,
        "width": VIEWPORT["width"],
        "height": VIEWPORT["height"],
        "sha256": hashlib.sha256(data).hexdigest(),
        "privacy": "pass",
        "locale_glyphs": "pass",
        "axe": axe_result,
    }


def capture_release_assets(
    browser: Browser, base_url: str, axe: Path, root: Path
) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    for locale in ("en", "zh-CN"):
        context = new_context(browser)
        page = context.new_page()
        route = f"{base_url}/?locale={locale}&theme=light"
        page.goto(route, wait_until="networkidle")
        settle(page, LOCALE_HEADINGS[locale])
        destination = root / "packages/landing/public/screenshots" / locale
        assets.append(
            capture_scene(
                page,
                destination / "overview-light.png",
                locale,
                "overview-light",
                axe,
            )
        )

        page.locator('[data-testid="project-card-2"] .handoff-row-main').click()
        page.get_by_role("dialog").wait_for(state="visible")
        page.evaluate("() => document.fonts.ready")
        assets.append(
            capture_scene(
                page,
                destination / "detail-light.png",
                locale,
                "detail-light",
                axe,
            )
        )

        page.goto(route, wait_until="networkidle")
        settle(page, LOCALE_HEADINGS[locale])
        page.locator('[data-testid="project-card-1"] .handoff-row-main').click()
        detail = page.get_by_role("dialog")
        detail.wait_for(state="visible")
        turn_log = detail.locator("details.turn-log").first
        turn_log.wait_for(state="visible")
        turn_log.locator(":scope > summary").click()
        if turn_log.get_attribute("open") is None:
            raise AssertionError(f"turn log did not open for {locale}")
        turn_log.scroll_into_view_if_needed()
        page.evaluate("() => document.fonts.ready")
        assets.append(
            capture_scene(
                page,
                destination / "turn-log-light.png",
                locale,
                "turn-log-light",
                axe,
            )
        )
        context.close()
    return assets


def main() -> None:
    args = parse_args()
    root = repo_root()
    axe = axe_path(root)
    chrome = Path(args.chrome)
    if not chrome.is_file():
        raise AssertionError(f"Chrome executable not found: {chrome}")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=str(chrome),
        )
        try:
            locale_gate = run_locale_gate(browser, args.base_url, axe)
            assets = capture_release_assets(browser, args.base_url, axe, root)
        finally:
            browser.close()
    print(
        json.dumps(
            {"locale_gate": locale_gate, "assets": assets},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
