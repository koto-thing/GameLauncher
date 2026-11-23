//! アーケードのテーマ
//!
//! SPACE YAKUZA の画面に寄せた、暗い宇宙とティールの格子の横シューティング。
//! インストールの進捗は HUD の DIST バーで見せ、終わるとボスが出現する

use eframe::egui::{
    Align2, Color32, CornerRadius, FontId, Painter, Pos2, Rect, Shape, Stroke, StrokeKind, Ui,
    Visuals, pos2, vec2,
};
use pandd_setup::{
    ifw::Stage,
    shooter::{BOSS_HEALTH, EXPLOSION_SECONDS, Game, Phase, Vec2 as GameVec},
};

use super::{Action, Screen, Task, View, centered_text, dot, fit_line, hit_area, pixel};

// SPACE YAKUZA の配色
const SPACE: Color32 = Color32::from_rgb(0x01, 0x02, 0x09);
const PANEL: Color32 = Color32::from_rgb(0x0a, 0x11, 0x24);
const BLACK: Color32 = Color32::from_rgb(0x00, 0x00, 0x00);
const TEAL: Color32 = Color32::from_rgb(0x19, 0xa7, 0xa7);
const STAR: Color32 = Color32::from_rgb(0xb8, 0xcc, 0xff);
const BUTTON: Color32 = Color32::from_rgb(0x33, 0x4d, 0x8c);
const BUTTON_LIGHT: Color32 = Color32::from_rgb(0x47, 0x6e, 0xbf);
const BUTTON_DARK: Color32 = Color32::from_rgb(0x1f, 0x33, 0x66);
const CYAN: Color32 = Color32::from_rgb(0x3f, 0xb8, 0xff);
const FRAME: Color32 = Color32::from_rgb(0x19, 0xa7, 0xe0);
const YELLOW: Color32 = Color32::from_rgb(0xff, 0xd2, 0x3a);
const ORANGE: Color32 = Color32::from_rgb(0xf2, 0xa3, 0x3a);
const ORANGE_LIGHT: Color32 = Color32::from_rgb(0xff, 0xd0, 0x8a);
const ORANGE_DARK: Color32 = Color32::from_rgb(0xa8, 0x66, 0x1a);
const INK: Color32 = Color32::from_rgb(0x1a, 0x0d, 0x00);
const RED: Color32 = Color32::from_rgb(0xff, 0x4d, 0x5e);
const HULL_RED: Color32 = Color32::from_rgb(0xb3, 0x12, 0x1f);
const HULL_DARK: Color32 = Color32::from_rgb(0x7a, 0x0d, 0x16);
const HULL_GREY: Color32 = Color32::from_rgb(0x9a, 0x9a, 0xa4);
const NOSE: Color32 = Color32::from_rgb(0x3f, 0xe0, 0xe8);
const NOSE_DARK: Color32 = Color32::from_rgb(0x1c, 0x9a, 0xa2);
const SHOT_CORE: Color32 = Color32::from_rgb(0xbf, 0xe3, 0xff);
const WHITE: Color32 = Color32::from_rgb(0xf4, 0xf6, 0xff);
const TEXT: Color32 = Color32::from_rgb(0xcf, 0xd6, 0xf5);
const GREY: Color32 = Color32::from_rgb(0xb3, 0xb3, 0xb3);
const DIM: Color32 = Color32::from_rgb(0x77, 0x77, 0x77);

/// HUD の高さ
pub const HUD_HEIGHT: f32 = 46.0;
/// 字幕とボタンを置く下段の高さ
pub const FOOTER_HEIGHT: f32 = 46.0;

/// ボタンの文言の大きさ
const BUTTON_FONT_SIZE: f32 = 10.0;
/// タイトル画面に縦に並べるボタンの幅
const MENU_WIDTH: f32 = 240.0;
/// タイトル画面に縦に並べるボタンの高さ
const MENU_HEIGHT: f32 = 44.0;
/// インストール先の画面で左に並べるボタンの幅
const LIST_WIDTH: f32 = 200.0;
/// 下段の字幕の文字間隔
const CAPTION_SPACING: f32 = 6.0;

/// ボタンの文言、補足、操作、主ボタンかどうか
type MenuButton = (&'static str, &'static str, Action, bool);

/// 新規インストールのタイトル画面のボタン
const TITLE_BUTTONS: &[MenuButton] = &[
    ("START", "インストール", Action::Next, true),
    ("EXIT", "やめる", Action::Close, false),
];
/// メンテナンスの選択画面のボタン
const MENU_BUTTONS: &[MenuButton] = &[
    ("UPDATE", "アップデート", Action::Update, false),
    (
        "UNINSTALL",
        "アンインストール",
        Action::ConfirmUninstall,
        false,
    ),
    ("EXIT", "やめる", Action::Close, false),
];
/// アンインストールの確認画面のボタン
const CONFIRM_BUTTONS: &[MenuButton] = &[
    ("START", "アンインストール", Action::Uninstall, true),
    ("BACK", "もどる", Action::Back, false),
];
/// インストール先の画面で左に並べるボタン
const DESTINATION_BUTTONS: &[MenuButton] = &[
    ("DEFAULT", "おすすめの場所", Action::UseDefault, false),
    ("BROWSE", "フォルダを選ぶ", Action::Browse, false),
    ("INSTALL", "インストール", Action::Install, true),
];
/// 失敗の画面のボタン
const FAILED_BUTTONS: &[MenuButton] = &[
    ("CONTINUE", "もう一度", Action::Retry, true),
    ("EXIT", "閉じる", Action::Close, false),
];

/// アーケードの画面を描き、押された操作を返す
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
    ui.ctx().set_visuals(Visuals::dark());
    let area = ui.max_rect();
    ui.painter().rect_filled(area, CornerRadius::ZERO, SPACE);

    let action = match view.screen {
        Screen::Menu => title(ui, view, "メンテナンス", MENU_BUTTONS),
        Screen::Welcome if view.task == Task::Uninstall => {
            title(ui, view, "アンインストール", CONFIRM_BUTTONS)
        }
        Screen::Welcome => title(ui, view, "セットアップ", TITLE_BUTTONS),
        Screen::Destination => destination(ui, view),
        Screen::Running | Screen::Finished => stage(ui, view),
        Screen::Failed => failed(ui, view),
    };

    // テーマの切り替えは、どの画面でも左下に置く
    let toggle = Rect::from_min_size(
        pos2(area.left() + 12.0, area.bottom() - 36.0),
        vec2(88.0, 26.0),
    );
    let toggled = space_button(ui, toggle, "THEME", None, false).then_some(Action::ToggleTheme);
    draw_scanlines(ui, area);
    action.or(toggled)
}

/// 流れる星を描く
///
/// # 引数
///
/// * `painter` - 描画先
/// * `area` - 星を散らす範囲
/// * `seconds` - 起動からの秒数
/// * `speed` - 流れる速さの倍率
///
/// # 戻り値
///
/// 戻り値なし
fn draw_stars(painter: &Painter, area: Rect, seconds: f32, speed: f32) {
    for index in 0..110u32 {
        let seed = index.wrapping_mul(2_654_435_761);
        let velocity = (10 + seed % 30) as f32 * speed;
        let travel = (seed % 997) as f32 / 997.0 * area.width() + seconds * velocity;
        let x = area.right() - travel % area.width();
        let y = area.top() + (seed / 997 % 991) as f32 / 991.0 * area.height();
        let (size, color) = if seed % 7 == 0 {
            (2.0, STAR)
        } else {
            (1.0, STAR.gamma_multiply(0.6))
        };
        painter.rect_filled(
            Rect::from_min_size(pos2(x, y), vec2(size, size)),
            CornerRadius::ZERO,
            color,
        );
    }
}

/// 面取りの影が付いた SPACE YAKUZA のボタンを描き、押されたかを返す
///
/// # 引数
///
/// * `ui` - 配置先
/// * `rect` - ボタンの範囲
/// * `label` - 英字の文言
/// * `note` - 文言の下に添える日本語。なければ None
/// * `hot` - オレンジの主ボタンなら true
///
/// # 戻り値
///
/// 押されたら true
fn space_button(ui: &mut Ui, rect: Rect, label: &str, note: Option<&str>, hot: bool) -> bool {
    let response = hit_area(ui, rect);
    let hovered = response.hovered();
    let (fill, light, dark, ink) = match (hot, hovered) {
        (true, false) => (ORANGE, ORANGE_LIGHT, ORANGE_DARK, INK),
        (true, true) => (ORANGE_LIGHT, ORANGE_LIGHT, ORANGE_DARK, INK),
        (false, false) => (BUTTON, BUTTON_LIGHT, BUTTON_DARK, WHITE),
        (false, true) => (BUTTON_LIGHT, BUTTON_LIGHT, BUTTON_DARK, WHITE),
    };

    // 押している間は明暗を入れ替えて、へこんだように見せる
    let (top_left, bottom_right) = if response.is_pointer_button_down_on() {
        (dark, light)
    } else {
        (light, dark)
    };
    let painter = ui.painter();
    painter.rect_filled(rect, CornerRadius::ZERO, fill);
    let edge = 3.0;
    for (strip, color) in [
        (
            Rect::from_min_size(rect.min, vec2(rect.width(), edge)),
            top_left,
        ),
        (
            Rect::from_min_size(rect.min, vec2(edge, rect.height())),
            top_left,
        ),
        (
            Rect::from_min_max(pos2(rect.left(), rect.bottom() - edge), rect.max),
            bottom_right,
        ),
        (
            Rect::from_min_max(pos2(rect.right() - edge, rect.top()), rect.max),
            bottom_right,
        ),
    ] {
        painter.rect_filled(strip, CornerRadius::ZERO, color);
    }

    match note {
        Some(note) => {
            centered_text(
                ui,
                rect.center() - vec2(0.0, 8.0),
                label,
                pixel(BUTTON_FONT_SIZE),
                ink,
            );
            let note_color = if hot { INK } else { TEXT };
            centered_text(
                ui,
                rect.center() + vec2(0.0, 9.0),
                note,
                dot(12.0),
                note_color,
            );
        }
        None => centered_text(ui, rect.center(), label, pixel(8.0), ink),
    }
    response.clicked()
}

/// ボタンを縦に並べ、押された操作を返す
///
/// # 引数
///
/// * `ui` - 配置先
/// * `left_top` - 最初のボタンの左上
/// * `width` - ボタンの幅
/// * `buttons` - 並べるボタン
///
/// # 戻り値
///
/// 押されたボタンの操作
fn button_column(
    ui: &mut Ui,
    left_top: Pos2,
    width: f32,
    buttons: &[MenuButton],
) -> Option<Action> {
    let mut chosen = None;
    for (index, &(label, note, action, hot)) in buttons.iter().enumerate() {
        let rect = Rect::from_min_size(
            left_top + vec2(0.0, index as f32 * (MENU_HEIGHT + 14.0)),
            vec2(width, MENU_HEIGHT),
        );
        if space_button(ui, rect, label, Some(note), hot) {
            chosen = Some(action);
        }
    }
    chosen
}

/// 1文字ずつ間隔を空けた文字列の幅を返す
///
/// # 引数
///
/// * `ui` - 文字幅の計測に使う
/// * `text` - 文字列
/// * `font` - フォント
/// * `spacing` - 文字の間隔
///
/// # 戻り値
///
/// 描いたときの幅
fn spaced_width(ui: &Ui, text: &str, font: &FontId, spacing: f32) -> f32 {
    let glyphs: f32 = text
        .chars()
        .map(|glyph| {
            ui.painter()
                .layout_no_wrap(glyph.to_string(), font.clone(), WHITE)
                .size()
                .x
        })
        .sum();
    glyphs + spacing * text.chars().count().saturating_sub(1) as f32
}

/// 1文字ずつ間隔を空けて、字幕のように文字を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `left_center` - 書き出しの左端の中央
/// * `text` - 文字列
/// * `font` - フォント
/// * `color` - 文字の色
/// * `spacing` - 文字の間隔
///
/// # 戻り値
///
/// 戻り値なし
fn spaced_text(ui: &Ui, left_center: Pos2, text: &str, font: FontId, color: Color32, spacing: f32) {
    let mut x = left_center.x;
    for glyph in text.chars() {
        let galley = ui
            .painter()
            .layout_no_wrap(glyph.to_string(), font.clone(), color);
        let width = galley.size().x;
        ui.painter().text(
            pos2(x, left_center.y),
            Align2::LEFT_CENTER,
            glyph,
            font.clone(),
            color,
        );
        x += width + spacing;
    }
}

/// タイトルの「PANDD LAUNCHER」と副題を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `subtitle` - 副題
///
/// # 戻り値
///
/// 戻り値なし
fn logo(ui: &Ui, subtitle: &str) {
    let area = ui.max_rect();
    let center = pos2(area.center().x, area.top() + 92.0);
    centered_text(
        ui,
        center + vec2(3.0, 3.0),
        "PANDD LAUNCHER",
        pixel(30.0),
        BUTTON_DARK,
    );
    centered_text(ui, center, "PANDD LAUNCHER", pixel(30.0), WHITE);
    centered_text(ui, center + vec2(0.0, 48.0), subtitle, dot(18.0), TEXT);
}

/// SPACE YAKUZA のタイトル画面のように、ロゴの下にボタンを縦に並べる
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
/// * `subtitle` - ロゴの下の副題
/// * `buttons` - 並べるボタン
///
/// # 戻り値
///
/// 押されたボタンの操作
fn title(ui: &mut Ui, view: &View, subtitle: &str, buttons: &[MenuButton]) -> Option<Action> {
    let area = ui.max_rect();
    draw_stars(ui.painter(), area, view.seconds, 1.0);
    logo(ui, subtitle);

    // メンテナンスでは対象の場所と、残るものを添える
    let notes: &[(&str, Color32)] = match (view.screen, view.task) {
        (Screen::Menu, _) => &[("アップデートかアンインストールを選んでください", GREY)],
        (Screen::Welcome, Task::Uninstall) => {
            &[("インストールしたゲームとセーブデータは残ります", YELLOW)]
        }
        _ => &[],
    };
    let mut top = area.top() + 196.0;
    if !notes.is_empty() {
        let font = dot(13.0);
        let target = fit_line(ui, &format!("TARGET  {}", view.final_root), &font, 600.0);
        centered_text(ui, pos2(area.center().x, top), &target, font, CYAN);
        for &(note, color) in notes {
            top += 20.0;
            centered_text(ui, pos2(area.center().x, top), note, dot(13.0), color);
        }
        top += 26.0;
    } else {
        top += 22.0;
    }
    button_column(
        ui,
        pos2(area.center().x - MENU_WIDTH / 2.0, top),
        MENU_WIDTH,
        buttons,
    )
}

/// インストール先を選ぶ画面を描く。左にボタン、右に行き先のパネルを置く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 押されたボタンの操作
fn destination(ui: &mut Ui, view: &View) -> Option<Action> {
    let area = ui.max_rect();
    draw_stars(ui.painter(), area, view.seconds, 1.0);
    centered_text(
        ui,
        pos2(area.center().x, area.top() + 44.0),
        "SELECT DESTINATION",
        pixel(20.0),
        WHITE,
    );

    // 行き先のパネル
    let panel = Rect::from_min_size(area.left_top() + vec2(272.0, 88.0), vec2(452.0, 300.0));
    ui.painter().rect_filled(panel, CornerRadius::ZERO, PANEL);
    ui.painter().rect_stroke(
        panel,
        CornerRadius::ZERO,
        Stroke::new(4.0, FRAME),
        StrokeKind::Inside,
    );
    let inner = panel.shrink(24.0);
    centered_text(
        ui,
        pos2(panel.center().x, inner.top() + 10.0),
        "INSTALL TO",
        pixel(18.0),
        YELLOW,
    );
    centered_text(
        ui,
        pos2(panel.center().x, inner.top() + 40.0),
        "DESTINATION",
        pixel(8.0),
        FRAME,
    );
    let path = if view.final_root.is_empty() {
        "フォルダを選んでください".to_owned()
    } else {
        fit_line(ui, view.final_root, &dot(15.0), inner.width())
    };
    centered_text(
        ui,
        pos2(panel.center().x, inner.top() + 72.0),
        &path,
        dot(15.0),
        YELLOW,
    );
    let rule = inner.top() + 108.0;
    ui.painter().line_segment(
        [pos2(inner.left(), rule), pos2(inner.right(), rule)],
        Stroke::new(2.0, FRAME),
    );
    centered_text(
        ui,
        pos2(panel.center().x, rule + 22.0),
        "BRIEFING",
        pixel(8.0),
        FRAME,
    );

    // 問題があれば赤で、なければ保存先の補足を出す
    let (briefing, color) = match view.directory_problem {
        Some(problem) => (problem, RED),
        None => (
            "ゲームとセーブデータは別の場所に保存されます。\nインストール中はシューティングで遊べます。",
            TEXT,
        ),
    };
    let galley = ui
        .painter()
        .layout(briefing.to_owned(), dot(14.0), color, inner.width());
    let position = pos2(panel.center().x - galley.size().x / 2.0, rule + 42.0);
    ui.painter().galley(position, galley, color);

    let left = area.left() + 40.0;
    let chosen = button_column(
        ui,
        pos2(left, area.top() + 100.0),
        LIST_WIDTH,
        DESTINATION_BUTTONS,
    );
    let back = Rect::from_min_size(
        pos2(left, panel.bottom() - MENU_HEIGHT),
        vec2(LIST_WIDTH, MENU_HEIGHT),
    );
    if space_button(ui, back, "BACK", Some("もどる"), false) {
        return Some(Action::Back);
    }
    chosen
}

/// ゲーム座標を画面座標に変える
///
/// # 引数
///
/// * `field` - フィールドの画面上の範囲
/// * `position` - ゲーム内の座標
///
/// # 戻り値
///
/// 画面上の座標
fn to_screen(field: Rect, position: GameVec) -> Pos2 {
    field.left_top() + vec2(position.x, position.y)
}

/// 作業の英語名を返す
///
/// # 引数
///
/// * `task` - 作業
///
/// # 戻り値
///
/// HUD の STAGE の横に出す名前
fn task_name(task: Task) -> &'static str {
    match task {
        Task::Install => "INSTALL",
        Task::Update => "UPDATE",
        Task::Uninstall => "UNINSTALL",
    }
}

/// 下段に出す、工程の字幕を返す
///
/// # 引数
///
/// * `stage` - IFW の工程
///
/// # 戻り値
///
/// 字幕の英文
fn caption(stage: Stage) -> &'static str {
    match stage {
        Stage::Preparing => "CHECKING UPDATES.",
        Stage::Downloading => "DOWNLOADING PACKAGES.",
        Stage::Unpacking => "UNPACKING FILES.",
        Stage::Finalizing => "FINALIZING.",
        Stage::Removing => "REMOVING FILES.",
    }
}

/// 上段に残機、STAGE、SCORE、DIST バー、ハイスコア、進捗率を描く
///
/// DIST バーはインストールの進捗で、右端の旗に着くと完了する
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
/// * `game` - シューティングの状態
///
/// # 戻り値
///
/// 戻り値なし
fn hud(ui: &Ui, view: &View, game: &Game) {
    let area = ui.max_rect();
    let bar = Rect::from_min_size(area.left_top(), vec2(area.width(), HUD_HEIGHT));
    let painter = ui.painter();
    painter.rect_filled(bar, CornerRadius::ZERO, BLACK);
    painter.line_segment(
        [bar.left_bottom(), bar.right_bottom()],
        Stroke::new(1.0, TEAL),
    );
    let top = bar.top();

    // 左は 1P と残機
    painter.text(
        pos2(bar.left() + 110.0, top + 6.0),
        Align2::CENTER_TOP,
        "1P",
        pixel(10.0),
        CYAN,
    );
    painter.text(
        pos2(bar.left() + 20.0, top + 31.0),
        Align2::LEFT_CENTER,
        "LIFE",
        pixel(7.0),
        CYAN,
    );
    for index in 0..game.player.lives {
        draw_ship(
            painter,
            pos2(bar.left() + 90.0 + index as f32 * 36.0, top + 31.0),
            0.6,
        );
    }

    // 中央は STAGE、SCORE、DIST
    let center = bar.center().x;
    painter.text(
        pos2(center, top + 4.0),
        Align2::CENTER_TOP,
        format!("STAGE 1/1  {}", task_name(view.task)),
        pixel(10.0),
        YELLOW,
    );
    painter.text(
        pos2(center, top + 18.0),
        Align2::CENTER_TOP,
        format!("SCORE {:06}", game.score),
        pixel(9.0),
        WHITE,
    );
    let fraction = view.progress.fraction();
    let track = Rect::from_min_size(pos2(center - 48.0, top + 38.0), vec2(200.0, 1.0));
    painter.text(
        pos2(track.left() - 40.0, track.center().y),
        Align2::LEFT_CENTER,
        "DIST",
        pixel(7.0),
        ORANGE,
    );
    painter.rect_filled(track, CornerRadius::ZERO, DIM);
    for tick in 0..=10 {
        let x = track.left() + tick as f32 * track.width() / 10.0;
        painter.rect_filled(
            Rect::from_min_size(pos2(x, track.top() - 2.0), vec2(1.0, 3.0)),
            CornerRadius::ZERO,
            DIM,
        );
    }
    painter.rect_filled(
        Rect::from_center_size(
            pos2(track.left() + track.width() * fraction, track.center().y),
            vec2(10.0, 5.0),
        ),
        CornerRadius::ZERO,
        ORANGE,
    );
    let pole = pos2(track.right() + 14.0, track.bottom());
    painter.rect_filled(
        Rect::from_min_size(pole - vec2(0.0, 11.0), vec2(1.0, 11.0)),
        CornerRadius::ZERO,
        GREY,
    );
    painter.rect_filled(
        Rect::from_min_size(pole - vec2(-1.0, 11.0), vec2(6.0, 4.0)),
        CornerRadius::ZERO,
        GREY,
    );

    // 右はハイスコアと進捗率
    painter.text(
        pos2(bar.right() - 20.0, top + 6.0),
        Align2::RIGHT_TOP,
        format!("HI {:06}", game.high_score),
        pixel(9.0),
        GREY,
    );
    painter.text(
        pos2(bar.right() - 20.0, top + 22.0),
        Align2::RIGHT_TOP,
        format!("{}%", (fraction * 100.0) as u32),
        pixel(10.0),
        YELLOW,
    );
}

/// 自機を描く。グレーの胴体にティールの線とシアンの三角の機首
///
/// # 引数
///
/// * `painter` - 描画先
/// * `center` - 機体の中心
/// * `scale` - 大きさの倍率
///
/// # 戻り値
///
/// 戻り値なし
fn draw_ship(painter: &Painter, center: Pos2, scale: f32) {
    let at = |x: f32, y: f32| center + vec2(x, y) * scale;
    painter.rect_filled(
        Rect::from_min_max(at(-26.0, -5.0), at(4.0, 5.0)),
        CornerRadius::ZERO,
        HULL_GREY,
    );
    painter.rect_filled(
        Rect::from_min_max(at(-20.0, -2.0), at(-4.0, 2.0)),
        CornerRadius::ZERO,
        TEAL,
    );
    painter.add(Shape::convex_polygon(
        vec![at(4.0, -9.0), at(20.0, 5.0), at(4.0, 5.0)],
        NOSE,
        Stroke::NONE,
    ));
    painter.add(Shape::convex_polygon(
        vec![at(4.0, 5.0), at(20.0, 5.0), at(4.0, 9.0)],
        NOSE_DARK,
        Stroke::NONE,
    ));
}

/// 敵機を描く。赤い胴体とオレンジの三角の機首が左を向く
///
/// # 引数
///
/// * `painter` - 描画先
/// * `center` - 機体の中心
/// * `scale` - 大きさの倍率
///
/// # 戻り値
///
/// 戻り値なし
fn draw_enemy(painter: &Painter, center: Pos2, scale: f32) {
    let at = |x: f32, y: f32| center + vec2(x, y) * scale;
    painter.rect_filled(
        Rect::from_min_max(at(-8.0, -5.0), at(24.0, 5.0)),
        CornerRadius::ZERO,
        HULL_RED,
    );
    painter.rect_filled(
        Rect::from_min_max(at(2.0, -2.0), at(16.0, 2.0)),
        CornerRadius::ZERO,
        ORANGE_DARK,
    );
    painter.add(Shape::convex_polygon(
        vec![at(-20.0, 5.0), at(-8.0, -8.0), at(-4.0, 5.0)],
        ORANGE,
        Stroke::NONE,
    ));
    painter.add(Shape::convex_polygon(
        vec![at(-8.0, -8.0), at(-2.0, 5.0), at(-4.0, 5.0)],
        ORANGE_DARK,
        Stroke::NONE,
    ));
}

/// ロックオン中の相手を黄色の角括弧で囲む
///
/// # 引数
///
/// * `painter` - 描画先
/// * `center` - 相手の中心
/// * `radius` - 囲む大きさの半分
///
/// # 戻り値
///
/// 戻り値なし
fn draw_lock_on(painter: &Painter, center: Pos2, radius: f32) {
    let stroke = Stroke::new(2.0, YELLOW);
    let arm = 7.0;
    for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
        let corner = center + vec2(sx * radius, sy * radius);
        painter.line_segment([corner, corner - vec2(0.0, sy * arm)], stroke);
        painter.line_segment([corner, corner - vec2(sx * arm, 0.0)], stroke);
    }
}

/// シューティングのフィールド、HUD、下段を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 完了後に押されたボタンの操作
fn stage(ui: &mut Ui, view: &View) -> Option<Action> {
    let area = ui.max_rect();
    let field = Rect::from_min_max(
        pos2(area.left(), area.top() + HUD_HEIGHT),
        pos2(area.right(), area.bottom() - FOOTER_HEIGHT),
    );
    let Some(game) = view.game else {
        return footer(ui, view);
    };
    let painter = ui.painter().with_clip_rect(field);
    draw_stars(&painter, field, view.seconds, 3.0);

    // 左へ流れる縦線と、固定の横線で格子を作る
    let grid = Stroke::new(1.0, Color32::from_rgba_unmultiplied(0x19, 0x78, 0x78, 72));
    let scroll = (view.seconds * 60.0) % 160.0;
    let mut x = field.left() - scroll;
    while x < field.right() {
        painter.line_segment([pos2(x, field.top()), pos2(x, field.bottom())], grid);
        x += 160.0;
    }
    for y in [field.top() + 18.0, field.center().y, field.bottom() - 18.0] {
        painter.line_segment([pos2(field.left(), y), pos2(field.right(), y)], grid);
    }

    for enemy in &game.enemies {
        draw_enemy(&painter, to_screen(field, enemy.position), 1.0);
    }
    if let Some(boss) = game.boss {
        let center = to_screen(field, boss.position);
        painter.rect_filled(
            Rect::from_min_max(center + vec2(-24.0, -40.0), center + vec2(90.0, 40.0)),
            CornerRadius::ZERO,
            HULL_DARK,
        );
        draw_enemy(&painter, center + vec2(-20.0, -20.0), 1.8);
        draw_enemy(&painter, center + vec2(-20.0, 20.0), 1.8);
        painter.rect_filled(
            Rect::from_center_size(center + vec2(30.0, 0.0), vec2(22.0, 10.0)),
            CornerRadius::ZERO,
            YELLOW,
        );

        // ボスの耐久力をフィールド上部に出す
        let bar = Rect::from_min_size(
            field.left_top() + vec2(200.0, 10.0),
            vec2(field.width() - 400.0, 6.0),
        );
        painter.rect_filled(bar, CornerRadius::ZERO, Color32::from_rgb(0x33, 0x11, 0x11));
        let health = boss.health as f32 / BOSS_HEALTH as f32;
        painter.rect_filled(
            Rect::from_min_size(bar.min, vec2(bar.width() * health, bar.height())),
            CornerRadius::ZERO,
            RED,
        );
        painter.text(
            bar.left_center() - vec2(10.0, 0.0),
            Align2::RIGHT_CENTER,
            "BOSS",
            pixel(8.0),
            RED,
        );
    }
    if let Some(target) = game.lock_target() {
        let boss = game.boss.is_some_and(|boss| boss.position == target);
        let (offset, radius) = if boss {
            (vec2(30.0, 0.0), 56.0)
        } else {
            (vec2(2.0, 0.0), 22.0)
        };
        draw_lock_on(&painter, to_screen(field, target) + offset, radius);
    }

    // 自機の弾は進む向きに伸びた青い光、敵の弾は赤い光
    for shot in &game.shots {
        let head = to_screen(field, shot.position);
        let length = shot.velocity.x.hypot(shot.velocity.y).max(1.0);
        let direction = vec2(shot.velocity.x, shot.velocity.y) / length;
        painter.line_segment(
            [head - direction * 16.0, head],
            Stroke::new(6.0, Color32::from_rgba_unmultiplied(0x28, 0x6e, 0xff, 90)),
        );
        painter.line_segment([head - direction * 9.0, head], Stroke::new(2.5, SHOT_CORE));
    }
    for shot in &game.enemy_shots {
        let center = to_screen(field, shot.position);
        painter.circle_filled(center, 5.0, RED.gamma_multiply(0.5));
        painter.circle_filled(center, 2.5, RED);
    }
    for explosion in &game.explosions {
        let t = explosion.age / EXPLOSION_SECONDS;
        let center = to_screen(field, explosion.position);
        let radius = (4.0 + t * 26.0) * explosion.scale;
        let color = if t < 0.3 {
            WHITE
        } else {
            ORANGE.gamma_multiply(1.0 - t)
        };
        for index in 0..8 {
            let angle = index as f32 / 8.0 * std::f32::consts::TAU;
            let dot = center + vec2(angle.cos(), angle.sin()) * radius;
            painter.rect_filled(
                Rect::from_center_size(dot, vec2(4.0, 4.0)),
                CornerRadius::ZERO,
                color,
            );
        }
    }

    // 無敵中は自機を点滅させる
    let visible = game.player.invulnerable == 0.0 || (view.seconds * 12.0) as i32 % 2 == 0;
    if visible && !matches!(game.phase, Phase::GameOver(_)) {
        draw_ship(&painter, to_screen(field, game.player.position), 1.0);
    }

    hud(ui, view, game);
    overlays(ui, field, view, game);
    footer(ui, view)
}

/// 操作説明、ボス接近、クリア、ゲームオーバーの表示を重ねる
///
/// # 引数
///
/// * `ui` - 描画先
/// * `field` - フィールドの画面上の範囲
/// * `view` - セットアップの状態
/// * `game` - シューティングの状態
///
/// # 戻り値
///
/// 戻り値なし
fn overlays(ui: &Ui, field: Rect, view: &View, game: &Game) {
    let center = field.center();
    if view.screen == Screen::Running && view.screen_seconds < 6.0 {
        centered_text(
            ui,
            pos2(center.x, field.bottom() - 30.0),
            "MOVE: ARROWS/WASD   SHOT: Z/SPACE",
            pixel(8.0),
            GREY,
        );
    }
    let blink = (view.seconds * 6.0) as i32 % 2 == 0;
    match game.phase {
        Phase::Warning(_) => {
            let band = Rect::from_center_size(center, vec2(field.width(), 90.0));
            ui.painter().rect_filled(
                band,
                CornerRadius::ZERO,
                Color32::from_rgba_unmultiplied(0xff, 0x28, 0x3c, 46),
            );
            if blink {
                centered_text(ui, center - vec2(0.0, 10.0), "WARNING", pixel(30.0), RED);
            }
            let finished = match view.task {
                Task::Install => "インストール完了！ ボスが接近中",
                Task::Update if view.up_to_date => "最新でした！ ボスが接近中",
                Task::Update => "アップデート完了！ ボスが接近中",
                Task::Uninstall => "アンインストール完了！ ボスが接近中",
            };
            centered_text(ui, center + vec2(0.0, 26.0), finished, dot(15.0), WHITE);
        }
        Phase::Cleared => {
            let headline = center - vec2(0.0, 24.0);
            centered_text(
                ui,
                headline + vec2(3.0, 3.0),
                "MISSION COMPLETE",
                pixel(24.0),
                ORANGE_DARK,
            );
            centered_text(ui, headline, "MISSION COMPLETE", pixel(24.0), YELLOW);
            centered_text(
                ui,
                center + vec2(0.0, 22.0),
                "BOSS BONUS  10000",
                pixel(10.0),
                WHITE,
            );
        }
        Phase::GameOver(remaining) => {
            centered_text(
                ui,
                center - vec2(0.0, 18.0),
                "GAME OVER",
                pixel(28.0),
                WHITE,
            );
            centered_text(
                ui,
                center + vec2(0.0, 22.0),
                &format!("CONTINUE  {}", remaining.ceil() as u32),
                pixel(10.0),
                YELLOW,
            );
        }
        Phase::Playing | Phase::Boss => {}
    }
}

/// 下段に工程の字幕を、完了後は結果とボタンを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 完了後に押されたボタンの操作
fn footer(ui: &mut Ui, view: &View) -> Option<Action> {
    let area = ui.max_rect();
    let bar = Rect::from_min_max(
        pos2(area.left(), area.bottom() - FOOTER_HEIGHT),
        area.right_bottom(),
    );
    ui.painter().rect_filled(bar, CornerRadius::ZERO, BLACK);
    ui.painter()
        .line_segment([bar.left_top(), bar.right_top()], Stroke::new(1.0, TEAL));

    if view.screen != Screen::Finished {
        let text = caption(view.progress.stage());
        let font = pixel(12.0);
        let width = spaced_width(ui, text, &font, CAPTION_SPACING);
        spaced_text(
            ui,
            pos2(bar.center().x - width / 2.0, bar.center().y),
            text,
            font,
            ORANGE,
            CAPTION_SPACING,
        );
        return None;
    }

    let result = match view.task {
        Task::Install => "INSTALL COMPLETE.",
        Task::Update if view.up_to_date => "UP TO DATE.",
        Task::Update => "UPDATE COMPLETE.",
        Task::Uninstall => "UNINSTALL COMPLETE.",
    };
    spaced_text(
        ui,
        pos2(bar.left() + 116.0, bar.center().y),
        result,
        pixel(10.0),
        YELLOW,
        3.0,
    );
    let close = Rect::from_min_size(
        pos2(bar.right() - 122.0, bar.top() + 7.0),
        vec2(110.0, 32.0),
    );

    // アンインストール後は起動するものがないので閉じるだけにする
    if view.task == Task::Uninstall {
        return space_button(ui, close, "CLOSE", None, true).then_some(Action::Close);
    }
    let launch = Rect::from_min_size(close.left_top() - vec2(170.0, 0.0), vec2(160.0, 32.0));
    if space_button(ui, launch, "LAUNCH GAME", None, true) {
        return Some(Action::Launch);
    }
    space_button(ui, close, "CLOSE", None, false).then_some(Action::Close)
}

/// 失敗の画面を描く
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
    let area = ui.max_rect();
    draw_stars(ui.painter(), area, view.seconds, 1.0);
    centered_text(
        ui,
        pos2(area.center().x, area.top() + 52.0),
        "MISSION FAILED",
        pixel(26.0),
        RED,
    );
    centered_text(
        ui,
        pos2(area.center().x, area.top() + 92.0),
        match view.task {
            Task::Install => "インストールに失敗しました",
            Task::Update => "アップデートに失敗しました",
            Task::Uninstall => "アンインストールに失敗しました",
        },
        dot(17.0),
        YELLOW,
    );

    // 失敗の内容をパネルに出す
    let panel = Rect::from_min_size(
        area.left_top() + vec2(60.0, 118.0),
        vec2(area.width() - 120.0, 200.0),
    );
    ui.painter().rect_filled(panel, CornerRadius::ZERO, PANEL);
    ui.painter().rect_stroke(
        panel,
        CornerRadius::ZERO,
        Stroke::new(4.0, FRAME),
        StrokeKind::Inside,
    );
    ui.painter().text(
        panel.left_top() + vec2(18.0, 14.0),
        Align2::LEFT_TOP,
        "REPORT",
        pixel(8.0),
        FRAME,
    );
    let clip = Rect::from_min_max(
        panel.left_top() + vec2(18.0, 34.0),
        panel.right_bottom() - vec2(18.0, 12.0),
    );
    let galley = ui
        .painter()
        .layout(view.failure.to_owned(), dot(13.0), TEXT, clip.width());
    ui.painter()
        .with_clip_rect(clip)
        .galley(clip.left_top(), galley, TEXT);

    // ボタンは横に2つ並べる
    let mut chosen = None;
    let width = 200.0;
    for (index, &(label, note, action, hot)) in FAILED_BUTTONS.iter().enumerate() {
        let rect = Rect::from_min_size(
            pos2(
                area.center().x - width - 8.0 + index as f32 * (width + 16.0),
                panel.bottom() + 24.0,
            ),
            vec2(width, MENU_HEIGHT),
        );
        if space_button(ui, rect, label, Some(note), hot) {
            chosen = Some(action);
        }
    }
    chosen
}

/// ブラウン管風の走査線を重ねる
///
/// # 引数
///
/// * `ui` - 描画先
/// * `area` - ウィンドウ全体
///
/// # 戻り値
///
/// 戻り値なし
fn draw_scanlines(ui: &Ui, area: Rect) {
    let line = Color32::from_rgba_unmultiplied(0, 0, 0, 46);
    let mut y = area.top();
    while y < area.bottom() {
        ui.painter().rect_filled(
            Rect::from_min_size(pos2(area.left(), y + 2.0), vec2(area.width(), 1.0)),
            CornerRadius::ZERO,
            line,
        );
        y += 3.0;
    }
}

#[cfg(test)]
mod tests {
    use eframe::egui::{Context, RawInput};

    use super::*;

    /// ボタンの左右に残す余白
    const BUTTON_PADDING: f32 = 10.0;

    /// すべてのボタンの文言と補足が、ボタンの幅に収まることを確かめる
    #[test]
    fn button_labels_fit_their_buttons() {
        // 本番と同じフォントを読み込み、1フレーム回して反映する
        let ctx = Context::default();
        crate::app::install_fonts(&ctx);
        let _ = ctx.run_ui(RawInput::default(), |_| {});

        let columns = [
            (TITLE_BUTTONS, MENU_WIDTH),
            (MENU_BUTTONS, MENU_WIDTH),
            (CONFIRM_BUTTONS, MENU_WIDTH),
            (DESTINATION_BUTTONS, LIST_WIDTH),
            (FAILED_BUTTONS, 200.0),
        ];
        for (buttons, width) in columns {
            let room = width - BUTTON_PADDING * 2.0;
            for &(label, note, _, _) in buttons {
                for (text, font) in [(label, pixel(BUTTON_FONT_SIZE)), (note, dot(12.0))] {
                    let size = ctx.fonts_mut(|fonts| {
                        fonts.layout_no_wrap(text.to_owned(), font, WHITE).size().x
                    });
                    assert!(size <= room, "ボタンからはみ出す文言: {text}");
                }
            }
        }
    }

    /// 最も長い字幕が下段の幅に収まることを確かめる
    #[test]
    fn captions_fit_the_footer() {
        let ctx = Context::default();
        crate::app::install_fonts(&ctx);
        let _ = ctx.run_ui(RawInput::default(), |_| {});

        for stage in [
            Stage::Preparing,
            Stage::Downloading,
            Stage::Unpacking,
            Stage::Finalizing,
            Stage::Removing,
        ] {
            let text = caption(stage);
            let _ = ctx.run_ui(RawInput::default(), |ui| {
                let width = spaced_width(ui, text, &pixel(12.0), CAPTION_SPACING);
                // 左下のテーマ切り替えボタンと重ならない幅
                assert!(width <= 760.0 - 2.0 * 112.0, "下段からはみ出す字幕: {text}");
            });
        }
    }
}
