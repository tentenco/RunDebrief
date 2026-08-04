import { CircleAlert, Languages, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  changeAppLocale,
  currentLocale,
  type AppLocale,
} from "../i18n";

interface SettingsViewProps {
  runtimeBusy: boolean;
  privacyError: string | null;
  onOpenPrivacySecurity(): void;
}

export function SettingsView({
  runtimeBusy,
  privacyError,
  onOpenPrivacySecurity,
}: SettingsViewProps) {
  const { t, i18n } = useTranslation();
  const locale = currentLocale();
  const choices: Array<{ value: AppLocale; label: string }> = [
    { value: "zh-Hant", label: t("settings.zhHant") },
    { value: "en", label: t("settings.english") },
  ];

  return (
    <div className="settings-content">
      <section
        className="settings-section settings-language"
        aria-labelledby="settings-language-title"
      >
        <span className="settings-section-icon" aria-hidden="true">
          <Languages />
        </span>
        <div className="settings-section-body">
          <h2 id="settings-language-title">{t("settings.languageTitle")}</h2>
          <p>{t("settings.languageDescription")}</p>
          <fieldset className="settings-language-options">
            <legend>{t("settings.languageLegend")}</legend>
            {choices.map((choice) => (
              <label key={choice.value}>
                <input
                  type="radio"
                  name="debrief-locale"
                  value={choice.value}
                  checked={locale === choice.value}
                  autoFocus={locale === choice.value}
                  onChange={() => void changeAppLocale(choice.value)}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </fieldset>
          <output className="sr-only" aria-live="polite">
            {i18n.resolvedLanguage}
          </output>
        </div>
      </section>

      <section
        className="settings-section settings-privacy"
        aria-labelledby="settings-privacy-title"
      >
        <span className="settings-section-icon" aria-hidden="true">
          <Settings />
        </span>
        <div className="settings-section-body">
          <h2 id="settings-privacy-title">{t("settings.privacyTitle")}</h2>
          <p>{t("settings.privacyDescription")}</p>
          <button
            className="secondary-button"
            type="button"
            disabled={runtimeBusy}
            onClick={onOpenPrivacySecurity}
          >
            <Settings aria-hidden="true" />
            {t("settings.openPrivacy")}
          </button>
          {privacyError && (
            <p className="settings-error" role="alert">
              <CircleAlert aria-hidden="true" />
              {privacyError}
            </p>
          )}
          <small>{t("settings.privacyFootnote")}</small>
        </div>
      </section>
    </div>
  );
}
