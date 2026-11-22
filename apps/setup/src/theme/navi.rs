//! キャラクターナビのテーマ
//!
//! 現代のノベルゲームのように、立ち絵、名前付きのメッセージウィンドウ、
//! 画面中央の選択肢で案内する。配色は PandD のロゴに合わせる

use std::collections::HashMap;

use eframe::egui::{
    self, Align2, Color32, ColorImage, Context, CornerRadius, Pos2, Rect, Shape, Stroke, TextEdit,
    TextureHandle, TextureOptions, Ui, Visuals, pos2, vec2,
};
use pandd_setup::ifw::Stage;

use super::{
    Action, Screen, Task, View, body, bold, centered_text, fit_line, framed, hit_area,
    palette::{CHARCOAL, CHARCOAL_SOFT, CORAL, CORAL_DEEP, CORAL_LIGHT, CORAL_MIST, WHITE},
    pixel, stage_label, vertical_gradient, wrapped_text,
};

/// 立ち絵の画像名と PNG
const PORTRAITS: &[(&str, &[u8])] = &[
    ("normal", include_bytes!("../../assets/navi/normal.png")),
    (
        "normal_blink",
        include_bytes!("../../assets/navi/normal_blink.png"),
    ),
    (
        "normal_talk",
        include_bytes!("../../assets/navi/normal_talk.png"),
    ),
    ("smile", include_bytes!("../../assets/navi/smile.png")),
    (
        "smile_talk",
        include_bytes!("../../assets/navi/smile_talk.png"),
    ),
    ("joy", include_bytes!("../../assets/navi/joy.png")),
    ("worried", include_bytes!("../../assets/navi/worried.png")),
    (
        "worried_talk",
        include_bytes!("../../assets/navi/worried_talk.png"),
    ),
    (
        "surprised",
        include_bytes!("../../assets/navi/surprised.png"),
    ),
];
/// 立ち絵の元画像の大きさ
const PORTRAIT_SIZE: egui::Vec2 = vec2(640.0, 960.0);
/// 元画像の中での顔の中心
const FACE_IN_PORTRAIT: egui::Vec2 = vec2(318.0, 196.0);
/// 選択肢とインストール先の枠を置く、ウィンドウの左端からの距離。章の見出しとそろえる
const CHOICE_LEFT: f32 = 22.0;
/// 選択肢とインストール先の枠の幅
const CHOICE_WIDTH: f32 = 330.0;
/// 立ち絵を表示する倍率
const PORTRAIT_SCALE: f32 = 0.6;
/// 台詞の文字送りの速さ（1秒あたりの文字数）
const CHARACTERS_PER_SECOND: f32 = 40.0;
/// 案内役の名前
const NAVI_NAME: &str = "こと";

/// 立ち絵のテクスチャ
pub struct Portraits {
    textures: HashMap<&'static str, TextureHandle>,
}

impl Portraits {
    /// 同梱の立ち絵を読み込み、GPU のテクスチャにする
    ///
    /// # 引数
    ///
    /// * `ctx` - テクスチャを登録する egui のコンテキスト
    ///
    /// # 戻り値
    ///
    /// すべての表情の立ち絵
    ///
    /// # エラー
    ///
    /// 同梱の PNG が壊れている場合は build の不備なので panic する
    pub fn load(ctx: &Context) -> Self {
        let textures = PORTRAITS
            .iter()
            .map(|&(name, bytes)| {
                let image = image::load_from_memory(bytes)
                    .unwrap_or_else(|error| panic!("立ち絵 {name} を読めません: {error}"))
                    .to_rgba8();
                let size = [image.width() as usize, image.height() as usize];
                let pixels = ColorImage::from_rgba_unmultiplied(size, image.as_raw());
                (name, ctx.load_texture(name, pixels, TextureOptions::LINEAR))
            })
            .collect();
        Self { textures }
    }

    /// 画像名からテクスチャを返す
    ///
    /// # 引数
    ///
    /// * `name` - 立ち絵の画像名
    ///
    /// # 戻り値
    ///
    /// 同梱の立ち絵のテクスチャ
    fn get(&self, name: &str) -> &TextureHandle {
        &self.textures[name]
    }
}

/// 案内役の表情
#[derive(Clone, Copy, PartialEq, Eq)]
enum Expression {
    /// 通常
    Normal,
    /// ほほえみ
    Smile,
    /// 大喜び。ウインクと頬の赤み
    Joy,
    /// 困り顔
    Worried,
    /// 驚き
    Surprised,
}

/// 1画面分の演出の内容
struct Scene<'a> {
    /// 表情
    expression: Expression,
    /// 台詞
    line: &'a str,
    /// 左上に出す章の番号と名前
    chapter: (&'a str, &'a str),
}

/// キャラクターナビの画面を描き、押された操作を返す
///
/// # 引数
///
/// * `ui` - ウィンドウ全体の描画先
/// * `view` - セットアップの今の状態
///
/// # 戻り値
///
/// 押されたボタンの操作。押されていなければ None
pub fn show(ui: &mut Ui, view: &mut View) -> Option<Action> {
    ui.ctx().set_visuals(Visuals::light());
    let area = ui.max_rect();
    let scene = scene_for(view);
    draw_background(ui, area, view.seconds);

    // 台詞を送っている間だけ口を動かし、ときどき瞬きさせる
    let total = scene.line.chars().count();
    let shown = ((view.screen_seconds * CHARACTERS_PER_SECOND) as usize).min(total);
    let typing = shown < total;
    let face = draw_portrait(ui, view, scene.expression, typing);
    draw_effects(ui, face, scene.expression, view.seconds);

    chapter_label(ui, scene.chapter);
    let line: String = scene.line.chars().take(shown).collect();
    let window = message_window(ui, &line, typing, view.seconds);

    match (view.screen, view.task) {
        (Screen::Menu, _) => {
            target(ui, view, typing, "インストール先");
            choices(
                ui,
                view,
                typing,
                &[
                    ("アップデートする", Action::Update),
                    ("アンインストールする", Action::ConfirmUninstall),
                    ("やめる", Action::Close),
                ],
            )
        }
        (Screen::Welcome, Task::Uninstall) => {
            target(ui, view, typing, "削除する場所");
            choices(
                ui,
                view,
                typing,
                &[
                    ("アンインストールする", Action::Uninstall),
                    ("もどる", Action::Back),
                ],
            )
        }
        (Screen::Welcome, _) => choices(
            ui,
            view,
            typing,
            &[("はじめる", Action::Next), ("やめる", Action::Close)],
        ),
        (Screen::Destination, _) => destination(ui, view),
        (Screen::Running, _) => {
            progress(ui, window, view);
            None
        }
        (Screen::Finished, Task::Uninstall) => {
            choices(ui, view, typing, &[("閉じる", Action::Close)])
        }
        (Screen::Finished, _) => choices(
            ui,
            view,
            typing,
            &[
                ("ランチャーを起動する", Action::Launch),
                ("閉じる", Action::Close),
            ],
        ),
        (Screen::Failed, _) => failed(ui, view),
    }
}

/// 画面ごとの表情、台詞、章を決める
///
/// # 引数
///
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 今の画面の演出
fn scene_for<'a>(view: &View<'a>) -> Scene<'a> {
    let task = view.task;
    match view.screen {
        Screen::Menu => Scene {
            expression: Expression::Smile,
            line: "こんにちは、ことです。今日はどうしますか？\nアップデートでも、アンインストールでもお手伝いしますよ。",
            chapter: ("MAINTENANCE", "メンテナンス"),
        },
        Screen::Welcome if task == Task::Uninstall => Scene {
            expression: Expression::Worried,
            line: "ランチャーをアンインストールするんですね…。\nゲームとセーブデータは別の場所にあるので、そのまま残りますよ。",
            chapter: ("UNINSTALL", "アンインストール"),
        },
        Screen::Welcome => Scene {
            expression: Expression::Smile,
            line: "はじめまして、案内役のことです。\nPandD Game Launcher の準備、いっしょに進めていきましょう！",
            chapter: ("STEP 1 / 4", "はじめまして"),
        },
        Screen::Destination if view.directory_problem.is_some() => Scene {
            expression: Expression::Surprised,
            line: "あっ、そのフォルダには置けないみたいです。\n別の場所を選んでもらえますか？",
            chapter: ("STEP 2 / 4", "インストール先"),
        },
        Screen::Destination => Scene {
            expression: Expression::Normal,
            line: "ランチャーはここに置きますね。\nほかの場所がよければ、左のパネルで変えられます。",
            chapter: ("STEP 2 / 4", "インストール先"),
        },
        Screen::Running => {
            let (expression, line) = match (task, view.progress.stage()) {
                (Task::Uninstall, _) => (
                    Expression::Normal,
                    "ランチャーのファイルを削除しています。\n少しだけ待っていてくださいね。",
                ),
                (Task::Update, Stage::Preparing) => (
                    Expression::Normal,
                    "新しいバージョンを確認しています。\n少しだけ待っていてくださいね。",
                ),
                (_, Stage::Preparing) => (
                    Expression::Normal,
                    "配信サーバーに問い合わせています。\n少しだけ待っていてくださいね。",
                ),
                (_, Stage::Downloading) => (
                    Expression::Smile,
                    "ダウンロード中です。\nゲームの更新は、ランチャーを起動するたびに自動で確認されますよ。",
                ),
                (_, Stage::Unpacking) => (
                    Expression::Smile,
                    "ファイルを展開しています。\n設定画面では、キャラクターの表示も切り替えられます。",
                ),
                (_, Stage::Finalizing | Stage::Removing) => (
                    Expression::Normal,
                    "もうすぐです！\n最後の仕上げをしていますね。",
                ),
            };
            Scene {
                expression,
                line,
                chapter: match task {
                    Task::Install => ("STEP 3 / 4", "インストール"),
                    Task::Update => ("UPDATE", "アップデート中"),
                    Task::Uninstall => ("UNINSTALL", "アンインストール中"),
                },
            }
        }
        Screen::Finished => match task {
            Task::Install => Scene {
                expression: Expression::Joy,
                line: "準備ができました！ さっそく遊びましょう。\nこれからよろしくお願いしますね♪",
                chapter: ("STEP 4 / 4", "完了"),
            },
            Task::Update if view.up_to_date => Scene {
                expression: Expression::Smile,
                line: "確認しましたが、もう最新のランチャーでした！\nこのまま遊べますよ。",
                chapter: ("UPDATE", "最新です"),
            },
            Task::Update => Scene {
                expression: Expression::Joy,
                line: "アップデート完了です！\n新しいランチャーで、また遊びましょうね。",
                chapter: ("UPDATE", "完了"),
            },
            Task::Uninstall => Scene {
                expression: Expression::Smile,
                line: "アンインストールが終わりました。\nこれまで遊んでくれて、ありがとうございました！\nまたいつでも待っていますね。",
                chapter: ("UNINSTALL", "完了"),
            },
        },
        Screen::Failed => Scene {
            expression: Expression::Worried,
            line: if task == Task::Uninstall {
                "ごめんなさい、削除できませんでした…。\nランチャーを閉じてから、もう一度試してもらえますか？"
            } else {
                "ごめんなさい、うまくいきませんでした…。\nネットワークと空き容量を確かめて、もう一度試してもらえますか？"
            },
            chapter: ("TROUBLE", "うまくいきませんでした"),
        },
    }
}

/// 白から淡いコーラルへのグラデーション、光の筋、浮かぶ玉ボケを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `area` - ウィンドウ全体
/// * `seconds` - 起動からの秒数
///
/// # 戻り値
///
/// 戻り値なし
fn draw_background(ui: &Ui, area: Rect, seconds: f32) {
    vertical_gradient(ui, area, WHITE, CORAL_MIST);
    let painter = ui.painter();

    // 左上から差し込む光の筋
    for (index, width) in [(0, 90.0), (1, 40.0), (2, 70.0)] {
        let x = area.left() + 120.0 + index as f32 * 150.0;
        painter.add(Shape::convex_polygon(
            vec![
                pos2(x, area.top()),
                pos2(x + width, area.top()),
                pos2(x + width - 260.0, area.bottom()),
                pos2(x - 260.0, area.bottom()),
            ],
            Color32::from_white_alpha(70),
            Stroke::NONE,
        ));
    }

    // ゆっくり昇っていく玉ボケ
    for index in 0..14u32 {
        let seed = index.wrapping_mul(2_654_435_761);
        let radius = 10.0 + (seed % 40) as f32;
        let speed = 6.0 + (seed % 7) as f32;
        let x = area.left() + (seed % 997) as f32 / 997.0 * area.width();
        let travel = area.height() + radius * 2.0;
        let y = area.bottom() + radius - ((seed / 7 % 500) as f32 + seconds * speed) % travel;
        let alpha = 22 + (seed % 30) as u8;
        painter.circle_filled(
            pos2(x, y),
            radius,
            Color32::from_rgba_unmultiplied(0xff, 0x67, 0x77, alpha),
        );
    }

    // ロゴのドット文字を透かしで大きく置く
    painter.text(
        pos2(area.left() - 10.0, area.bottom() - 150.0),
        Align2::LEFT_BOTTOM,
        "PandD",
        pixel(120.0),
        Color32::from_rgba_unmultiplied(0x3a, 0x3a, 0x3a, 10),
    );
}

/// 立ち絵を描き、顔の中心の位置を返す
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
/// * `expression` - 表情
/// * `talking` - 台詞を送っている途中なら true
///
/// # 戻り値
///
/// 画面上の顔の中心
fn draw_portrait(ui: &Ui, view: &View, expression: Expression, talking: bool) -> Pos2 {
    let area = ui.max_rect();

    // 口は台詞の間だけ開閉し、目は約4秒ごとに一瞬閉じる
    let mouth_open = talking && (view.seconds * 9.0) as i32 % 2 == 0;
    let blinking = view.seconds % 4.2 < 0.12;
    let name = match expression {
        Expression::Normal if mouth_open => "normal_talk",
        Expression::Normal if blinking => "normal_blink",
        Expression::Normal => "normal",
        Expression::Smile if mouth_open => "smile_talk",
        Expression::Smile => "smile",
        Expression::Joy => "joy",
        Expression::Worried if mouth_open => "worried_talk",
        Expression::Worried => "worried",
        Expression::Surprised => "surprised",
    };

    // 起動直後は右から滑り込み、その後は呼吸のようにわずかに上下させる
    let entrance = (view.seconds / 0.5).min(1.0);
    let ease = 1.0 - (1.0 - entrance).powi(3);
    let size = PORTRAIT_SIZE * PORTRAIT_SCALE;
    let breathe = (view.seconds * 1.6).sin() * 2.0;
    let left = area.left() + 330.0 + (1.0 - ease) * 40.0;
    let top = area.top() + 6.0 + breathe;
    let rect = Rect::from_min_size(pos2(left, top), size);
    ui.painter().image(
        view.portraits.get(name).id(),
        rect,
        Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
        Color32::from_white_alpha((ease * 255.0) as u8),
    );
    rect.min + FACE_IN_PORTRAIT * PORTRAIT_SCALE
}

/// 表情に合わせて頬の赤み、きらめき、驚きの記号を重ねる
///
/// # 引数
///
/// * `ui` - 描画先
/// * `face` - 顔の中心
/// * `expression` - 表情
/// * `seconds` - 起動からの秒数
///
/// # 戻り値
///
/// 戻り値なし
fn draw_effects(ui: &Ui, face: Pos2, expression: Expression, seconds: f32) {
    let painter = ui.painter();
    let blush = |alpha: u8| {
        for side in [-1.0, 1.0] {
            painter.add(Shape::ellipse_filled(
                face + vec2(side * 27.0, 18.0),
                vec2(13.0, 5.0),
                Color32::from_rgba_unmultiplied(0xff, 0x67, 0x77, alpha),
            ));
        }
    };
    match expression {
        Expression::Smile => blush(45),
        Expression::Joy => {
            blush(80);
            for (offset, phase) in [
                (vec2(-92.0, -60.0), 0.0),
                (vec2(88.0, -78.0), 1.3),
                (vec2(104.0, 6.0), 2.4),
            ] {
                let twinkle = ((seconds * 3.0 + phase).sin() + 1.0) / 2.0;
                sparkle(ui, face + offset, 6.0 + twinkle * 6.0, CORAL);
            }
        }
        Expression::Surprised => {
            let bounce = (seconds * 10.0).sin().abs() * 4.0;
            painter.text(
                face + vec2(70.0, -96.0 - bounce),
                Align2::CENTER_CENTER,
                "!",
                pixel(30.0),
                CORAL,
            );
        }
        Expression::Normal | Expression::Worried => {}
    }
}

/// 4方向に尖ったきらめきを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `center` - 中心
/// * `radius` - 先端までの長さ
/// * `color` - 色
///
/// # 戻り値
///
/// 戻り値なし
fn sparkle(ui: &Ui, center: Pos2, radius: f32, color: Color32) {
    let waist = radius * 0.28;
    for (tip, side) in [
        (vec2(0.0, -radius), vec2(waist, 0.0)),
        (vec2(radius, 0.0), vec2(0.0, waist)),
        (vec2(0.0, radius), vec2(-waist, 0.0)),
        (vec2(-radius, 0.0), vec2(0.0, -waist)),
    ] {
        ui.painter().add(Shape::convex_polygon(
            vec![center, center + side, center + tip, center - side],
            color,
            Stroke::NONE,
        ));
    }
}

/// 左上に章の番号と名前を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `chapter` - 章の番号と名前
///
/// # 戻り値
///
/// 戻り値なし
fn chapter_label(ui: &Ui, chapter: (&str, &str)) {
    let area = ui.max_rect();
    let origin = area.left_top() + vec2(22.0, 18.0);
    let number = Rect::from_min_size(origin, vec2(96.0, 24.0));
    ui.painter()
        .rect_filled(number, CornerRadius::same(12), CHARCOAL);
    centered_text(ui, number.center(), chapter.0, pixel(8.0), WHITE);
    ui.painter().text(
        number.right_center() + vec2(10.0, 0.0),
        Align2::LEFT_CENTER,
        chapter.1,
        bold(15.0),
        CHARCOAL,
    );
    ui.painter().line_segment(
        [
            number.left_bottom() + vec2(0.0, 8.0),
            number.left_bottom() + vec2(220.0, 8.0),
        ],
        Stroke::new(2.0, CORAL),
    );
}

/// 画面の下にあるメッセージウィンドウの範囲を返す
///
/// # 引数
///
/// * `area` - ウィンドウ全体
///
/// # 戻り値
///
/// メッセージウィンドウの範囲
fn message_rect(area: Rect) -> Rect {
    Rect::from_min_max(
        pos2(area.left() + 18.0, area.bottom() - 150.0),
        pos2(area.right() - 18.0, area.bottom() - 16.0),
    )
}

/// メッセージウィンドウの中で台詞を書ける範囲を返す
///
/// # 引数
///
/// * `window` - メッセージウィンドウの範囲
///
/// # 戻り値
///
/// 台詞を置く範囲
fn message_text_rect(window: Rect) -> Rect {
    window.shrink2(vec2(30.0, 28.0))
}

/// 台詞のフォントを返す
///
/// # 戻り値
///
/// 台詞に使う本文のフォント
fn message_font() -> egui::FontId {
    body(18.0)
}

/// 名前札付きのメッセージウィンドウに台詞を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `line` - 今まで送った台詞
/// * `typing` - 台詞を送っている途中なら true
/// * `seconds` - 起動からの秒数
///
/// # 戻り値
///
/// メッセージウィンドウの範囲
fn message_window(ui: &Ui, line: &str, typing: bool, seconds: f32) -> Rect {
    let window = message_rect(ui.max_rect());

    // 半透明の白い窓に、上辺だけコーラルの線を引く
    ui.painter().rect_filled(
        window.translate(vec2(0.0, 4.0)),
        CornerRadius::same(18),
        Color32::from_rgba_unmultiplied(0x3a, 0x3a, 0x3a, 28),
    );
    framed(
        ui,
        window,
        18,
        Color32::from_rgba_unmultiplied(0xff, 0xff, 0xff, 236),
        Stroke::new(1.5, CORAL_LIGHT),
    );
    ui.painter().line_segment(
        [
            window.left_top() + vec2(150.0, 1.0),
            window.right_top() + vec2(-24.0, 1.0),
        ],
        Stroke::new(3.0, CORAL),
    );

    // 名前札
    let plate = Rect::from_min_size(window.left_top() + vec2(20.0, -16.0), vec2(124.0, 32.0));
    ui.painter()
        .rect_filled(plate, CornerRadius::same(16), CORAL);
    ui.painter().text(
        plate.left_center() + vec2(18.0, 0.0),
        Align2::LEFT_CENTER,
        NAVI_NAME,
        bold(16.0),
        WHITE,
    );
    ui.painter().text(
        plate.right_center() - vec2(14.0, 0.0),
        Align2::RIGHT_CENTER,
        "KOTO",
        pixel(7.0),
        CORAL_MIST,
    );

    // 台詞は改行を入れて書いてあるので、折り返さずにそのまま描く
    let text = message_text_rect(window);
    ui.painter().text(
        text.left_top(),
        Align2::LEFT_TOP,
        line,
        message_font(),
        CHARCOAL,
    );

    // 台詞を送り終えたら、続きを促す印を弾ませる
    if !typing {
        let bounce = (seconds * 5.0).sin().abs() * 4.0;
        ui.painter().text(
            window.right_bottom() - vec2(28.0, 22.0 + bounce),
            Align2::CENTER_CENTER,
            "▼",
            bold(13.0),
            CORAL,
        );
    }
    window
}

/// 画面中央に選択肢のバーを並べる
///
/// # 引数
///
/// * `ui` - 配置先
/// * `view` - セットアップの状態
/// * `typing` - 台詞を送っている途中なら true。送り終えるまで出さない
/// * `options` - 選択肢の文言と操作
///
/// # 戻り値
///
/// 押された選択肢の操作
fn choices(ui: &mut Ui, view: &View, typing: bool, options: &[(&str, Action)]) -> Option<Action> {
    if typing {
        return None;
    }
    let area = ui.max_rect();
    let slide = (1.0 - ((view.screen_seconds - 0.1) * 4.0).clamp(0.0, 1.0)) * -20.0;
    let mut chosen = None;
    for (index, &(label, action)) in options.iter().enumerate() {
        let center = pos2(
            area.left() + CHOICE_LEFT + CHOICE_WIDTH / 2.0 + slide,
            area.top() + 150.0 + index as f32 * 58.0,
        );
        let rect = Rect::from_center_size(center, vec2(CHOICE_WIDTH, 46.0));
        if choice_bar(ui, rect, label) {
            chosen = Some(action);
        }
    }
    chosen
}

/// 選択肢の上に、メンテナンスの対象のインストール先を添える
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
/// * `typing` - 台詞を送っている途中なら true。送り終えるまで出さない
/// * `label` - 場所の見出し
///
/// # 戻り値
///
/// 戻り値なし
fn target(ui: &Ui, view: &View, typing: bool, label: &str) {
    if typing {
        return;
    }
    let area = ui.max_rect();
    let rect = Rect::from_min_size(
        pos2(area.left() + CHOICE_LEFT, area.top() + 66.0),
        vec2(CHOICE_WIDTH, 52.0),
    );
    framed(
        ui,
        rect,
        12,
        Color32::from_rgba_unmultiplied(0xff, 0xff, 0xff, 220),
        Stroke::new(1.0, CORAL_LIGHT),
    );
    let inner = rect.shrink2(vec2(14.0, 8.0));
    ui.painter().text(
        inner.left_top(),
        Align2::LEFT_TOP,
        label,
        bold(11.0),
        CORAL_DEEP,
    );
    let font = body(11.0);
    ui.painter().text(
        inner.left_top() + vec2(0.0, 16.0),
        Align2::LEFT_TOP,
        fit_line(ui, view.final_root, &font, inner.width()),
        font,
        CHARCOAL_SOFT,
    );
}

/// ノベルゲームの選択肢のバーを描き、押されたかを返す
///
/// # 引数
///
/// * `ui` - 配置先
/// * `rect` - バーの範囲
/// * `label` - 文言
///
/// # 戻り値
///
/// 押されたら true
fn choice_bar(ui: &mut Ui, rect: Rect, label: &str) -> bool {
    let response = hit_area(ui, rect);
    let hovered = response.hovered();
    let rect = rect.translate(vec2(if hovered { 6.0 } else { 0.0 }, 0.0));
    let (fill, text, accent) = if hovered {
        (CORAL, WHITE, WHITE)
    } else {
        (
            Color32::from_rgba_unmultiplied(0xff, 0xff, 0xff, 230),
            CHARCOAL,
            CORAL,
        )
    };
    ui.painter().rect_filled(
        rect.translate(vec2(0.0, 3.0)),
        CornerRadius::same(23),
        Color32::from_rgba_unmultiplied(0x3a, 0x3a, 0x3a, 24),
    );
    framed(ui, rect, 23, fill, Stroke::new(1.5, CORAL_LIGHT));
    ui.painter()
        .circle_filled(rect.left_center() + vec2(24.0, 0.0), 5.0, accent);
    centered_text(ui, rect.center(), label, bold(16.0), text);
    response.clicked()
}

/// 角の丸い小さなボタンを描き、押されたかを返す
///
/// # 引数
///
/// * `ui` - 配置先
/// * `rect` - ボタンの範囲
/// * `label` - 文言
/// * `primary` - コーラルの主ボタンなら true
///
/// # 戻り値
///
/// 押されたら true
fn small_button(ui: &mut Ui, rect: Rect, label: &str, primary: bool) -> bool {
    let response = hit_area(ui, rect);
    let (fill, text) = match (primary, response.hovered()) {
        (true, false) => (CORAL, WHITE),
        (true, true) => (CORAL_DEEP, WHITE),
        (false, false) => (WHITE, CHARCOAL),
        (false, true) => (CORAL_MIST, CHARCOAL),
    };
    let border = if primary { fill } else { CORAL_LIGHT };
    framed(ui, rect, 10, fill, Stroke::new(1.5, border));
    centered_text(ui, rect.center(), label, bold(13.0), text);
    response.clicked()
}

/// 左側の半透明パネルを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `title` - パネルの見出し
///
/// # 戻り値
///
/// パネルの内側の範囲
fn panel(ui: &Ui, title: &str) -> Rect {
    let area = ui.max_rect();
    let rect = Rect::from_min_size(area.left_top() + vec2(22.0, 66.0), vec2(400.0, 250.0));
    framed(
        ui,
        rect,
        16,
        Color32::from_rgba_unmultiplied(0xff, 0xff, 0xff, 232),
        Stroke::new(1.5, CORAL_LIGHT),
    );
    ui.painter().text(
        rect.left_top() + vec2(20.0, 16.0),
        Align2::LEFT_TOP,
        title,
        bold(15.0),
        CHARCOAL,
    );
    rect.shrink2(vec2(20.0, 16.0))
}

/// インストール先を選ぶパネルを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 押されたボタンの操作
fn destination(ui: &mut Ui, view: &mut View) -> Option<Action> {
    let inner = panel(ui, "インストール先");

    // フォルダの入力欄、参照ボタン、既定値に戻すボタン
    let field = Rect::from_min_size(
        inner.left_top() + vec2(0.0, 34.0),
        vec2(inner.width() - 84.0, 32.0),
    );
    ui.put(
        field,
        TextEdit::singleline(view.root_text)
            .font(body(13.0))
            .text_color(CHARCOAL)
            .margin(egui::Margin::symmetric(8, 7)),
    );
    let mut chosen = None;
    let browse = Rect::from_min_size(field.right_top() + vec2(8.0, 0.0), vec2(76.0, 32.0));
    if small_button(ui, browse, "参照…", false) {
        chosen = Some(Action::Browse);
    }
    let reset = Rect::from_min_size(field.left_bottom() + vec2(0.0, 8.0), vec2(160.0, 26.0));
    if small_button(ui, reset, "おすすめの場所に戻す", false) {
        chosen = Some(Action::UseDefault);
    }

    // 実際のインストール先と問題を添える
    let (note, color) = match view.directory_problem {
        Some(problem) => (problem.to_owned(), CORAL_DEEP),
        None => (
            fit_line(
                ui,
                &format!("インストール先: {}", view.final_root),
                &body(12.0),
                inner.width(),
            ),
            CHARCOAL_SOFT,
        ),
    };
    wrapped_text(
        ui,
        reset.left_bottom() + vec2(0.0, 10.0),
        &note,
        body(12.0),
        color,
        inner.width(),
    );

    let install = Rect::from_min_size(inner.left_bottom() - vec2(0.0, 38.0), vec2(200.0, 38.0));
    let back = Rect::from_min_size(install.right_top() + vec2(10.0, 0.0), vec2(110.0, 38.0));
    if small_button(ui, install, "ここにインストール", true) {
        chosen = Some(Action::Install);
    }
    if small_button(ui, back, "もどる", false) {
        chosen = Some(Action::Back);
    }
    chosen
}

/// メッセージウィンドウの下端に進捗を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `window` - メッセージウィンドウの範囲
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 戻り値なし
fn progress(ui: &Ui, window: Rect, view: &View) {
    let fraction = view.progress.fraction();
    let bar = Rect::from_min_size(
        window.left_bottom() + vec2(30.0, -24.0),
        vec2(window.width() - 220.0, 6.0),
    );
    ui.painter()
        .rect_filled(bar, CornerRadius::same(3), CORAL_MIST);
    ui.painter().rect_filled(
        Rect::from_min_size(bar.min, vec2(bar.width() * fraction, bar.height())),
        CornerRadius::same(3),
        CORAL,
    );

    // 先端に脈打つ点を置いて、止まっていないことを伝える
    let glow = bar.left_center() + vec2(bar.width() * fraction, 0.0);
    let pulse = ((view.seconds * 4.0).sin() + 1.0) / 2.0;
    ui.painter()
        .circle_filled(glow, 4.0 + pulse * 2.0, CORAL_LIGHT);
    ui.painter().circle_filled(glow, 3.0, CORAL);
    ui.painter().text(
        bar.right_center() + vec2(14.0, 0.0),
        Align2::LEFT_CENTER,
        format!(
            "{} {}%",
            stage_label(view.progress.stage()),
            (fraction * 100.0) as u32
        ),
        body(11.0),
        CHARCOAL_SOFT,
    );
}

/// 失敗の内容をパネルに出し、操作のボタンを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 押されたボタンの操作
fn failed(ui: &mut Ui, view: &View) -> Option<Action> {
    let inner = panel(ui, "エラーの内容");
    let detail = Rect::from_min_max(
        inner.left_top() + vec2(0.0, 30.0),
        inner.right_bottom() - vec2(0.0, 48.0),
    );
    ui.painter()
        .rect_filled(detail, CornerRadius::same(8), CORAL_MIST);
    let clip = detail.shrink(8.0);
    let galley = ui.painter().layout(
        view.failure.to_owned(),
        body(11.0),
        CHARCOAL_SOFT,
        clip.width(),
    );
    ui.painter()
        .with_clip_rect(clip)
        .galley(clip.left_top(), galley, CHARCOAL_SOFT);

    let retry = Rect::from_min_size(inner.left_bottom() - vec2(0.0, 38.0), vec2(160.0, 38.0));
    let close = Rect::from_min_size(retry.right_top() + vec2(10.0, 0.0), vec2(110.0, 38.0));
    if small_button(ui, retry, "もう一度試す", true) {
        return Some(Action::Retry);
    }
    small_button(ui, close, "閉じる", false).then_some(Action::Close)
}

#[cfg(test)]
mod tests {
    use eframe::egui::{Context, RawInput, Rect, pos2, vec2};
    use pandd_setup::{ifw::Stage, progress::Progress};

    use super::*;

    /// すべての画面の台詞が、自動で折り返さずにメッセージウィンドウへ収まることを確かめる
    #[test]
    fn every_line_fits_the_message_window() {
        // 本番と同じフォントを読み込み、1フレーム回して反映する
        let ctx = Context::default();
        crate::app::install_fonts(&ctx);
        let _ = ctx.run_ui(RawInput::default(), |_| {});

        // 本番のウィンドウの大きさから、台詞を書ける範囲を求める
        let area = Rect::from_min_size(pos2(0.0, 0.0), vec2(760.0, 490.0));
        let text = message_text_rect(message_rect(area));

        let portraits = Portraits::load(&ctx);
        let stages = [
            Stage::Preparing,
            Stage::Downloading,
            Stage::Unpacking,
            Stage::Finalizing,
            Stage::Removing,
        ];
        let screens = [
            Screen::Menu,
            Screen::Welcome,
            Screen::Destination,
            Screen::Running,
            Screen::Finished,
            Screen::Failed,
        ];
        for task in [Task::Install, Task::Update, Task::Uninstall] {
            for screen in screens {
                for stage in stages {
                    for (problem, up_to_date) in
                        [(None, false), (Some("問題"), false), (None, true)]
                    {
                        let mut progress = Progress::default();
                        progress.enter(stage);
                        let mut root = String::new();
                        let view = View {
                            task,
                            screen,
                            root_text: &mut root,
                            default_root: "",
                            final_root: "",
                            directory_problem: problem,
                            progress: &progress,
                            failure: "",
                            screen_seconds: 0.0,
                            seconds: 0.0,
                            up_to_date,
                            game: None,
                            portraits: &portraits,
                        };
                        let line = scene_for(&view).line;
                        let galley = ctx.fonts_mut(|fonts| {
                            fonts.layout_no_wrap(line.to_owned(), message_font(), CHARCOAL)
                        });
                        assert!(galley.size().x <= text.width(), "横にはみ出す台詞: {line}");
                        assert!(galley.size().y <= text.height(), "縦にはみ出す台詞: {line}");
                    }
                }
            }
        }
    }
}
