//! 2つの見た目（キャラクターナビとアーケード）に共通する画面の型と描画部品

pub mod arcade;
pub mod navi;

/// PandD のロゴを元にした配色
///
/// ロゴのチャコール、コーラルピンク、白を基本に、コーラルの濃淡を足す
pub mod palette {
    use eframe::egui::Color32;

    /// ロゴの文字色。本文と枠線に使う
    pub const CHARCOAL: Color32 = Color32::from_rgb(0x3a, 0x3a, 0x3a);
    /// チャコールを薄めた補足の文字色
    pub const CHARCOAL_SOFT: Color32 = Color32::from_rgb(0x7a, 0x76, 0x78);
    /// アーケードの背景に使う、チャコールをさらに暗くした色
    pub const NIGHT: Color32 = Color32::from_rgb(0x16, 0x15, 0x17);
    /// ロゴの「a」のコーラルピンク。主ボタンと強調に使う
    pub const CORAL: Color32 = Color32::from_rgb(0xff, 0x67, 0x77);
    /// 押下中や影に使う濃いコーラル
    pub const CORAL_DEEP: Color32 = Color32::from_rgb(0xd9, 0x4a, 0x5b);
    /// 枠線やハイライトに使う淡いコーラル
    pub const CORAL_LIGHT: Color32 = Color32::from_rgb(0xff, 0xb8, 0xc0);
    /// 背景に使うごく淡いコーラル
    pub const CORAL_MIST: Color32 = Color32::from_rgb(0xff, 0xf1, 0xf3);
    /// ロゴの背景の白
    pub const WHITE: Color32 = Color32::WHITE;
}

use eframe::egui::{
    self, Align2, Color32, CornerRadius, FontFamily, FontId, Mesh, Pos2, Rect, Response, Sense,
    Shape, Stroke, StrokeKind, Ui, vec2,
};
use pandd_setup::{ifw::Stage, progress::Progress, shooter::Game};

/// セットアップの画面
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Screen {
    /// あいさつと開始
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
    /// もう一度実行する
    Retry,
    /// ランチャーを起動して閉じる
    Launch,
    /// セットアップを閉じる
    Close,
}

/// テーマが描画に使う、セットアップの今の状態
pub struct View<'a> {
    /// 更新モードなら true
    pub updating: bool,
    /// 今の画面
    pub screen: Screen,
    /// 入力中のインストール先
    pub root_text: &'a mut String,
    /// 既定のインストール先
    pub default_root: &'a str,
    /// 実際にインストールするディレクトリ
    pub final_root: &'a str,
    /// インストール先の問題。なければ None
    pub directory_problem: Option<&'a str>,
    /// IFW の進捗
    pub progress: &'a Progress,
    /// 失敗の内容
    pub failure: &'a str,
    /// 今の画面に入ってからの秒数
    pub screen_seconds: f32,
    /// 起動からの秒数
    pub seconds: f32,
    /// アーケードのシューティング。実行画面に入るまでは None
    pub game: Option<&'a Game>,
    /// キャラクターナビの立ち絵
    pub portraits: &'a navi::Portraits,
}

/// テーマ共通のフォント名
pub const BOLD: &str = "bold";
/// アーケード用のドットフォント名
pub const PIXEL: &str = "pixel";

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

/// ドットフォントを返す。日本語は太字の M PLUS 2 で表示する
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

/// 文字列の点描データからドット絵を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `rows` - 1行ずつの点描データ。`.` は透明
/// * `palette` - 文字から色を返す関数。None なら描かない
/// * `center` - ドット絵の中心
/// * `dot` - 1ドットの大きさ
///
/// # 戻り値
///
/// 戻り値なし
pub fn sprite(
    ui: &Ui,
    rows: &[&str],
    palette: impl Fn(char) -> Option<Color32>,
    center: Pos2,
    dot: f32,
) {
    let width = rows.first().map_or(0, |row| row.chars().count()) as f32 * dot;
    let height = rows.len() as f32 * dot;
    let origin = center - vec2(width, height) / 2.0;
    for (y, row) in rows.iter().enumerate() {
        for (x, cell) in row.chars().enumerate() {
            if let Some(color) = palette(cell) {
                let min = origin + vec2(x as f32 * dot, y as f32 * dot);
                ui.painter().rect_filled(
                    Rect::from_min_size(min, vec2(dot, dot)),
                    CornerRadius::ZERO,
                    color,
                );
            }
        }
    }
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

/// 枠線付きの矩形を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `rect` - 範囲
/// * `radius` - 角の丸み
/// * `fill` - 塗りの色
/// * `stroke` - 枠線
///
/// # 戻り値
///
/// 戻り値なし
pub fn framed(ui: &Ui, rect: Rect, radius: u8, fill: Color32, stroke: Stroke) {
    let radius = CornerRadius::same(radius);
    ui.painter().rect_filled(rect, radius, fill);
    ui.painter()
        .rect_stroke(rect, radius, stroke, StrokeKind::Inside);
}

/// 指定幅で折り返して文字を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `position` - 左上の位置
/// * `text` - 描く文字列
/// * `font` - フォント
/// * `color` - 文字の色
/// * `width` - 折り返す幅
///
/// # 戻り値
///
/// 描いた範囲
pub fn wrapped_text(
    ui: &Ui,
    position: Pos2,
    text: &str,
    font: FontId,
    color: Color32,
    width: f32,
) -> Rect {
    let galley = ui.painter().layout(text.to_owned(), font, color, width);
    let rect = Rect::from_min_size(position, galley.size());
    ui.painter().galley(position, galley, color);
    rect
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
