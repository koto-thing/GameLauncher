//! IFW の工程から、画面に出す進捗率を見積もる
//!
//! IFW の CLI は割合を出力しないため、工程ごとに区間を割り当て、
//! 区間の終わりへ時間とともに近づける

use crate::ifw::Stage;

/// 工程の区間に近づく速さを決める時定数（秒）
const APPROACH_SECONDS: f32 = 6.0;

/// 画面に出すインストールの進捗
#[derive(Clone, Debug, PartialEq)]
pub struct Progress {
    stage: Stage,
    fraction: f32,
    finished: bool,
}

impl Default for Progress {
    /// 準備工程の 0% から始まる進捗を作る
    ///
    /// # 戻り値
    ///
    /// 未開始の進捗
    fn default() -> Self {
        Self {
            stage: Stage::Preparing,
            fraction: 0.0,
            finished: false,
        }
    }
}

impl Progress {
    /// 新しい工程に進める。前の工程へは戻さない
    ///
    /// # 引数
    ///
    /// * `stage` - IFW のログから判定した工程
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    pub fn enter(&mut self, stage: Stage) {
        if stage > self.stage {
            self.stage = stage;
            self.fraction = self.fraction.max(range_of(stage).0);
        }
    }

    /// 経過時間に合わせて、今の工程の終わりへ近づける
    ///
    /// # 引数
    ///
    /// * `seconds` - 前回の呼出からの経過秒数
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    pub fn tick(&mut self, seconds: f32) {
        if self.finished {
            return;
        }
        let end = range_of(self.stage).1;
        let step = 1.0 - (-seconds.max(0.0) / APPROACH_SECONDS).exp();
        self.fraction += (end - self.fraction) * step;
    }

    /// 完了として 100% にする
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    pub fn finish(&mut self) {
        self.finished = true;
        self.fraction = 1.0;
    }

    /// 進捗率を返す
    ///
    /// # 戻り値
    ///
    /// 0.0 から 1.0 までの割合
    pub fn fraction(&self) -> f32 {
        self.fraction
    }

    /// 今の工程を返す
    ///
    /// # 戻り値
    ///
    /// 最後に入った工程
    pub fn stage(&self) -> Stage {
        self.stage
    }

    /// 完了したかを返す
    ///
    /// # 戻り値
    ///
    /// `finish` を呼んだ後なら true
    pub fn is_finished(&self) -> bool {
        self.finished
    }
}

/// 工程ごとの進捗率の区間を返す
///
/// # 引数
///
/// * `stage` - 工程
///
/// # 戻り値
///
/// 区間の始まりと終わりの割合
fn range_of(stage: Stage) -> (f32, f32) {
    match stage {
        Stage::Preparing => (0.0, 0.1),
        Stage::Downloading => (0.1, 0.55),
        Stage::Unpacking => (0.55, 0.9),
        Stage::Finalizing => (0.9, 0.98),
        Stage::Removing => (0.0, 0.95),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stays_inside_the_current_stage() {
        let mut progress = Progress::default();
        progress.enter(Stage::Downloading);
        assert!((progress.fraction() - 0.1).abs() < f32::EPSILON);
        for _ in 0..10_000 {
            progress.tick(0.1);
        }
        assert!(progress.fraction() <= 0.55);
        assert!(progress.fraction() > 0.5);
    }

    #[test]
    fn never_moves_back_to_an_earlier_stage() {
        let mut progress = Progress::default();
        progress.enter(Stage::Unpacking);
        progress.enter(Stage::Downloading);
        assert_eq!(progress.stage(), Stage::Unpacking);
        assert!(progress.fraction() >= 0.55);
    }

    #[test]
    fn finishes_at_full_progress() {
        let mut progress = Progress::default();
        progress.finish();
        progress.tick(1.0);
        assert!(progress.is_finished());
        assert!((progress.fraction() - 1.0).abs() < f32::EPSILON);
    }
}
