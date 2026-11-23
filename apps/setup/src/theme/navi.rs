//! キャラクターナビのテーマ
//!
//! 恋愛 ADV のプレイ画面のように、画面中央の立ち絵の下を暗く沈め、
//! 縁取りした白文字で台詞を出す。左上に章のリボン、左下にロゴ、
//! 右下に文字とアイコンのメニューを置き、選択肢は画面中央に重ねる。
//! 背景は会津大学のキャンパスを描いた絵で、手順に合わせて昼、夕方、夜と移る。
//! 配色は PandD のロゴのコーラルに合わせる

use std::collections::HashMap;

use eframe::egui::{
    self, Align2, Color32, ColorImage, Context, CornerRadius, FontId, Id, Painter, Pos2, Rect,
    Shape, Stroke, StrokeKind, TextureFilter, TextureHandle, TextureOptions, Ui, Visuals, pos2,
    vec2,
};
use pandd_setup::ifw::Stage;

use super::{
    Action, Screen, Task, View, body, bold, centered_text, fit_line, hit_area,
    palette::{CORAL, CORAL_DEEP, CORAL_LIGHT, WHITE},
    pixel, stage_label, vertical_gradient,
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
/// 立ち絵を表示する倍率。腰から上が画面に入る
const PORTRAIT_SCALE: f32 = 0.72;
/// 立ち絵の上端の、ウィンドウの上端からの距離
const PORTRAIT_TOP: f32 = 96.0;
/// 台詞の文字送りの速さ（1秒あたりの文字数）
const CHARACTERS_PER_SECOND: f32 = 40.0;
/// 案内役の名前
const NAVI_NAME: &str = "こと";
/// 名前と台詞の書き出しの、ウィンドウの左端からの距離。左下のロゴを避ける
const MESSAGE_LEFT: f32 = 150.0;
/// 名前の行の、ウィンドウの上端からの距離
const MESSAGE_TOP: f32 = 358.0;
/// 台詞を書ける幅
const MESSAGE_WIDTH: f32 = 586.0;
/// 台詞を書ける高さ。3行まで
const MESSAGE_HEIGHT: f32 = 72.0;
/// 選択肢の幅
const CHOICE_WIDTH: f32 = 400.0;
/// 最初の選択肢の上端の、ウィンドウの上端からの距離
const CHOICE_TOP: f32 = 112.0;
/// 下部を沈めるグラデーションの高さ
const FADE_HEIGHT: f32 = 180.0;

/// 縁取りや沈んだ部分に使う、コーラルを焦がした色
const EMBER: Color32 = Color32::from_rgb(0x6b, 0x22, 0x34);
/// リボンと選択中の選択肢の色
const BERRY: Color32 = Color32::from_rgb(0xc9, 0x44, 0x68);
/// 選択肢の文字の色
const BERRY_TEXT: Color32 = Color32::from_rgb(0xb7, 0x37, 0x5c);
/// アイコンと星のゲージの色
const GOLD: Color32 = Color32::from_rgb(0xff, 0xcc, 0x33);
/// メニューの文字の色
const BLUSH: Color32 = Color32::from_rgb(0xff, 0xe3, 0xe7);

/// 会津大学周辺の背景。昼、夕方、夜の順
const BACKGROUNDS: [&[u8]; 3] = [
    include_bytes!("../../assets/navi/background-day.jpg"),
    include_bytes!("../../assets/navi/background-evening.jpg"),
    include_bytes!("../../assets/navi/background-night.jpg"),
];
/// 左下に出す PandD のロゴの PNG
const LOGO: &[u8] = include_bytes!("../../../../assets/images/PandDLogo.png");
/// ロゴの PNG の中で、文字のある範囲（縦横 0〜1 の割合）
const LOGO_UV: Rect = Rect {
    min: pos2(0.068, 0.336),
    max: pos2(0.955, 0.598),
};
/// 画面に出すロゴの幅
const LOGO_WIDTH: f32 = 130.0;

/// キャラクターナビで使う画像のテクスチャ
pub struct Images {
    /// 表情ごとの立ち絵
    portraits: HashMap<&'static str, TextureHandle>,
    /// PandD のロゴ
    logo: TextureHandle,
    /// 昼の背景
    day: TextureHandle,
    /// 夕方の背景
    evening: TextureHandle,
    /// 夜の背景
    night: TextureHandle,
}

impl Images {
    /// 同梱の立ち絵、ロゴ、背景を読み込み、GPU のテクスチャにする
    ///
    /// # 引数
    ///
    /// * `ctx` - テクスチャを登録する egui のコンテキスト
    ///
    /// # 戻り値
    ///
    /// すべての表情の立ち絵、ロゴ、時間帯ごとの背景
    ///
    /// # エラー
    ///
    /// 同梱の画像が壊れている場合は build の不備なので panic する
    pub fn load(ctx: &Context) -> Self {
        let portraits = PORTRAITS
            .iter()
            .map(|&(name, bytes)| (name, load_texture(ctx, name, bytes)))
            .collect();
        let [day, evening, night] = BACKGROUNDS;
        Self {
            portraits,
            logo: load_texture(ctx, "logo", LOGO),
            day: load_texture(ctx, "background-day", day),
            evening: load_texture(ctx, "background-evening", evening),
            night: load_texture(ctx, "background-night", night),
        }
    }

    /// 画像名から立ち絵のテクスチャを返す
    ///
    /// # 引数
    ///
    /// * `name` - 立ち絵の画像名
    ///
    /// # 戻り値
    ///
    /// 同梱の立ち絵のテクスチャ
    fn portrait(&self, name: &str) -> &TextureHandle {
        &self.portraits[name]
    }
}

/// 同梱の PNG か JPEG を GPU のテクスチャにする
///
/// # 引数
///
/// * `ctx` - テクスチャを登録する egui のコンテキスト
/// * `name` - テクスチャの名前
/// * `bytes` - 画像のバイト列
///
/// # 戻り値
///
/// 登録したテクスチャ
///
/// # エラー
///
/// 同梱の画像が壊れている場合は build の不備なので panic する
fn load_texture(ctx: &Context, name: &str, bytes: &[u8]) -> TextureHandle {
    upload(ctx, name, &decode(name, bytes))
}

/// 同梱の画像を RGBA に展開する
///
/// # 引数
///
/// * `name` - エラーに出す画像の名前
/// * `bytes` - 画像のバイト列
///
/// # 戻り値
///
/// 展開した画像
///
/// # エラー
///
/// 同梱の画像が壊れている場合は build の不備なので panic する
fn decode(name: &str, bytes: &[u8]) -> image::RgbaImage {
    image::load_from_memory(bytes)
        .unwrap_or_else(|error| panic!("画像 {name} を読めません: {error}"))
        .to_rgba8()
}

/// 展開した画像を GPU のテクスチャにする
///
/// # 引数
///
/// * `ctx` - テクスチャを登録する egui のコンテキスト
/// * `name` - テクスチャの名前
/// * `image` - 展開した画像
///
/// # 戻り値
///
/// 登録したテクスチャ
fn upload(ctx: &Context, name: &str, image: &image::RgbaImage) -> TextureHandle {
    let size = [image.width() as usize, image.height() as usize];
    let pixels = ColorImage::from_rgba_unmultiplied(size, image.as_raw());

    // 縮小して表示するので、ミップマップでギザギザを抑える
    let options = TextureOptions::LINEAR.with_mipmap_mode(Some(TextureFilter::Linear));
    ctx.load_texture(name, pixels, options)
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

/// 背景にする会津大学周辺の時間帯
#[derive(Clone, Copy, PartialEq, Eq)]
enum Sky {
    /// 昼。はじめましてと選ぶ画面
    Day,
    /// 夕方。実行中とアンインストール
    Evening,
    /// 夜。完了
    Night,
    /// 夕方を暗く沈めたもの。失敗
    Gloomy,
}

/// 1画面分の演出の内容
struct Scene<'a> {
    /// 表情
    expression: Expression,
    /// 台詞
    line: &'a str,
    /// 左上のリボンに出す章
    chapter: &'a str,
    /// 背景の時間帯
    sky: Sky,
}

/// 選択肢の文言、補足、操作
struct Choice<'a> {
    /// 文言
    label: &'a str,
    /// 文言の下に添える補足。なければ None
    note: Option<(String, Color32)>,
    /// 押したときの操作
    action: Action,
}

/// 右下のメニューで押されたもの
enum MenuPress {
    /// セットアップの操作
    Action(Action),
    /// ログを開くか閉じる
    Log,
    /// 台詞を最後まで送る
    Skip,
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
    draw_background(ui, area, view.images, scene.sky, view.seconds);

    // 台詞を送っている間だけ口を動かし、スキップされたら最後まで出す
    let total = scene.line.chars().count();
    let shown = if skipped(ui, view) {
        total
    } else {
        ((view.screen_seconds * CHARACTERS_PER_SECOND) as usize).min(total)
    };
    let typing = shown < total;
    let face = draw_portrait(ui, view, scene.expression, typing);
    draw_effects(ui, face, scene.expression, view.seconds);

    // 下部を沈め、ロゴ、章、台詞を重ねる
    let fade = Rect::from_min_max(pos2(area.left(), area.bottom() - FADE_HEIGHT), area.max);
    draw_fade(ui, fade);
    chapter_ribbon(ui, scene.chapter);
    logo(ui, view.images);
    let line: String = scene.line.chars().take(shown).collect();
    message(ui, &dialogue(&line));
    match view.screen {
        Screen::Running => progress_gauge(ui, view),
        Screen::Failed => failure_card(ui, view),
        _ => {}
    }

    // ログを開いている間は選択肢を隠す
    let log_id = Id::new("navi-log");
    let log_open = ui.data(|data| data.get_temp::<bool>(log_id).unwrap_or(false));
    let chosen = if log_open {
        log_panel(ui, view).then(|| ui.data_mut(|data| data.insert_temp(log_id, false)));
        None
    } else if typing {
        None
    } else {
        choices(ui, view, &choices_for(ui, view))
    };

    let pressed = menu_bar(ui, view, typing);
    match pressed {
        Some(MenuPress::Action(action)) => Some(action),
        Some(MenuPress::Log) => {
            ui.data_mut(|data| data.insert_temp(log_id, !log_open));
            chosen
        }
        Some(MenuPress::Skip) => {
            let start = view.seconds - view.screen_seconds;
            ui.data_mut(|data| data.insert_temp(Id::new("navi-skip"), start));
            chosen
        }
        None => chosen,
    }
}

/// 今の画面の台詞がスキップされたかを返す
///
/// スキップした画面の開始時刻を覚えておき、同じ画面にいる間だけ有効にする
///
/// # 引数
///
/// * `ui` - スキップの記録を読む
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// スキップされていれば true
fn skipped(ui: &Ui, view: &View) -> bool {
    let start = view.seconds - view.screen_seconds;
    ui.data(|data| data.get_temp::<f32>(Id::new("navi-skip")))
        .is_some_and(|skipped_at| (skipped_at - start).abs() < 0.01)
}

/// 画面ごとの表情、台詞、章、背景を決める
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
            chapter: "Maintenance",
            sky: Sky::Day,
        },
        Screen::Welcome if task == Task::Uninstall => Scene {
            expression: Expression::Worried,
            line: "ランチャーをアンインストールするんですね…。\nゲームとセーブデータは別の場所にあるので、そのまま残りますよ。",
            chapter: "Uninstall",
            sky: Sky::Evening,
        },
        Screen::Welcome => Scene {
            expression: Expression::Smile,
            line: "はじめまして、案内役のことです。\nPandD Game Launcher の準備、いっしょに進めていきましょう！",
            chapter: "Step 1 / 4",
            sky: Sky::Day,
        },
        Screen::Destination if view.directory_problem.is_some() => Scene {
            expression: Expression::Surprised,
            line: "あっ、そのフォルダには置けないみたいです。\n別の場所を選んでもらえますか？",
            chapter: "Step 2 / 4",
            sky: Sky::Day,
        },
        Screen::Destination => Scene {
            expression: Expression::Normal,
            line: "ランチャーはここに置きますね。\nほかの場所がよければ、選び直してください。",
            chapter: "Step 2 / 4",
            sky: Sky::Day,
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
                    "ファイルを展開しています。\n右下の System で、アーケードの画面にも切り替えられます。",
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
                    Task::Install => "Step 3 / 4",
                    Task::Update => "Update",
                    Task::Uninstall => "Uninstall",
                },
                sky: Sky::Evening,
            }
        }
        Screen::Finished => match task {
            Task::Install => Scene {
                expression: Expression::Joy,
                line: "準備ができました！ さっそく遊びましょう。\nこれからよろしくお願いしますね♪",
                chapter: "Step 4 / 4",
                sky: Sky::Night,
            },
            Task::Update if view.up_to_date => Scene {
                expression: Expression::Smile,
                line: "確認しましたが、もう最新のランチャーでした！\nこのまま遊べますよ。",
                chapter: "Update",
                sky: Sky::Night,
            },
            Task::Update => Scene {
                expression: Expression::Joy,
                line: "アップデート完了です！\n新しいランチャーで、また遊びましょうね。",
                chapter: "Update",
                sky: Sky::Night,
            },
            Task::Uninstall => Scene {
                expression: Expression::Smile,
                line: "アンインストールが終わりました。\nこれまで遊んでくれて、ありがとうございました！\nまたいつでも待っていますね。",
                chapter: "Uninstall",
                sky: Sky::Night,
            },
        },
        Screen::Failed => Scene {
            expression: Expression::Worried,
            line: if task == Task::Uninstall {
                "ごめんなさい、削除できませんでした…。\nランチャーを閉じてから、もう一度試してもらえますか？"
            } else {
                "ごめんなさい、うまくいきませんでした…。\nネットワークと空き容量を確かめて、もう一度試してもらえますか？"
            },
            chapter: "Trouble",
            sky: Sky::Gloomy,
        },
    }
}

/// 画面ごとの選択肢を決める
///
/// # 引数
///
/// * `ui` - インストール先を幅に収めるために使う
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 上から並べる選択肢。実行中は空
fn choices_for<'a>(ui: &Ui, view: &View) -> Vec<Choice<'a>> {
    let choice = |label, action| Choice {
        label,
        note: None,
        action,
    };
    let room = CHOICE_WIDTH - 40.0;
    let target = Some((fit_line(ui, view.final_root, &body(11.0), room), BERRY_TEXT));
    match (view.screen, view.task) {
        (Screen::Menu, _) => vec![
            Choice {
                label: "アップデートする",
                note: target,
                action: Action::Update,
            },
            choice("アンインストールする", Action::ConfirmUninstall),
            choice("閉じる", Action::Close),
        ],
        (Screen::Welcome, Task::Uninstall) => vec![
            Choice {
                label: "アンインストールする",
                note: target,
                action: Action::Uninstall,
            },
            choice("もどる", Action::Back),
        ],
        (Screen::Welcome, _) => vec![
            choice("はじめる", Action::Next),
            choice("やめる", Action::Close),
        ],
        (Screen::Destination, _) => {
            // 問題があればインストールの選択肢に赤で添える
            let note = match view.directory_problem {
                Some(problem) => (fit_line(ui, problem, &body(11.0), room), CORAL_DEEP),
                None => (fit_line(ui, view.final_root, &body(11.0), room), BERRY_TEXT),
            };
            let mut options = vec![
                Choice {
                    label: "ここにインストールする",
                    note: Some(note),
                    action: Action::Install,
                },
                choice("別のフォルダを選ぶ…", Action::Browse),
            ];
            if view.root_text.trim() != view.default_root {
                options.push(choice("おすすめの場所に戻す", Action::UseDefault));
            }
            options
        }
        (Screen::Running, _) => Vec::new(),
        (Screen::Finished, Task::Uninstall) => vec![choice("閉じる", Action::Close)],
        (Screen::Finished, _) => vec![
            choice("さっそく遊ぶ", Action::Launch),
            choice("閉じる", Action::Close),
        ],
        (Screen::Failed, _) => vec![
            choice("もう一度試す", Action::Retry),
            choice("閉じる", Action::Close),
        ],
    }
}

/// 時間帯に合わせた会津大学周辺の背景と、浮かぶ玉ボケを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `area` - ウィンドウ全体
/// * `images` - 背景のテクスチャ
/// * `sky` - 時間帯
/// * `seconds` - 起動からの秒数
///
/// # 戻り値
///
/// 戻り値なし
fn draw_background(ui: &Ui, area: Rect, images: &Images, sky: Sky, seconds: f32) {
    let painter = ui.painter();
    let background = match sky {
        Sky::Day => &images.day,
        Sky::Evening | Sky::Gloomy => &images.evening,
        Sky::Night => &images.night,
    };
    painter.image(
        background.id(),
        area,
        Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
        Color32::WHITE,
    );

    // 失敗の画面は夕方を灰色に沈める
    if sky == Sky::Gloomy {
        painter.rect_filled(
            area,
            CornerRadius::ZERO,
            Color32::from_rgba_unmultiplied(0x2a, 0x2c, 0x3c, 120),
        );
    }

    // ゆっくり昇っていく玉ボケ
    for index in 0..12u32 {
        let seed = index.wrapping_mul(2_654_435_761);
        let radius = 14.0 + (seed % 40) as f32;
        let speed = 5.0 + (seed % 7) as f32;
        let x = area.left() + (seed % 997) as f32 / 997.0 * area.width();
        let travel = area.height() + radius * 2.0;
        let y = area.bottom() + radius - ((seed / 7 % 500) as f32 + seconds * speed) % travel;
        let alpha = 18 + (seed % 24) as u8;
        painter.circle_filled(pos2(x, y), radius, Color32::from_white_alpha(alpha));
        painter.circle_filled(
            pos2(x, y),
            radius * 0.6,
            Color32::from_rgba_unmultiplied(0xff, 0xb8, 0xc0, alpha / 2),
        );
    }
}

/// 立ち絵を画面中央に描き、顔の中心の位置を返す
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

    // 起動直後は下から浮かび上がり、その後は呼吸のようにわずかに上下させる
    let entrance = (view.seconds / 0.5).min(1.0);
    let ease = 1.0 - (1.0 - entrance).powi(3);
    let size = PORTRAIT_SIZE * PORTRAIT_SCALE;
    let breathe = (view.seconds * 1.6).sin() * 2.0;
    let left = area.center().x - size.x / 2.0;
    let top = area.top() + PORTRAIT_TOP + breathe + (1.0 - ease) * 30.0;
    let rect = Rect::from_min_size(pos2(left, top), size);
    ui.painter().image(
        view.images.portrait(name).id(),
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
                face + vec2(side * 32.0, 22.0),
                vec2(15.0, 6.0),
                Color32::from_rgba_unmultiplied(0xff, 0x67, 0x77, alpha),
            ));
        }
    };
    match expression {
        Expression::Smile => blush(32),
        Expression::Joy => {
            blush(80);
            for (offset, phase) in [
                (vec2(-110.0, -70.0), 0.0),
                (vec2(106.0, -92.0), 1.3),
                (vec2(124.0, 8.0), 2.4),
            ] {
                let twinkle = ((seconds * 3.0 + phase).sin() + 1.0) / 2.0;
                sparkle(ui, face + offset, 7.0 + twinkle * 7.0, GOLD);
            }
        }
        Expression::Surprised => {
            let bounce = (seconds * 10.0).sin().abs() * 4.0;
            outlined(
                painter,
                face + vec2(84.0, -112.0 - bounce),
                Align2::CENTER_CENTER,
                "!",
                pixel(32.0),
                CORAL,
                WHITE,
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

/// 縁取りした文字を描く
///
/// # 引数
///
/// * `painter` - 描画先
/// * `position` - 文字の基準位置
/// * `align` - 基準位置に対する揃え
/// * `text` - 文字列。改行を含んでよい
/// * `font` - フォント
/// * `color` - 文字の色
/// * `outline` - 縁取りの色
///
/// # 戻り値
///
/// 描いた範囲
fn outlined(
    painter: &Painter,
    position: Pos2,
    align: Align2,
    text: &str,
    font: FontId,
    color: Color32,
    outline: Color32,
) -> Rect {
    for (dx, dy) in [
        (-1.5, -1.5),
        (0.0, -1.5),
        (1.5, -1.5),
        (-1.5, 0.0),
        (1.5, 0.0),
        (-1.5, 1.5),
        (0.0, 1.5),
        (1.5, 1.5),
    ] {
        painter.text(position + vec2(dx, dy), align, text, font.clone(), outline);
    }
    painter.text(position, align, text, font, color)
}

/// 画面の下部を、透明からコーラル、焦げたコーラルへと沈める
///
/// # 引数
///
/// * `ui` - 描画先
/// * `fade` - 沈める範囲
///
/// # 戻り値
///
/// 戻り値なし
fn draw_fade(ui: &Ui, fade: Rect) {
    let split = fade.top() + fade.height() * 0.38;
    vertical_gradient(
        ui,
        Rect::from_min_max(fade.min, pos2(fade.right(), split)),
        Color32::TRANSPARENT,
        Color32::from_rgba_unmultiplied(0xd9, 0x4a, 0x5b, 140),
    );
    vertical_gradient(
        ui,
        Rect::from_min_max(pos2(fade.left(), split), fade.max),
        Color32::from_rgba_unmultiplied(0xd9, 0x4a, 0x5b, 140),
        Color32::from_rgba_unmultiplied(0x78, 0x24, 0x34, 225),
    );
}

/// 左上に、白い縁と渦巻きの飾りが付いた章のリボンを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `chapter` - 章
///
/// # 戻り値
///
/// 戻り値なし
fn chapter_ribbon(ui: &Ui, chapter: &str) {
    let area = ui.max_rect();
    let painter = ui.painter();
    let font = bold(19.0);
    let text_width = painter
        .layout_no_wrap(chapter.to_owned(), font.clone(), WHITE)
        .size()
        .x;

    // 左端は画面の外へ出して、縁取りを右側だけに見せる
    let rect = Rect::from_min_size(
        pos2(area.left() - 4.0, area.top() + 24.0),
        vec2(text_width + 74.0, 40.0),
    );
    let radius = CornerRadius {
        nw: 0,
        sw: 0,
        ne: 12,
        se: 12,
    };
    painter.rect_filled(
        rect.translate(vec2(0.0, 3.0)),
        radius,
        EMBER.gamma_multiply(0.35),
    );
    painter.rect_filled(rect, radius, BERRY);
    painter.rect_filled(
        Rect::from_min_max(rect.min, pos2(rect.right(), rect.center().y)),
        CornerRadius {
            nw: 0,
            sw: 0,
            ne: 12,
            se: 0,
        },
        Color32::from_rgba_unmultiplied(0xff, 0xff, 0xff, 24),
    );
    painter.rect_stroke(rect, radius, Stroke::new(2.0, WHITE), StrokeKind::Inside);
    outlined(
        painter,
        rect.left_center() + vec2(26.0, 0.0),
        Align2::LEFT_CENTER,
        chapter,
        font,
        WHITE,
        EMBER,
    );

    // 右端の渦巻き
    let center = rect.right_center() - vec2(22.0, 0.0);
    let points: Vec<Pos2> = (0..40)
        .map(|step| {
            let t = step as f32 / 39.0;
            let angle = t * std::f32::consts::TAU * 1.6;
            center + vec2(angle.cos(), angle.sin()) * (2.0 + t * 8.0)
        })
        .collect();
    painter.add(Shape::line(points, Stroke::new(2.0, GOLD)));
}

/// 左下に、元の色の PandD のロゴを少し透かして描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `images` - ロゴのテクスチャ
///
/// # 戻り値
///
/// 戻り値なし
fn logo(ui: &Ui, images: &Images) {
    let area = ui.max_rect();
    let size = vec2(LOGO_WIDTH, LOGO_WIDTH * LOGO_UV.height() / LOGO_UV.width());
    let rect = Rect::from_min_size(pos2(area.left() + 14.0, area.bottom() - 80.0), size);
    let painter = ui.painter();

    // 元の色のまま少し透かして重ねる
    painter.image(
        images.logo.id(),
        rect,
        LOGO_UV,
        Color32::from_white_alpha(170),
    );
}

/// 台詞を鉤括弧で囲み、2行目から1字下げる
///
/// # 引数
///
/// * `line` - 改行を含む台詞
///
/// # 戻り値
///
/// 画面に出す形の台詞
fn dialogue(line: &str) -> String {
    format!("「{}」", line.replace('\n', "\n　"))
}

/// 台詞のフォントを返す
///
/// # 戻り値
///
/// 台詞に使う太字のフォント
fn message_font() -> FontId {
    bold(16.0)
}

/// 【 名前 】の行と台詞を、縁取りした白文字で描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `text` - 鉤括弧で囲んだ台詞
///
/// # 戻り値
///
/// 戻り値なし
fn message(ui: &Ui, text: &str) {
    let area = ui.max_rect();
    let left = pos2(area.left() + MESSAGE_LEFT, area.top() + MESSAGE_TOP);
    outlined(
        ui.painter(),
        left,
        Align2::LEFT_TOP,
        &format!("【 {NAVI_NAME} 】"),
        bold(16.0),
        WHITE,
        EMBER,
    );

    // 台詞は改行を入れて書いてあるので折り返さず、範囲の外は切る
    let lines = Rect::from_min_size(left + vec2(0.0, 26.0), vec2(MESSAGE_WIDTH, MESSAGE_HEIGHT));
    outlined(
        &ui.painter().with_clip_rect(lines.expand(2.0)),
        lines.min,
        Align2::LEFT_TOP,
        text,
        message_font(),
        WHITE,
        EMBER,
    );
}

/// 選択肢を画面中央に縦に並べる
///
/// # 引数
///
/// * `ui` - 配置先
/// * `view` - セットアップの状態
/// * `options` - 並べる選択肢
///
/// # 戻り値
///
/// 押された選択肢の操作
fn choices(ui: &mut Ui, view: &View, options: &[Choice]) -> Option<Action> {
    let area = ui.max_rect();
    let appear = ((view.screen_seconds - 0.1) * 4.0).clamp(0.0, 1.0);
    let mut top = area.top()
        + CHOICE_TOP
        + if view.screen == Screen::Failed {
            130.0
        } else {
            0.0
        }
        + (1.0 - appear) * 12.0;
    let mut chosen = None;
    for option in options {
        let height = if option.note.is_some() { 54.0 } else { 44.0 };
        let rect = Rect::from_min_size(
            pos2(area.center().x - CHOICE_WIDTH / 2.0, top),
            vec2(CHOICE_WIDTH, height),
        );
        if choice_bar(ui, rect, option) {
            chosen = Some(option.action);
        }
        top += height + 12.0;
    }
    chosen
}

/// 白い縁とコーラルの輪郭の選択肢を描き、押されたかを返す
///
/// # 引数
///
/// * `ui` - 配置先
/// * `rect` - 選択肢の範囲
/// * `option` - 選択肢
///
/// # 戻り値
///
/// 押されたら true
fn choice_bar(ui: &mut Ui, rect: Rect, option: &Choice) -> bool {
    let response = hit_area(ui, rect);
    let hovered = response.hovered();
    let painter = ui.painter();
    let radius = CornerRadius::same(10);
    painter.rect_filled(
        rect.translate(vec2(0.0, 4.0)),
        radius,
        EMBER.gamma_multiply(0.3),
    );
    let fill = if hovered {
        BERRY
    } else {
        Color32::from_rgba_unmultiplied(0xff, 0xff, 0xff, 236)
    };
    painter.rect_filled(rect, radius, fill);
    painter.rect_stroke(rect, radius, Stroke::new(2.0, CORAL), StrokeKind::Outside);
    painter.rect_stroke(rect, radius, Stroke::new(2.0, WHITE), StrokeKind::Inside);

    let text = if hovered { WHITE } else { BERRY_TEXT };
    match &option.note {
        Some((note, color)) => {
            centered_text(
                ui,
                rect.center() - vec2(0.0, 9.0),
                option.label,
                bold(15.0),
                text,
            );
            let color = if hovered { WHITE } else { *color };
            centered_text(ui, rect.center() + vec2(0.0, 12.0), note, body(11.0), color);
        }
        None => centered_text(ui, rect.center(), option.label, bold(15.0), text),
    }
    response.clicked()
}

/// 失敗の内容を画面上部の白いカードに出す
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 戻り値なし
fn failure_card(ui: &Ui, view: &View) {
    let area = ui.max_rect();
    let card = Rect::from_min_size(
        pos2(area.center().x - 240.0, area.top() + 84.0),
        vec2(480.0, 146.0),
    );
    let painter = ui.painter();
    painter.rect_filled(
        card,
        CornerRadius::same(10),
        Color32::from_rgba_unmultiplied(0xff, 0xff, 0xff, 236),
    );
    painter.rect_stroke(
        card,
        CornerRadius::same(10),
        Stroke::new(2.0, CORAL),
        StrokeKind::Outside,
    );
    painter.text(
        card.left_top() + vec2(16.0, 12.0),
        Align2::LEFT_TOP,
        "エラーの内容",
        bold(13.0),
        BERRY_TEXT,
    );
    let clip = Rect::from_min_max(
        card.left_top() + vec2(16.0, 34.0),
        card.right_bottom() - vec2(16.0, 10.0),
    );
    let color = Color32::from_rgb(0x5a, 0x4a, 0x50);
    let galley = painter.layout(view.failure.to_owned(), body(11.0), color, clip.width());
    painter
        .with_clip_rect(clip)
        .galley(clip.left_top(), galley, color);
}

/// 実行中に、名前の行の右へダウンロードのアイコンと工程付きの進捗ゲージを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 戻り値なし
fn progress_gauge(ui: &Ui, view: &View) {
    let area = ui.max_rect();
    let painter = ui.painter();
    let fraction = view.progress.fraction();
    let icon = pos2(area.right() - 236.0, area.top() + MESSAGE_TOP + 14.0);
    draw_download(painter, icon);
    outlined(
        painter,
        icon + vec2(16.0, -4.0),
        Align2::LEFT_BOTTOM,
        &format!(
            "{} {}%",
            stage_label(view.progress.stage()),
            (fraction * 100.0) as u32
        ),
        bold(11.0),
        WHITE,
        EMBER,
    );
    let track = Rect::from_min_size(icon + vec2(16.0, 1.0), vec2(200.0, 7.0));
    painter.rect_filled(track, CornerRadius::same(4), Color32::from_white_alpha(130));
    painter.rect_filled(
        Rect::from_min_size(track.min, vec2(track.width() * fraction, track.height())),
        CornerRadius::same(4),
        Color32::from_rgb(0xff, 0xa0, 0x48),
    );
    painter.rect_stroke(
        track,
        CornerRadius::same(4),
        Stroke::new(1.5, EMBER),
        StrokeKind::Outside,
    );
}

/// 縁取りしたダウンロードのアイコンを描く。下向きの矢印と受け皿
///
/// # 引数
///
/// * `painter` - 描画先
/// * `center` - 中心
///
/// # 戻り値
///
/// 戻り値なし
fn draw_download(painter: &Painter, center: Pos2) {
    let at = |x: f32, y: f32| center + vec2(x, y);
    let tray = vec![
        at(-10.0, 3.0),
        at(-10.0, 10.0),
        at(10.0, 10.0),
        at(10.0, 3.0),
    ];

    // 縁取りを先に太く引き、上から金色で塗る
    for (width, color) in [(6.0, EMBER), (3.0, GOLD)] {
        painter.line_segment([at(0.0, -11.0), at(0.0, 1.0)], Stroke::new(width, color));
        painter.add(Shape::line(tray.clone(), Stroke::new(width, color)));
    }
    painter.add(Shape::convex_polygon(
        vec![at(-7.0, -2.0), at(7.0, -2.0), at(0.0, 6.0)],
        GOLD,
        Stroke::new(1.5, EMBER),
    ));
}

/// 右下に Log、Back、System の文字と、スキップ、閉じるのアイコンを並べる
///
/// # 引数
///
/// * `ui` - 配置先
/// * `view` - セットアップの状態
/// * `typing` - 台詞を送っている途中なら true。スキップを押せる
///
/// # 戻り値
///
/// 押されたもの。押されていなければ None
fn menu_bar(ui: &mut Ui, view: &View, typing: bool) -> Option<MenuPress> {
    let area = ui.max_rect();
    let can_go_back = view.screen == Screen::Destination
        || (view.screen == Screen::Welcome && view.task == Task::Uninstall);
    let can_close = view.screen != Screen::Running;
    let words = [
        ("Log", true, MenuPress::Log),
        ("Back", can_go_back, MenuPress::Action(Action::Back)),
        ("System", true, MenuPress::Action(Action::ToggleTheme)),
    ];

    // 右から左へ、アイコン、文字の順に置く
    let center_y = area.bottom() - 18.0;
    let mut right = area.right() - 14.0;
    let mut pressed = None;
    for (icon, enabled, press) in [
        (Icon::Close, can_close, MenuPress::Action(Action::Close)),
        (Icon::Skip, typing, MenuPress::Skip),
    ] {
        let rect = Rect::from_min_max(
            pos2(right - 26.0, center_y - 12.0),
            pos2(right, center_y + 12.0),
        );
        let response = hit_area(ui, rect);
        let color = match (enabled, response.hovered()) {
            (false, _) => GOLD.gamma_multiply(0.35),
            (true, true) => WHITE,
            (true, false) => GOLD,
        };
        draw_icon(ui.painter(), rect.center(), icon, color);
        if enabled && response.clicked() {
            pressed = Some(press);
        }
        right = rect.left() - 4.0;
    }
    for (label, enabled, press) in words.into_iter().rev() {
        let width = ui
            .painter()
            .layout_no_wrap(label.to_owned(), bold(13.0), WHITE)
            .size()
            .x;
        let rect = Rect::from_min_max(
            pos2(right - width - 12.0, center_y - 12.0),
            pos2(right, center_y + 12.0),
        );
        let response = hit_area(ui, rect);
        let color = match (enabled, response.hovered()) {
            (false, _) => BLUSH.gamma_multiply(0.4),
            (true, true) => GOLD,
            (true, false) => BLUSH,
        };
        outlined(
            ui.painter(),
            rect.center(),
            Align2::CENTER_CENTER,
            label,
            bold(13.0),
            color,
            EMBER,
        );
        if enabled && response.clicked() {
            pressed = Some(press);
        }
        right = rect.left();
    }
    pressed
}

/// 右下のメニューのアイコン
#[derive(Clone, Copy)]
enum Icon {
    /// 台詞のスキップ
    Skip,
    /// 閉じる
    Close,
}

/// 縁取りしたアイコンを描く
///
/// # 引数
///
/// * `painter` - 描画先
/// * `center` - 中心
/// * `icon` - アイコンの種類
/// * `color` - 塗りの色
///
/// # 戻り値
///
/// 戻り値なし
fn draw_icon(painter: &Painter, center: Pos2, icon: Icon, color: Color32) {
    match icon {
        Icon::Skip => {
            for offset in [-5.0, 4.0] {
                let tip = center + vec2(offset + 5.0, 0.0);
                painter.add(Shape::convex_polygon(
                    vec![tip - vec2(9.0, 7.0), tip, tip - vec2(9.0, -7.0)],
                    color,
                    Stroke::new(1.2, EMBER),
                ));
            }
        }
        Icon::Close => {
            for (from, to) in [
                (vec2(-6.0, -6.0), vec2(6.0, 6.0)),
                (vec2(6.0, -6.0), vec2(-6.0, 6.0)),
            ] {
                painter.line_segment([center + from, center + to], Stroke::new(5.0, EMBER));
            }
            for (from, to) in [
                (vec2(-6.0, -6.0), vec2(6.0, 6.0)),
                (vec2(6.0, -6.0), vec2(-6.0, 6.0)),
            ] {
                painter.line_segment([center + from, center + to], Stroke::new(2.6, color));
            }
        }
    }
}

/// IFW のログを画面上部のパネルに出し、パネルが押されたかを返す
///
/// # 引数
///
/// * `ui` - 配置先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// パネルが押されたら true。押すと閉じる
fn log_panel(ui: &mut Ui, view: &View) -> bool {
    let area = ui.max_rect();
    let panel = Rect::from_min_size(
        area.left_top() + vec2(60.0, 80.0),
        vec2(area.width() - 120.0, 260.0),
    );
    let response = hit_area(ui, panel);
    let painter = ui.painter();
    painter.rect_filled(
        panel,
        CornerRadius::same(12),
        Color32::from_rgba_unmultiplied(0x3a, 0x12, 0x1e, 220),
    );
    painter.rect_stroke(
        panel,
        CornerRadius::same(12),
        Stroke::new(2.0, WHITE),
        StrokeKind::Inside,
    );
    outlined(
        painter,
        panel.left_top() + vec2(18.0, 12.0),
        Align2::LEFT_TOP,
        "Log",
        bold(18.0),
        WHITE,
        EMBER,
    );
    painter.text(
        panel.right_top() + vec2(-18.0, 16.0),
        Align2::RIGHT_TOP,
        "クリックで閉じる",
        body(11.0),
        CORAL_LIGHT,
    );
    let clip = Rect::from_min_max(
        panel.left_top() + vec2(18.0, 46.0),
        panel.right_bottom() - vec2(18.0, 14.0),
    );
    let text = if view.log.is_empty() {
        "まだログはありません".to_owned()
    } else {
        view.log.join("\n")
    };
    let galley = painter.layout(text, body(11.0), WHITE, clip.width());

    // 新しい行が見えるよう、はみ出す分だけ上へずらす
    let overflow = (galley.size().y - clip.height()).max(0.0);
    painter
        .with_clip_rect(clip)
        .galley(clip.left_top() - vec2(0.0, overflow), galley, WHITE);
    response.clicked()
}

#[cfg(test)]
mod tests {
    use eframe::egui::{Context, RawInput};
    use pandd_setup::{ifw::Stage, progress::Progress};

    use super::*;

    /// すべての画面の台詞が、自動で折り返さずに台詞の範囲へ収まることを確かめる
    #[test]
    fn every_line_fits_the_message_area() {
        // 本番と同じフォントを読み込み、1フレーム回して反映する
        let ctx = Context::default();
        crate::app::install_fonts(&ctx);
        let _ = ctx.run_ui(RawInput::default(), |_| {});

        let images = Images::load(&ctx);
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
                            log: &[],
                            failure: "",
                            screen_seconds: 0.0,
                            seconds: 0.0,
                            up_to_date,
                            game: None,
                            images: &images,
                        };
                        let line = dialogue(scene_for(&view).line);
                        let galley = ctx.fonts_mut(|fonts| {
                            fonts.layout_no_wrap(line.clone(), message_font(), WHITE)
                        });
                        assert!(galley.size().x <= MESSAGE_WIDTH, "横にはみ出す台詞: {line}");
                        assert!(
                            galley.size().y <= MESSAGE_HEIGHT,
                            "縦にはみ出す台詞: {line}"
                        );
                    }
                }
            }
        }
    }
}
