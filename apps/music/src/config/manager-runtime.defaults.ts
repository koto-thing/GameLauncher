// PHP検証待ちを含む管理アップロードだけの制限。公開プレーヤーへ混ぜない。
export const MANAGER_RUNTIME_DEFAULTS = { uploadTimeoutMs: 180000 } as const;
