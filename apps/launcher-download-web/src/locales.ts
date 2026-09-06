export const locales = {
  ja: {name: "日本語", tagline: "遊び心が、動き出す。", download: "ダウンロード", soon: "準備中", suffix: "版", language: "言語を選択", nav: "OS別ダウンロード", description: "Play and Discoverの公式ダウンロードページ。Windows・Mac・Linux版の配布状況をご案内します。"},
  "zh-CN": {name: "简体中文", tagline: "让玩心，即刻启程。", download: "下载", soon: "即将推出", suffix: "版", language: "选择语言", nav: "按操作系统下载", description: "Play and Discover官方下载页面。查看Windows、Mac和Linux版本的发布状态。"},
  ko: {name: "한국어", tagline: "즐거운 상상이 시작되는 곳.", download: "다운로드", soon: "출시 예정", suffix: " 버전", language: "언어 선택", nav: "운영체제별 다운로드", description: "Play and Discover 공식 다운로드 페이지. Windows, Mac, Linux 버전의 출시 현황을 확인하세요."},
  en: {name: "English", tagline: "Let your playful side come alive.", download: "Download", soon: "Coming soon", suffix: "", language: "Select language", nav: "Downloads by operating system", description: "The official Play and Discover download page. Check availability for Windows, Mac, and Linux."},
  es: {name: "Español", tagline: "Dale vida a tus ganas de jugar.", download: "Descargar", soon: "Próximamente", suffix: "", language: "Seleccionar idioma", nav: "Descargas por sistema operativo", description: "Página oficial de descarga de Play and Discover. Consulta la disponibilidad para Windows, Mac y Linux."},
} as const;
export type Locale = keyof typeof locales;
export function isLocale(value: unknown): value is Locale { return typeof value === "string" && Object.hasOwn(locales, value); }
