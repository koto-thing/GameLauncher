//! 2つの見た目（キャラクターナビとアーケード）に共通する画面の型と描画部品
//!
//! キャラクターナビは PandD のロゴの配色で恋愛 ADV のプレイ画面に、
//! アーケードは SPACE YAKUZA の画面に寄せる

pub mod arcade;
pub mod navi;

/// PandD のロゴを元にした配色
///
/// ロゴのコーラルピンクと白を基本に、コーラルの濃淡を足す
pub mod palette {
    use eframe::egui::Color32;

    /// ロゴの「a」のコーラルピンク。主ボタンと強調に使う
    pub const CORAL: Color32 = Color32::from_rgb(0xff, 0x67, 0x77);
    /// 押下中や影に使う濃いコーラル
    pub const CORAL_DEEP: Color32 = Color32::from_rgb(0xd9, 0x4a, 0x5b);
    /// 枠線やハイライトに使う淡いコーラル
    pub const CORAL_LIGHT: Color32 = Color32::from_rgb(0xff, 0xb8, 0xc0);
    /// ロゴの背景の白
    pub const WHITE: Color32 = Color32::WHITE;
}

use eframe::egui::{
    self, Align2, Color32, FontFamily, FontId, Mesh, Pos2, Rect, Response, Sense, Shape, Ui,
};
use pandd_setup::{ifw::Stage, progress::Progress, shooter::Game};

/// セットアップで行う作業。画面の文言を切り替える
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Task {
    /// 新規インストール
    Install,
    /// 更新
    Update,
    /// アンインストール
    Uninstall,
}

/// セットアップの画面
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Screen {
    /// メンテナンスで更新かアンインストールかを選ぶ
    Menu,
    /// あいさつと開始。アンインストールでは実行前の確認
    Welcome,
    /// インストール先の選択
    Destination,
    /// IFW の実行中
    Running,
    /// 完了
    Finished,
    /// 失敗
    Failed,
}

/// 画面の操作で起きる出来事
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// 次の画面へ進む
    Next,
    /// 前の画面へ戻る
    Back,
    /// フォルダ選択ダイアログを開く
    Browse,
    /// 既定のインストール先に戻す
    UseDefault,
    /// インストールを始める
    Install,
    /// 更新を始める
    Update,
    /// アンインストールの確認画面へ進む
    ConfirmUninstall,
    /// アンインストールを始める
    Uninstall,
    /// もう一度実行する
    Retry,
    /// ランチャーを起動して閉じる
    Launch,
    /// セットアップを閉じる
    Close,
    /// キャラクターナビとアーケードを切り替える
    ToggleTheme,
}

/// テーマが描画に使う、セットアップの今の状態
pub struct View<'a> {
    /// 行っている作業
    pub task: Task,
    /// 今の画面
    pub screen: Screen,
    /// 入力中のインストール先
    pub root_text: &'a mut String,
    /// 既定のインストール先
    pub default_root: &'a str,
    /// 実際にインストールする、または更新やアンインストールの対象のディレクトリ
    pub final_root: &'a str,
    /// インストール先の問題。なければ None
    pub directory_problem: Option<&'a str>,
    /// IFW の進捗
    pub progress: &'a Progress,
    /// IFW のログの末尾
    pub log: &'a [String],
    /// 失敗の内容
    pub failure: &'a str,
    /// 今の画面に入ってからの秒数
    pub screen_seconds: f32,
    /// 起動からの秒数
    pub seconds: f32,
    /// 更新が終わり、更新するものがなかったなら true
    pub up_to_date: bool,
    /// アーケードのシューティング。実行画面に入るまでは None
    pub game: Option<&'a Game>,
    /// キャラクターナビの立ち絵とロゴ
    pub images: &'a navi::Images,
}

/// テーマ共通のフォント名
pub const BOLD: &str = "bold";
/// アーケード用のドットフォント名
pub const PIXEL: &str = "pixel";
/// アーケードの日本語の本文に使うドットフォント名
pub const DOT: &str = "dot";

/// 太字の日本語フォントを返す
///
/// # 引数
///
/// * `size` - 文字の大きさ
///
/// # 戻り値
///
/// M PLUS 2 ExtraBold のフォント指定
pub fn bold(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name(BOLD.into()))
}

/// 本文用の日本語フォントを返す
///
/// # 引数
///
/// * `size` - 文字の大きさ
///
/// # 戻り値
///
/// M PLUS 2 Medium のフォント指定
pub fn body(size: f32) -> FontId {
    FontId::new(size, FontFamily::Proportional)
}

/// ドットフォントを返す。日本語は DotGothic16 で表示する
///
/// # 引数
///
/// * `size` - 文字の大きさ
///
/// # 戻り値
///
/// Press Start 2P のフォント指定
pub fn pixel(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name(PIXEL.into()))
}

/// 日本語の本文用のドットフォントを返す
///
/// # 引数
///
/// * `size` - 文字の大きさ
///
/// # 戻り値
///
/// DotGothic16 のフォント指定
pub fn dot(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name(DOT.into()))
}

/// 工程の日本語名を返す
///
/// # 引数
///
/// * `stage` - IFW の工程
///
/// # 戻り値
///
/// 画面に出す工程名
pub fn stage_label(stage: Stage) -> &'static str {
    match stage {
        Stage::Preparing => "更新情報を確認中",
        Stage::Downloading => "パッケージをダウンロード中",
        Stage::Unpacking => "ファイルを展開中",
        Stage::Finalizing => "仕上げ中",
        Stage::Removing => "ファイルを削除中",
    }
}

/// 上から下へ色が変わる矩形を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `rect` - 塗る範囲
/// * `top` - 上端の色
/// * `bottom` - 下端の色
///
/// # 戻り値
///
/// 戻り値なし
pub fn vertical_gradient(ui: &Ui, rect: Rect, top: Color32, bottom: Color32) {
    let mut mesh = Mesh::default();
    mesh.colored_vertex(rect.left_top(), top);
    mesh.colored_vertex(rect.right_top(), top);
    mesh.colored_vertex(rect.left_bottom(), bottom);
    mesh.colored_vertex(rect.right_bottom(), bottom);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(1, 3, 2);
    ui.painter().add(Shape::mesh(mesh));
}

/// 押せる領域を作り、押されたかとカーソルの状態を返す
///
/// # 引数
///
/// * `ui` - 配置先
/// * `rect` - 押せる範囲
///
/// # 戻り値
///
/// その領域の操作結果
pub fn hit_area(ui: &mut Ui, rect: Rect) -> Response {
    ui.allocate_rect(rect, Sense::click())
        .on_hover_cursor(egui::CursorIcon::PointingHand)
}

/// 1行に収まらない文字列を、前後を残して真ん中を「…」で省く
///
/// パスは区切りがないと折り返せず枠からはみ出すので、
/// ドライブと末尾のフォルダ名が見えるように中ほどを削る
///
/// # 引数
///
/// * `ui` - 文字幅の計測に使う
/// * `text` - 収めたい文字列
/// * `font` - 描くときのフォント
/// * `width` - 収める幅
///
/// # 戻り値
///
/// 幅に収まればそのまま、収まらなければ真ん中を省いた文字列
pub fn fit_line(ui: &Ui, text: &str, font: &FontId, width: f32) -> String {
    let fits = |candidate: &str| {
        ui.painter()
            .layout_no_wrap(candidate.to_owned(), font.clone(), Color32::WHITE)
            .size()
            .x
            <= width
    };
    if fits(text) {
        return text.to_owned();
    }

    // 前後から同じ数ずつ残し、収まる最大の数を探す
    let characters: Vec<char> = text.chars().collect();
    let mut keep = characters.len() / 2;
    while keep > 0 {
        let head: String = characters[..keep].iter().collect();
        let tail: String = characters[characters.len() - keep..].iter().collect();
        let candidate = format!("{head}…{tail}");
        if fits(&candidate) {
            return candidate;
        }
        keep -= 1;
    }
    "…".to_owned()
}

/// 中央揃えで文字を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `center` - 文字の中心
/// * `text` - 描く文字列
/// * `font` - フォント
/// * `color` - 文字の色
///
/// # 戻り値
///
/// 戻り値なし
pub fn centered_text(ui: &Ui, center: Pos2, text: &str, font: FontId, color: Color32) {
    ui.painter()
        .text(center, Align2::CENTER_CENTER, text, font, color);
}
