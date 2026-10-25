use worker::Env;

/// 本番とローカルの認証機能を混在させず明示設定だけで有効化する
/// 引数: 本番API設定、ローカル認証設定
/// 戻り値: このbundleで本人・運営APIを使用できるか
fn active(production_enabled: bool, local_auth: bool) -> bool {
    if cfg!(feature = "production-api") {
        return !cfg!(feature = "local-development")
            && !cfg!(feature = "runtime-tests")
            && production_enabled
            && !local_auth;
    }
    cfg!(feature = "local-development") && local_auth
}

/// 秘密を読まずに指定した配備用gateを確認する
/// 引数: Worker環境、設定名
/// 戻り値: 指定gateの有効状態。未設定は無効
fn configured(env: &Env, key: &str) -> bool {
    let enabled = |key| {
        env.var(key)
            .map(|v| v.to_string() == "true")
            .unwrap_or(false)
    };
    active(enabled(key), enabled("LOCAL_AUTH"))
}

/// 本人APIの明示gateを確認する
/// 引数: Worker環境
/// 戻り値: 本人APIだけの有効状態
pub fn private_enabled(env: &Env) -> bool {
    configured(env, "LT_PRIVATE_API_ENABLED")
}

/// 運営RPCの明示gateを本人APIと独立して確認する
/// 引数: Worker環境
/// 戻り値: 運営RPCだけの有効状態。未設定は無効
pub fn operator_enabled(env: &Env) -> bool {
    configured(env, "LT_OPERATOR_API_ENABLED")
}

#[cfg(test)]
mod tests {
    use super::active;

    #[test]
    fn explicit_modes_fail_closed() {
        if cfg!(feature = "production-api") {
            assert!(!active(false, false));
            assert!(!active(true, true));
            assert_eq!(
                active(true, false),
                !cfg!(feature = "local-development") && !cfg!(feature = "runtime-tests")
            );
        } else {
            assert!(!active(true, false));
            assert_eq!(active(false, true), cfg!(feature = "local-development"));
        }
    }
}
