//! アーケードのテーマ
//!
//! ゲームセンターの筐体風の画面で、インストール中はシューティングを遊べる。
//! インストールが終わるとボスが出現する

use eframe::egui::{
    self, Align2, Color32, CornerRadius, Pos2, Rect, Stroke, StrokeKind, TextEdit, Ui, Visuals,
    pos2, vec2,
};
use pandd_setup::shooter::{BOSS_HEALTH, EXPLOSION_SECONDS, Game, Phase, Vec2 as GameVec};

use super::{
    Action, Screen, View, body, bold, centered_text, framed, hit_area, palette, pixel, sprite,
    stage_label, wrapped_text,
};

// ロゴの配色を夜の筐体向けに割り当てる
const BLACK: Color32 = palette::NIGHT;
const RED: Color32 = palette::CORAL_DEEP;
const RED_SOFT: Color32 = palette::CORAL;
const RED_DARK: Color32 = Color32::from_rgb(0x5c, 0x22, 0x2a);
const GOLD: Color32 = palette::CORAL_LIGHT;
const GREY: Color32 = palette::CHARCOAL_SOFT;
const WHITE: Color32 = palette::WHITE;

/// HUD の高さ
pub const HUD_HEIGHT: f32 = 52.0;
/// 進捗バーを置く下段の高さ
pub const FOOTER_HEIGHT: f32 = 50.0;

const SHIP: &[&str] = &[
    ".....W.....",
    "....WRW....",
    "....WRW....",
    "...WWRWW...",
    "..WWWWWWW..",
    ".WWRWWWRWW.",
    "WWRRWWWRRWW",
    "W..RR.RR..W",
    "....Y.Y....",
];
const DRONE: &[&str] = &[
    "...GGGGG...",
    ".GGGGGGGGG.",
    "GGRGGRGGRGG",
    "GGGGGGGGGGG",
    ".G.G.G.G.G.",
    "..Y.....Y..",
];
const BOSS: &[&str] = &[
    "....KKKKKKKKKKKK....",
    "..KKGGGGGGGGGGGGKK..",
    ".KGGGGRRRRRRRRGGGGK.",
    "KGGGGRRWWWWWWRRGGGGK",
    "KGGGRRWWYYYYWWRRGGGK",
    "KGGGRRWWYYYYWWRRGGGK",
    "KGGGGRRWWWWWWRRGGGGK",
    ".KGGGGRRRRRRRRGGGGK.",
    "..KKGGGGGGGGGGGGKK..",
    "KK..KGGK....KGGK..KK",
    "GK...KK......KK...KG",
    "G..................G",
];

/// ドット絵の文字を色に変える
///
/// # 引数
///
/// * `cell` - 点描データの1文字
///
/// # 戻り値
///
/// 対応する色。透明なら None
fn palette(cell: char) -> Option<Color32> {
    match cell {
        'W' => Some(WHITE),
        'R' => Some(RED),
        'Y' => Some(GOLD),
        'G' => Some(Color32::from_rgb(0x8a, 0x8a, 0x9a)),
        'K' => Some(Color32::from_rgb(0x3a, 0x3a, 0x4a)),
        _ => None,
    }
}

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
    ui.painter().rect_filled(area, CornerRadius::ZERO, BLACK);

    let action = match view.screen {
        Screen::Welcome => title(ui, view),
        Screen::Destination => select_player(ui, view),
        Screen::Running | Screen::Finished => stage(ui, view),
        Screen::Failed => game_over(ui, view),
    };
    draw_scanlines(ui, area);
    action
}

/// スコア、ハイスコア、残機を上段に描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `game` - シューティングの状態。始まる前は None
///
/// # 戻り値
///
/// 戻り値なし
fn hud(ui: &Ui, game: Option<&Game>) {
    let area = ui.max_rect();
    let score = game.map_or(0, |game| game.score);
    let high = game.map_or(0, |game| game.high_score);
    let top = area.top() + 10.0;
    let painter = ui.painter();
    painter.text(
        pos2(area.left() + 24.0, top),
        Align2::LEFT_TOP,
        "1UP",
        pixel(11.0),
        RED_SOFT,
    );
    painter.text(
        pos2(area.left() + 24.0, top + 18.0),
        Align2::LEFT_TOP,
        format!("{score:07}"),
        pixel(11.0),
        WHITE,
    );
    painter.text(
        pos2(area.center().x, top),
        Align2::CENTER_TOP,
        "HI-SCORE",
        pixel(11.0),
        RED_SOFT,
    );
    painter.text(
        pos2(area.center().x, top + 18.0),
        Align2::CENTER_TOP,
        format!("{high:07}"),
        pixel(11.0),
        WHITE,
    );

    // 残機は小さな自機で並べる
    if let Some(game) = game {
        painter.text(
            pos2(area.right() - 200.0, top),
            Align2::LEFT_TOP,
            "LIVES",
            pixel(11.0),
            RED_SOFT,
        );
        for index in 0..game.player.lives {
            sprite(
                ui,
                SHIP,
                palette,
                pos2(area.right() - 192.0 + index as f32 * 18.0, top + 24.0),
                1.4,
            );
        }
    }
}

/// 夕日と流れるグリッドを描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `horizon` - 地平線の y 座標
/// * `seconds` - 起動からの秒数
///
/// # 戻り値
///
/// 戻り値なし
fn draw_sunset(ui: &Ui, horizon: f32, seconds: f32) {
    let area = ui.max_rect();
    let painter = ui.painter();

    // 横縞で切った半円の夕日
    let center = pos2(area.center().x, horizon);
    let radius = 118.0;
    let mut y = horizon - radius;
    let mut band = 0;
    while y < horizon {
        let gap = 2.0 + band as f32 * 0.6;
        let height = 12.0 - band as f32 * 0.4;
        let mid = (y + height / 2.0 - center.y).abs().min(radius);
        let half = (radius * radius - mid * mid).sqrt();
        let color = if band < 5 { GOLD } else { RED_SOFT };
        painter.rect_filled(
            Rect::from_min_max(
                pos2(center.x - half, y),
                pos2(center.x + half, (y + height).min(horizon)),
            ),
            CornerRadius::ZERO,
            color,
        );
        y += height + gap;
        band += 1;
    }

    // 奥へ集まる縦線と、手前へ流れる横線で床を作る
    painter.line_segment(
        [pos2(area.left(), horizon), pos2(area.right(), horizon)],
        Stroke::new(3.0, RED_SOFT),
    );
    let grid = Stroke::new(1.5, Color32::from_rgba_unmultiplied(0xe6, 0x00, 0x12, 140));
    for index in -12..=12 {
        let x = center.x + index as f32 * 70.0;
        painter.line_segment(
            [
                pos2(center.x + index as f32 * 8.0, horizon),
                pos2(x, area.bottom()),
            ],
            grid,
        );
    }
    let depth = area.bottom() - horizon;
    let scroll = seconds.fract();
    for index in 0..8 {
        let t = (index as f32 + scroll) / 8.0;
        let y = horizon + depth * t * t;
        painter.line_segment([pos2(area.left(), y), pos2(area.right(), y)], grid);
    }
}

/// 影付きのドット文字を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `center` - 文字の中心
/// * `text` - 文字列
/// * `size` - 大きさ
/// * `color` - 文字の色
///
/// # 戻り値
///
/// 戻り値なし
fn shadow_text(ui: &Ui, center: Pos2, text: &str, size: f32, color: Color32) {
    let depth = (size / 14.0).max(2.0);
    centered_text(
        ui,
        center + vec2(depth * 2.0, depth * 2.0),
        text,
        pixel(size),
        RED_DARK,
    );
    centered_text(ui, center + vec2(depth, depth), text, pixel(size), RED);
    centered_text(ui, center, text, pixel(size), color);
}

/// 点滅させるかを返す
///
/// # 引数
///
/// * `seconds` - 起動からの秒数
/// * `rate` - 1秒あたりの点滅回数
///
/// # 戻り値
///
/// 表示する時間帯なら true
fn blink(seconds: f32, rate: f32) -> bool {
    (seconds * rate * 2.0) as i32 % 2 == 0
}

/// 筐体風のボタンを描き、押されたかを返す
///
/// # 引数
///
/// * `ui` - 配置先
/// * `rect` - ボタンの範囲
/// * `label` - 文言
/// * `primary` - 赤い主ボタンなら true
///
/// # 戻り値
///
/// 押されたら true
fn arcade_button(ui: &mut Ui, rect: Rect, label: &str, primary: bool) -> bool {
    let response = hit_area(ui, rect);
    let pressed = response.is_pointer_button_down_on();
    let (face, edge) = if primary {
        (RED, Color32::from_rgb(0x6a, 0x00, 0x08))
    } else {
        (
            Color32::from_rgb(0x2a, 0x2a, 0x36),
            Color32::from_rgb(0x12, 0x12, 0x1a),
        )
    };
    let sink = if pressed { 4.0 } else { 0.0 };
    ui.painter()
        .rect_filled(rect.translate(vec2(0.0, 6.0)), CornerRadius::ZERO, edge);
    let face_rect = rect.translate(vec2(0.0, sink));
    ui.painter()
        .rect_filled(face_rect, CornerRadius::ZERO, face);
    if response.hovered() {
        ui.painter().rect_stroke(
            face_rect,
            CornerRadius::ZERO,
            Stroke::new(2.0, GOLD),
            StrokeKind::Inside,
        );
    }
    centered_text(ui, face_rect.center(), label, pixel(11.0), WHITE);
    response.clicked()
}

/// タイトル画面を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 押されたボタンの操作
fn title(ui: &mut Ui, view: &View) -> Option<Action> {
    let area = ui.max_rect();
    draw_sunset(ui, area.top() + 262.0, view.seconds);
    hud(ui, None);

    shadow_text(
        ui,
        pos2(area.center().x, area.top() + 128.0),
        "PANDD",
        62.0,
        WHITE,
    );
    // 夕日の縞と重なっても読めるよう、暗い帯の上に置く
    let subtitle = pos2(area.center().x, area.top() + 184.0);
    ui.painter().rect_filled(
        Rect::from_center_size(subtitle, vec2(236.0, 24.0)),
        CornerRadius::ZERO,
        BLACK,
    );
    centered_text(ui, subtitle, "GAME LAUNCHER", pixel(13.0), WHITE);
    if blink(view.seconds, 1.0) {
        centered_text(
            ui,
            pos2(area.center().x, area.top() + 300.0),
            "INSERT COIN",
            pixel(18.0),
            GOLD,
        );
    }
    let start =
        Rect::from_center_size(pos2(area.center().x, area.top() + 362.0), vec2(300.0, 46.0));
    let chosen = arcade_button(ui, start, "START  インストール", true).then_some(Action::Next);
    centered_text(
        ui,
        pos2(area.center().x, area.bottom() - 22.0),
        "© PANDD   CREDIT 00",
        pixel(9.0),
        GREY,
    );
    chosen
}

/// インストール先を選ぶ画面を描く
///
/// # 引数
///
/// * `ui` - 描画先
/// * `view` - セットアップの状態
///
/// # 戻り値
///
/// 押されたボタンの操作
fn select_player(ui: &mut Ui, view: &mut View) -> Option<Action> {
    let area = ui.max_rect();
    hud(ui, None);
    shadow_text(
        ui,
        pos2(area.center().x, area.top() + 92.0),
        "SELECT PLAYER",
        22.0,
        WHITE,
    );

    // 1P は既定の場所、2P は好きな場所
    let custom = view.root_text.trim() != view.default_root;
    let mut chosen = None;
    let left = Rect::from_min_size(
        pos2(area.left() + 48.0, area.top() + 128.0),
        vec2(320.0, 150.0),
    );
    let right = left.translate(vec2(344.0, 0.0));
    for (rect, number, caption, selected, action) in [
        (left, "1P", "RECOMMENDED", !custom, Action::UseDefault),
        (right, "2P", "CUSTOM", custom, Action::Browse),
    ] {
        let response = hit_area(ui, rect);
        let border = if selected {
            GOLD
        } else {
            Color32::from_rgb(0x44, 0x44, 0x50)
        };
        framed(
            ui,
            rect,
            0,
            Color32::from_rgb(0x0d, 0x0d, 0x14),
            Stroke::new(4.0, border),
        );
        let mut label = number.to_owned();
        if selected && blink(view.seconds, 1.5) {
            label.push_str(" ◀");
        }
        ui.painter().text(
            rect.left_top() + vec2(16.0, 16.0),
            Align2::LEFT_TOP,
            label,
            pixel(15.0),
            GOLD,
        );
        ui.painter().text(
            rect.left_top() + vec2(16.0, 44.0),
            Align2::LEFT_TOP,
            caption,
            pixel(9.0),
            WHITE,
        );
        let description = if number == "1P" {
            view.default_root.to_owned()
        } else {
            "好きなフォルダを選ぶ（クリックで参照）".to_owned()
        };
        wrapped_text(
            ui,
            rect.left_top() + vec2(16.0, 70.0),
            &description,
            body(13.0),
            Color32::from_rgb(0xcc, 0xcc, 0xd4),
            rect.width() - 32.0,
        );
        if response.clicked() {
            chosen = Some(action);
        }
    }

    // 直接入力もできるようにし、実際の場所と問題を添える
    let field = Rect::from_min_size(pos2(left.left(), left.bottom() + 18.0), vec2(664.0, 30.0));
    ui.put(
        field,
        TextEdit::singleline(view.root_text)
            .font(body(13.0))
            .text_color(WHITE)
            .margin(egui::Margin::symmetric(8, 6)),
    );
    let (note, color) = match view.directory_problem {
        Some(problem) => (problem.to_owned(), RED_SOFT),
        None => (format!("INSTALL TO  {}", view.final_root), GREY),
    };
    wrapped_text(
        ui,
        field.left_bottom() + vec2(0.0, 6.0),
        &note,
        body(12.0),
        color,
        field.width(),
    );

    let start = Rect::from_min_size(
        pos2(right.right() - 300.0, area.bottom() - 70.0),
        vec2(300.0, 44.0),
    );
    if arcade_button(ui, start, "START  インストール", true) {
        chosen = Some(Action::Install);
    }
    let back = Rect::from_min_size(pos2(left.left(), area.bottom() - 70.0), vec2(140.0, 44.0));
    if arcade_button(ui, back, "BACK", false) {
        chosen = Some(Action::Back);
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

/// シューティングのフィールドと進捗を描く
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
    hud(ui, view.game);
    let game = view.game?;
    let painter = ui.painter().with_clip_rect(field);

    // 奥行きのある星空を流す
    for index in 0..70u32 {
        let seed = index.wrapping_mul(2_654_435_761);
        let speed = 30.0 + (seed % 90) as f32;
        let x = (seed % 997) as f32 / 997.0 * field.width();
        let y = ((seed / 997 % 991) as f32 / 991.0 * field.height() + view.seconds * speed)
            % field.height();
        let shade = (90 + seed % 150) as u8;
        painter.rect_filled(
            Rect::from_min_size(field.left_top() + vec2(x, y), vec2(2.0, 2.0)),
            CornerRadius::ZERO,
            Color32::from_gray(shade),
        );
    }

    for enemy in &game.enemies {
        sprite(ui, DRONE, palette, to_screen(field, enemy.position), 3.0);
    }
    if let Some(boss) = game.boss {
        let center = to_screen(field, boss.position);
        sprite(ui, BOSS, palette, center, 5.0);

        // ボスの耐久力をフィールド上部に出す
        let bar = Rect::from_min_size(
            field.left_top() + vec2(180.0, 8.0),
            vec2(field.width() - 360.0, 8.0),
        );
        painter.rect_filled(bar, CornerRadius::ZERO, Color32::from_rgb(0x30, 0x10, 0x14));
        let health = boss.health as f32 / BOSS_HEALTH as f32;
        painter.rect_filled(
            Rect::from_min_size(bar.min, vec2(bar.width() * health, bar.height())),
            CornerRadius::ZERO,
            RED_SOFT,
        );
        painter.text(
            bar.left_center() - vec2(10.0, 0.0),
            Align2::RIGHT_CENTER,
            "BOSS",
            pixel(9.0),
            GOLD,
        );
    }
    for shot in &game.shots {
        let center = to_screen(field, shot.position);
        painter.rect_filled(
            Rect::from_center_size(center, vec2(3.0, 10.0)),
            CornerRadius::ZERO,
            GOLD,
        );
    }
    for shot in &game.enemy_shots {
        let center = to_screen(field, shot.position);
        painter.circle_filled(center, 4.5, RED_SOFT);
        painter.circle_filled(center, 2.0, WHITE);
    }
    for explosion in &game.explosions {
        let t = explosion.age / EXPLOSION_SECONDS;
        let center = to_screen(field, explosion.position);
        let radius = (6.0 + t * 22.0) * explosion.scale;
        painter.circle_stroke(
            center,
            radius,
            Stroke::new(3.0, GOLD.gamma_multiply(1.0 - t)),
        );
        for index in 0..8 {
            let angle = index as f32 / 8.0 * std::f32::consts::TAU;
            let dot = center + vec2(angle.cos(), angle.sin()) * radius * 0.8;
            painter.rect_filled(
                Rect::from_center_size(dot, vec2(4.0, 4.0)),
                CornerRadius::ZERO,
                RED_SOFT.gamma_multiply(1.0 - t),
            );
        }
    }

    // 無敵中は自機を点滅させる
    let player_visible = game.player.invulnerable == 0.0 || blink(view.seconds, 6.0);
    if player_visible && !matches!(game.phase, Phase::GameOver(_)) {
        sprite(
            ui,
            SHIP,
            palette,
            to_screen(field, game.player.position),
            3.0,
        );
    }

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
            pos2(center.x, field.bottom() - 18.0),
            "←↑↓→ / WASD で移動   Z / SPACE でショット",
            pixel(10.0),
            WHITE,
        );
    }
    match game.phase {
        Phase::Warning(_) => {
            let band = Rect::from_center_size(center, vec2(field.width(), 70.0));
            ui.painter()
                .rect_filled(band, CornerRadius::ZERO, RED.gamma_multiply(0.35));
            if blink(view.seconds, 3.0) {
                shadow_text(ui, center - vec2(0.0, 8.0), "WARNING!!", 28.0, GOLD);
            }
            centered_text(
                ui,
                center + vec2(0.0, 24.0),
                "インストール完了！ ボスが接近中",
                bold(14.0),
                WHITE,
            );
        }
        Phase::Cleared => {
            shadow_text(ui, center - vec2(0.0, 30.0), "STAGE CLEAR!", 32.0, GOLD);
            centered_text(
                ui,
                center + vec2(0.0, 16.0),
                "BOSS BONUS  10000",
                pixel(12.0),
                WHITE,
            );
        }
        Phase::GameOver(remaining) => {
            shadow_text(ui, center - vec2(0.0, 20.0), "GAME OVER", 30.0, WHITE);
            centered_text(
                ui,
                center + vec2(0.0, 22.0),
                &format!("CONTINUE  {}", remaining.ceil() as u32),
                pixel(12.0),
                GOLD,
            );
        }
        Phase::Playing | Phase::Boss => {}
    }
}

/// 下段に 20 マスの進捗と、完了後のボタンを描く
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
    ui.painter()
        .rect_filled(bar, CornerRadius::ZERO, Color32::from_rgb(0x0d, 0x0d, 0x14));
    ui.painter().line_segment(
        [bar.left_top(), bar.right_top()],
        Stroke::new(2.0, RED_SOFT),
    );

    if view.screen == Screen::Finished {
        ui.painter().text(
            bar.left_center() + vec2(20.0, 0.0),
            Align2::LEFT_CENTER,
            if view.updating {
                "UPDATE COMPLETE!"
            } else {
                "INSTALL COMPLETE!"
            },
            pixel(11.0),
            GOLD,
        );
        let play = Rect::from_min_size(
            pos2(bar.right() - 410.0, bar.top() + 8.0),
            vec2(270.0, 32.0),
        );
        let close = Rect::from_min_size(
            pos2(bar.right() - 128.0, bar.top() + 8.0),
            vec2(110.0, 32.0),
        );
        if arcade_button(ui, play, "PLAY  ランチャーを起動", true) {
            return Some(Action::Launch);
        }
        if arcade_button(ui, close, "閉じる", false) {
            return Some(Action::Close);
        }
        return None;
    }

    // 1マス 5% のブロックをためていく
    let fraction = view.progress.fraction();
    let lit = (fraction * 20.0).round() as usize;
    let start = bar.left_top() + vec2(20.0, 12.0);
    for index in 0..20 {
        let cell = Rect::from_min_size(start + vec2(index as f32 * 22.0, 0.0), vec2(18.0, 18.0));
        let color = if index < lit {
            RED_SOFT
        } else {
            Color32::from_rgb(0x22, 0x22, 0x2a)
        };
        ui.painter().rect_filled(cell, CornerRadius::ZERO, color);
    }
    ui.painter().text(
        start + vec2(20.0 * 22.0 + 10.0, 9.0),
        Align2::LEFT_CENTER,
        format!("{:3}%", (fraction * 100.0) as u32),
        pixel(11.0),
        WHITE,
    );
    ui.painter().text(
        bar.right_center() - vec2(20.0, 0.0),
        Align2::RIGHT_CENTER,
        stage_label(view.progress.stage()),
        bold(13.0),
        GREY,
    );
    None
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
fn game_over(ui: &mut Ui, view: &View) -> Option<Action> {
    let area = ui.max_rect();
    hud(ui, view.game);
    shadow_text(
        ui,
        pos2(area.center().x, area.top() + 110.0),
        "GAME OVER",
        40.0,
        WHITE,
    );
    centered_text(
        ui,
        pos2(area.center().x, area.top() + 160.0),
        if view.updating {
            "アップデートに失敗しました"
        } else {
            "インストールに失敗しました"
        },
        bold(16.0),
        GOLD,
    );
    let detail = Rect::from_min_size(
        pos2(area.left() + 60.0, area.top() + 188.0),
        vec2(area.width() - 120.0, 180.0),
    );
    framed(
        ui,
        detail,
        0,
        Color32::from_rgb(0x0d, 0x0d, 0x14),
        Stroke::new(2.0, Color32::from_rgb(0x44, 0x44, 0x50)),
    );
    let inner = detail.shrink(10.0);
    let galley = ui
        .painter()
        .layout(view.failure.to_owned(), body(11.0), GREY, inner.width());
    ui.painter()
        .with_clip_rect(inner)
        .galley(inner.left_top(), galley, GREY);

    let retry = Rect::from_min_size(
        pos2(area.center().x - 230.0, area.bottom() - 84.0),
        vec2(220.0, 44.0),
    );
    let close = Rect::from_min_size(
        pos2(area.center().x + 10.0, area.bottom() - 84.0),
        vec2(220.0, 44.0),
    );
    if arcade_button(ui, retry, "CONTINUE  もう一度", true) {
        return Some(Action::Retry);
    }
    arcade_button(ui, close, "閉じる", false).then_some(Action::Close)
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
    let line = Color32::from_rgba_unmultiplied(0, 0, 0, 60);
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
