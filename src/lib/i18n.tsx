import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type HubLocale = "en" | "ru";

type Dict = Record<string, string>;

const EN: Dict = {
  "settings.title": "Settings",
  "settings.subtitle": "Hub-wide configuration",
  "settings.back": "Back",
  "tab.general": "General",
  "tab.marketplace": "Marketplace",
  "tab.system": "System",
  "tab.about": "About",
  "build.section": "Build",
  "build.version": "Version",
  "build.git": "Git",
  "build.builtAt": "Built at",
  "hotkeys.section": "Hotkeys",
  "hotkeys.future": "Custom bindings are planned for a later release. The global hotkey is best-effort: if another app already owns the combo, the rest of the hub still boots.",
  "theme.section": "Theme",
  "theme.hint": "Theme is saved locally and applied on the next launch.",
  "theme.dark": "Dark",
  "theme.light": "Light",
  "lang.section": "Language",
  "lang.en": "English",
  "lang.ru": "Русский",
  "lang.hint": "UI language (restart not required).",
  "marketplace.section": "Agent marketplace",
  "marketplace.easystt.desc": "Push-to-talk speech-to-text with text injection.",
  "marketplace.easystt.install": "Download & run installer",
  "marketplace.easystt.installing": "Downloading…",
  "marketplace.openrouter.desc": "Chat with Claude / GPT / Gemini through OpenRouter.",
  "marketplace.cloudru.desc": "Cloud.ru models (connect credentials in agent settings).",
  "marketplace.repair": "Repair / reinstall",
  "marketplace.install": "Install",
  "marketplace.kind.ai": "AI",
  "marketplace.kind.utility": "STT",
  "marketplace.agentSettings": "Agent settings",
  "marketplace.badge": "Installed",
  "ai.openrouter.title": "OpenRouter Agent",
  "ai.openrouter.blurb":
    "Install the managed Node agent, set OPENROUTER_API_KEY in the environment or agent config, then start. Open chat from the agent card (AI agents open chat on click).",
  "ai.openrouter.start": "Start",
  "ai.openrouter.running": "Running",
  "ai.openrouter.status.installedRun": "installed and running",
  "ai.openrouter.status.installedStop": "installed (stopped)",
  "ai.openrouter.status.missing": "not installed",
  "ai.cloudru.title": "Cloud.ru Agent",
  "ai.cloudru.blurb":
    "Same protocol as OpenRouter; default provider is Cloud.ru (stub until wired). Set CLOUDRU_BEARER when your integration is ready.",
  "ai.statusLabel": "Status",
  "storage.section": "Storage",
  "storage.manifestDir": "Manifest directory",
  "storage.chatDb": "Chat database",
  "storage.dbSize": "Database size",
  "storage.conv": "Conversations cached",
  "storage.msg": "Messages cached",
  "storage.refresh": "Refresh",
  "storage.statsLoading": "Loading chat stats…",
  "storage.statsFailed": "Chat database stats failed",
  "storage.cacheOff": "Chat cache disabled (database failed to open at startup).",
  "autostart.section": "Auto-start with hub",
  "autostart.loading": "Loading agents…",
  "autostart.empty": "No agents discovered yet. Drop a manifest into the directory above and the list will populate.",
  "chat.section": "Chat history",
  "chat.blurb1":
    "Every message you send to an AI agent is mirrored into the local SQLite cache so chat history survives crashes and reinstalls.",
  "chat.blurb2":
    "Search uses SQLite FTS5. Type at least 2 characters in the command palette to scan cached conversations.",
  "about.section": "About",
  "about.app": "App",
  "about.license": "License",
  "about.github": "Source on GitHub",
  "topbar.commands": "Commands",
  "topbar.themeDark": "Dark theme",
  "topbar.themeLight": "Light theme",
  "topbar.paletteHint": "Command palette (⌘K / Ctrl+K)",
  "grid.all": "All agents",
  "grid.running": "Running",
  "grid.ai": "AI",
  "grid.tagPrefix": "#",
  "grid.utilities": "Utilities",
  "grid.subtitle.loading": "Loading…",
  "grid.subtitle.count": "{visible} of {total} agent(s)",
  "empty.title.wait": "Looking for agents…",
  "empty.title.none": "No agents yet",
  "empty.intro": "Drop an agent manifest into",
  "empty.outro":
    "and the hub will pick it up. For chat with OpenRouter or Cloud.ru, install the corresponding agent from Settings → Marketplace, start it, then open the card (AI agents open chat on click).",
  "error.loadTitle": "Failed to load agents",
  "sidebar.brand": "Agent Hub",
  "sidebar.subtitle": "local",
  "sidebar.search": "Search…",
  "sidebar.tags": "Tags",
  "sidebar.showHub": "Show hub",
  "sidebar.settings": "Settings",
  "sidebar.marketplace": "Marketplace",
  "sidebar.filter.all": "All agents",
  "sidebar.filter.running": "Running",
  "sidebar.filter.ai": "AI",
  "sidebar.filter.utility": "Utilities",
  "hk.1.what": "Show / focus hub",
  "hk.1.note": "global",
  "hk.2.what": "Open command palette",
  "hk.3.what": "Navigate palette / lists",
  "hk.4.what": "Run selected action",
  "hk.5.what": "Close palette / dialog",
};

const RU: Dict = {
  "settings.title": "Настройки",
  "settings.subtitle": "Параметры хаба",
  "settings.back": "Назад",
  "tab.general": "Общие",
  "tab.marketplace": "Каталог",
  "tab.system": "Система",
  "tab.about": "О программе",
  "build.section": "Сборка",
  "build.version": "Версия",
  "build.git": "Git",
  "build.builtAt": "Собрано",
  "hotkeys.section": "Горячие клавиши",
  "hotkeys.future":
    "Свои сочетания — в будущей версии. Глобальная комбинация «лучший effort»: если ею уже владеет другое приложение, хаб всё равно запустится.",
  "theme.section": "Тема",
  "theme.hint": "Тема сохраняется локально и применяется при следующем запуске.",
  "theme.dark": "Тёмная",
  "theme.light": "Светлая",
  "lang.section": "Язык",
  "lang.en": "English",
  "lang.ru": "Русский",
  "lang.hint": "Язык интерфейса (перезапуск не нужен).",
  "marketplace.section": "Каталог агентов",
  "marketplace.easystt.desc": "Push-to-talk STT с подстановкой текста.",
  "marketplace.easystt.install": "Скачать и запустить установщик",
  "marketplace.easystt.installing": "Загрузка…",
  "marketplace.openrouter.desc": "Чат с Claude / GPT / Gemini через OpenRouter.",
  "marketplace.cloudru.desc": "Модели Cloud.ru (ключи — в настройках агента).",
  "marketplace.repair": "Переустановить",
  "marketplace.install": "Установить",
  "marketplace.kind.ai": "ИИ",
  "marketplace.kind.utility": "STT",
  "marketplace.agentSettings": "Настройки агента",
  "marketplace.badge": "Установлено",
  "ai.openrouter.title": "Агент OpenRouter",
  "ai.openrouter.blurb":
    "Установите управляемый Node-агент, задайте OPENROUTER_API_KEY в окружении или конфиге, затем «Запуск». Чат открывается по карточке агента (для ИИ — по клику).",
  "ai.openrouter.start": "Запуск",
  "ai.openrouter.running": "Работает",
  "ai.openrouter.status.installedRun": "установлен и запущен",
  "ai.openrouter.status.installedStop": "установлен (остановлен)",
  "ai.openrouter.status.missing": "не установлен",
  "ai.cloudru.title": "Агент Cloud.ru",
  "ai.cloudru.blurb":
    "Тот же протокол, что у OpenRouter; провайдер по умолчанию — Cloud.ru (заглушка до интеграции). Когда будет готово — CLOUDRU_BEARER.",
  "ai.statusLabel": "Статус",
  "storage.section": "Хранилище",
  "storage.manifestDir": "Каталог манифестов",
  "storage.chatDb": "База чатов",
  "storage.dbSize": "Размер БД",
  "storage.conv": "Диалогов в кэше",
  "storage.msg": "Сообщений в кэше",
  "storage.refresh": "Обновить",
  "storage.statsLoading": "Загрузка статистики…",
  "storage.statsFailed": "Не удалось прочитать статистику чата",
  "storage.cacheOff": "Кэш чата отключён (не удалось открыть БД при старте).",
  "autostart.section": "Автозапуск с хабом",
  "autostart.loading": "Загрузка агентов…",
  "autostart.empty": "Агентов пока нет. Положите манифест в каталог выше — список обновится.",
  "chat.section": "История чата",
  "chat.blurb1":
    "Сообщения к ИИ-копируются в локальный SQLite, чтобы история переживала сбои и переустановки.",
  "chat.blurb2":
    "Поиск — SQLite FTS5. В палитре команд введите от 2 символов для поиска по кэшу.",
  "about.section": "О программе",
  "about.app": "Приложение",
  "about.license": "Лицензия",
  "about.github": "Исходники на GitHub",
  "topbar.commands": "Команды",
  "topbar.themeDark": "Тёмная тема",
  "topbar.themeLight": "Светлая тема",
  "topbar.paletteHint": "Палитра команд (⌘K / Ctrl+K)",
  "grid.all": "Все агенты",
  "grid.running": "Запущенные",
  "grid.ai": "ИИ",
  "grid.tagPrefix": "#",
  "grid.utilities": "Утилиты",
  "grid.subtitle.loading": "Загрузка…",
  "grid.subtitle.count": "{visible} из {total} агент(ов)",
  "empty.title.wait": "Ищем агентов…",
  "empty.title.none": "Пока нет агентов",
  "empty.intro": "Положите манифест в каталог",
  "empty.outro":
    "— хаб подхватит его. Для чата через OpenRouter или Cloud.ru установите агента в Настройки → Каталог, запустите его и откройте карточку (у ИИ чат открывается по клику).",
  "error.loadTitle": "Не удалось загрузить агентов",
  "sidebar.brand": "Agent Hub",
  "sidebar.subtitle": "локально",
  "sidebar.search": "Поиск…",
  "sidebar.tags": "Теги",
  "sidebar.showHub": "Показать хаб",
  "sidebar.settings": "Настройки",
  "sidebar.marketplace": "Маркетплейс",
  "sidebar.filter.all": "Все агенты",
  "sidebar.filter.running": "Запущенные",
  "sidebar.filter.ai": "ИИ",
  "sidebar.filter.utility": "Утилиты",
  "hk.1.what": "Показать / фокус хаба",
  "hk.1.note": "глобально",
  "hk.2.what": "Открыть палитру команд",
  "hk.3.what": "Навигация по спискам",
  "hk.4.what": "Выполнить действие",
  "hk.5.what": "Закрыть палитру / диалог",
};

const CATALOG: Record<HubLocale, Dict> = { en: EN, ru: RU };

function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    const needle = `{${k}}`;
    s = s.split(needle).join(String(v));
  }
  return s;
}

type Ctx = {
  locale: HubLocale;
  setLocale: (l: HubLocale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "hub.locale";

function readInitialLocale(): HubLocale {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "ru" || raw === "en") return raw;
  const nav = navigator.language?.toLowerCase() ?? "";
  if (nav.startsWith("ru")) return "ru";
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<HubLocale>(readInitialLocale);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale === "ru" ? "ru" : "en";
  }, [locale]);

  const setLocale = useCallback((l: HubLocale) => setLocaleState(l), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const table = CATALOG[locale] ?? EN;
      const fallback = EN[key] ?? key;
      const raw = table[key] ?? fallback;
      return vars ? interpolate(raw, vars) : raw;
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
