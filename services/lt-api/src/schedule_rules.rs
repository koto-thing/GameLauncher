/// 終了上限までに配置できる発表数を計算する
///
/// # 引数
/// - `available_ms`: 開始から終了上限までのミリ秒
/// - `talk_minutes`: 1発表の分数
/// - `transition_minutes`: 各発表直後の転換分数
/// - `opening_minutes`: 開会の分数
/// - `closing_minutes`: 閉会の分数
/// - `break_every`: 休憩を挟む発表数の間隔
/// - `break_minutes`: 1回の休憩の分数
///
/// # 戻り値
/// 配置可能な発表数、上限は10000件
pub fn capacity(
    available_ms: i64,
    talk_minutes: u32,
    transition_minutes: u32,
    opening_minutes: u32,
    closing_minutes: u32,
    break_every: u32,
    break_minutes: u32,
) -> u32 {
    // 最後の発表後には休憩を挟まず、転換は必ず確保する
    let fits = |count: u32| {
        let breaks = count.saturating_sub(1) / break_every;
        let minutes = i64::from(opening_minutes)
            + i64::from(closing_minutes)
            + i64::from(count) * (i64::from(talk_minutes) + i64::from(transition_minutes))
            + i64::from(breaks) * i64::from(break_minutes);
        minutes * 60000 <= available_ms
    };

    // 件数全体を列挙せず、上限に収まる最大値を二分探索する
    let (mut low, mut high) = (0, 10001);
    while low + 1 < high {
        let middle = (low + high) / 2;
        if fits(middle) {
            low = middle;
        } else {
            high = middle;
        }
    }
    low
}

#[cfg(test)]
mod tests {
    use super::capacity;

    /// 休憩の境界と0分転換で収容数を確認する
    ///
    /// # 戻り値
    /// 戻り値なし
    #[test]
    fn capacity_includes_breaks_and_closing() {
        assert_eq!(capacity(54 * 60000, 10, 1, 5, 5, 4, 10), 4);
        assert_eq!(capacity(74 * 60000, 10, 1, 5, 5, 4, 10), 4);
        assert_eq!(capacity(75 * 60000, 10, 1, 5, 5, 4, 10), 5);
        assert_eq!(capacity(20 * 60000, 10, 0, 5, 5, 4, 10), 1);
        assert_eq!(capacity(20 * 60000 - 1, 10, 0, 5, 5, 4, 10), 0);
        assert_eq!(capacity(-1, 10, 1, 5, 5, 4, 10), 0);
    }
}
