//! LT メール配達の結果分類と再試行。既定では外部送信しない
#[cfg(feature = "worker-runtime")]
pub mod runtime;

/// 外部応答を私有情報なしで分類する
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Outcome {
    Accepted,
    Temporary,
    Permanent,
    Uncertain,
}
/// 配達状態。通信結果不明は自動再送しない
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum State {
    Pending,
    Sent,
    Failed,
    Uncertain,
    Expired,
}
/// 再試行の決定値
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Decision {
    pub state: State,
    pub next_at: Option<i64>,
}

/// 期限と試行上限を適用して次の状態を決定する
/// 引数: 結果、現在時刻秒、期限秒、完了した試行回数
/// 戻り値: 保存すべき状態と次回時刻
pub fn decide(outcome: Outcome, now: i64, expires: i64, attempts: u32) -> Decision {
    if now >= expires {
        return Decision {
            state: State::Expired,
            next_at: None,
        };
    }
    match outcome {
        Outcome::Accepted => Decision {
            state: State::Sent,
            next_at: None,
        },
        Outcome::Permanent => Decision {
            state: State::Failed,
            next_at: None,
        },
        Outcome::Uncertain => Decision {
            state: State::Uncertain,
            next_at: None,
        },
        Outcome::Temporary => {
            let next = now.saturating_add(60_i64.saturating_mul(1_i64 << attempts.min(6)));
            if attempts >= 5 || next >= expires {
                Decision {
                    state: State::Failed,
                    next_at: None,
                }
            } else {
                Decision {
                    state: State::Pending,
                    next_at: Some(next),
                }
            }
        }
    }
}

/// HTTP 中継は既知の応答だけを安全な結果へ分類する
/// 引数: HTTP status と中継の固定結果
/// 戻り値: 再送判断に使う分類
pub fn classify(status: u16, result: &str) -> Outcome {
    match (status, result) {
        (200, "accepted") => Outcome::Accepted,
        (429 | 503, "temporary") => Outcome::Temporary,
        (400 | 401 | 403 | 409 | 410 | 422, "permanent") => Outcome::Permanent,
        _ => Outcome::Uncertain,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn success() {
        assert_eq!(decide(Outcome::Accepted, 1, 999, 1).state, State::Sent);
    }
    #[test]
    fn temporary_retries() {
        assert_eq!(
            decide(Outcome::Temporary, 1, 999, 1),
            Decision {
                state: State::Pending,
                next_at: Some(121)
            }
        );
    }
    #[test]
    fn permanent_stops() {
        assert_eq!(decide(Outcome::Permanent, 1, 999, 1).state, State::Failed);
    }
    #[test]
    fn unknown_stops() {
        assert_eq!(classify(500, "temporary"), Outcome::Uncertain);
    }
    #[test]
    fn expiry_refuses() {
        assert_eq!(decide(Outcome::Accepted, 999, 999, 1).state, State::Expired);
    }
    #[test]
    fn exhausted_stops() {
        assert_eq!(decide(Outcome::Temporary, 1, 99999, 5).state, State::Failed);
    }
}
