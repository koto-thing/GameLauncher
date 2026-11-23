//! インストール中に遊べる横シューティングのゲームロジック
//!
//! 描画とは切り離し、座標は左上を原点とする画面ピクセルで扱う。
//! 敵は右から現れ、自機のショットは近くの敵へ曲がって飛ぶ。
//! インストールが終わるとボスが出現し、倒すとステージクリアになる

/// 2次元の座標と速度
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec2 {
    /// 横方向
    pub x: f32,
    /// 縦方向（下が正）
    pub y: f32,
}

impl Vec2 {
    /// 座標を作る
    ///
    /// # 引数
    ///
    /// * `x` - 横方向
    /// * `y` - 縦方向
    ///
    /// # 戻り値
    ///
    /// 作成した座標
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    /// 2点間の距離の2乗を返す
    ///
    /// # 引数
    ///
    /// * `other` - もう一方の点
    ///
    /// # 戻り値
    ///
    /// 距離の2乗
    fn distance_squared(self, other: Self) -> f32 {
        let (dx, dy) = (self.x - other.x, self.y - other.y);
        dx * dx + dy * dy
    }
}

/// 1フレーム分の操作
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Input {
    /// 左へ移動
    pub left: bool,
    /// 右へ移動
    pub right: bool,
    /// 上へ移動
    pub up: bool,
    /// 下へ移動
    pub down: bool,
    /// ショット
    pub fire: bool,
}

/// ゲームの進行状況
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Phase {
    /// 通常の敵が出てくる
    Playing,
    /// インストール完了の合図。残り秒数のあとボスが出る
    Warning(f32),
    /// ボス戦
    Boss,
    /// ボスを倒した
    Cleared,
    /// 自機を失った。残り秒数のあと再開する
    GameOver(f32),
}

/// 弾
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shot {
    /// 位置
    pub position: Vec2,
    /// 1秒あたりの移動量
    pub velocity: Vec2,
}

/// 通常の敵
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Enemy {
    /// 位置
    pub position: Vec2,
    /// 縦揺れの中心
    base_y: f32,
    /// 出現からの経過秒数
    pub age: f32,
}

/// ボス
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Boss {
    /// 位置
    pub position: Vec2,
    /// 残りの耐久力
    pub health: u32,
    /// 出現からの経過秒数
    pub age: f32,
    /// 次の弾幕までの秒数
    spread_timer: f32,
    /// 次の狙い撃ちまでの秒数
    aimed_timer: f32,
}

impl Boss {
    /// 画面に降りてくる途中かを返す
    ///
    /// # 戻り値
    ///
    /// 定位置に着く前なら true。この間は弾が当たらない
    pub fn is_entering(&self) -> bool {
        self.age < BOSS_ENTRY_SECONDS
    }
}

/// 爆発の演出
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Explosion {
    /// 位置
    pub position: Vec2,
    /// 発生からの経過秒数
    pub age: f32,
    /// 大きさの倍率
    pub scale: f32,
}

/// 自機
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Player {
    /// 位置
    pub position: Vec2,
    /// 残機
    pub lives: u32,
    /// 被弾後の無敵の残り秒数
    pub invulnerable: f32,
    /// 次のショットまでの秒数
    cooldown: f32,
}

/// ボスの最大耐久力
pub const BOSS_HEALTH: u32 = 80;
/// 爆発の演出が続く秒数
pub const EXPLOSION_SECONDS: f32 = 0.5;
/// 開始時と再開時の残機
const STARTING_LIVES: u32 = 3;
const PLAYER_SPEED: f32 = 280.0;
/// 撃った直後の弾の速さ。扇状に開いてから敵へ向かう
const SHOT_LAUNCH_SPEED: f32 = 260.0;
/// 敵へ向かうときの弾の速さ
const SHOT_SPEED: f32 = 620.0;
/// 弾が狙いの方向へ曲がる速さ（1秒あたり）
const SHOT_TURN_RATE: f32 = 5.0;
const SHOT_COOLDOWN: f32 = 0.1;
const ENEMY_SPEED: f32 = 95.0;
const ENEMY_SPAWN_SECONDS: f32 = 0.9;
const WARNING_SECONDS: f32 = 2.5;
const GAME_OVER_SECONDS: f32 = 3.0;
const BOSS_ENTRY_SECONDS: f32 = 2.0;
/// ボスが定位置に着いたときの、右端からの距離
const BOSS_HOME_FROM_RIGHT: f32 = 100.0;
const INVULNERABLE_SECONDS: f32 = 2.0;
const PLAYER_RADIUS: f32 = 6.0;
const ENEMY_RADIUS: f32 = 16.0;
const BOSS_RADIUS: f32 = 48.0;
const SHOT_RADIUS: f32 = 4.0;
const ENEMY_SCORE: u32 = 100;
const BOSS_SCORE: u32 = 10_000;

/// シューティングの状態
#[derive(Clone, Debug, PartialEq)]
pub struct Game {
    /// フィールドの大きさ
    pub size: Vec2,
    /// 自機
    pub player: Player,
    /// 自機の弾
    pub shots: Vec<Shot>,
    /// 敵とボスの弾
    pub enemy_shots: Vec<Shot>,
    /// 通常の敵
    pub enemies: Vec<Enemy>,
    /// ボス。出現前と撃破後は None
    pub boss: Option<Boss>,
    /// 爆発の演出
    pub explosions: Vec<Explosion>,
    /// 進行状況
    pub phase: Phase,
    /// 今回のスコア
    pub score: u32,
    /// このセットアップ中の最高スコア
    pub high_score: u32,
    spawn_timer: f32,
    random: u64,
}

impl Game {
    /// 指定した大きさのフィールドでゲームを始める
    ///
    /// # 引数
    ///
    /// * `width` - フィールドの幅
    /// * `height` - フィールドの高さ
    /// * `seed` - 敵の出現位置を決める乱数の種。0 以外を渡す
    ///
    /// # 戻り値
    ///
    /// 自機が画面左にいる開始状態
    pub fn new(width: f32, height: f32, seed: u64) -> Self {
        let size = Vec2::new(width, height);
        Self {
            size,
            player: Self::fresh_player(size),
            shots: Vec::new(),
            enemy_shots: Vec::new(),
            enemies: Vec::new(),
            boss: None,
            explosions: Vec::new(),
            phase: Phase::Playing,
            score: 0,
            high_score: 0,
            spawn_timer: ENEMY_SPAWN_SECONDS,
            random: seed.max(1),
        }
    }

    /// 1フレーム進める
    ///
    /// # 引数
    ///
    /// * `seconds` - 前のフレームからの経過秒数
    /// * `input` - このフレームの操作
    /// * `install_finished` - インストールが終わっていれば true。ボスの出現に使う
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    pub fn update(&mut self, seconds: f32, input: Input, install_finished: bool) {
        // 極端に長いフレームで弾がすり抜けないよう経過時間を抑える
        let dt = seconds.clamp(0.0, 0.05);

        self.update_player(dt, input);
        self.update_phase(dt, install_finished);
        self.update_enemies(dt);
        self.update_boss(dt);
        self.move_shots(dt);
        self.resolve_hits();
        self.resolve_player_damage();

        // 古い爆発を消す
        for explosion in &mut self.explosions {
            explosion.age += dt;
        }
        self.explosions
            .retain(|explosion| explosion.age < EXPLOSION_SECONDS);
        self.high_score = self.high_score.max(self.score);
    }

    /// 開始位置にいる自機を作る
    ///
    /// # 引数
    ///
    /// * `size` - フィールドの大きさ
    ///
    /// # 戻り値
    ///
    /// 残機が満タンの自機
    fn fresh_player(size: Vec2) -> Player {
        Player {
            position: Vec2::new(80.0, size.y / 2.0),
            lives: STARTING_LIVES,
            invulnerable: INVULNERABLE_SECONDS,
            cooldown: 0.0,
        }
    }

    /// 自機の移動とショットを処理する
    ///
    /// # 引数
    ///
    /// * `dt` - 経過秒数
    /// * `input` - このフレームの操作
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn update_player(&mut self, dt: f32, input: Input) {
        if matches!(self.phase, Phase::GameOver(_)) {
            return;
        }
        let player = &mut self.player;

        // 斜め移動でも速さが変わらないよう正規化して動かす
        let mut direction = Vec2::new(
            f32::from(u8::from(input.right)) - f32::from(u8::from(input.left)),
            f32::from(u8::from(input.down)) - f32::from(u8::from(input.up)),
        );
        let length = direction.x.hypot(direction.y);
        if length > 0.0 {
            direction = Vec2::new(direction.x / length, direction.y / length);
        }
        player.position.x =
            (player.position.x + direction.x * PLAYER_SPEED * dt).clamp(16.0, self.size.x * 0.6);
        player.position.y =
            (player.position.y + direction.y * PLAYER_SPEED * dt).clamp(12.0, self.size.y - 12.0);

        // 押している間は一定間隔で上下に開く2発のホーミングショットを撃つ
        player.invulnerable = (player.invulnerable - dt).max(0.0);
        player.cooldown = (player.cooldown - dt).max(0.0);
        if input.fire && player.cooldown == 0.0 {
            player.cooldown = SHOT_COOLDOWN;
            for spread in [-0.8, 0.8] {
                self.shots.push(Shot {
                    position: Vec2::new(player.position.x + 18.0, player.position.y),
                    velocity: Vec2::new(SHOT_LAUNCH_SPEED, spread * SHOT_LAUNCH_SPEED),
                });
            }
        }
    }

    /// インストールの状況に合わせて進行状況を切り替える
    ///
    /// # 引数
    ///
    /// * `dt` - 経過秒数
    /// * `install_finished` - インストールが終わっていれば true
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn update_phase(&mut self, dt: f32, install_finished: bool) {
        match self.phase {
            Phase::Playing if install_finished => self.phase = Phase::Warning(WARNING_SECONDS),
            Phase::Playing => {
                self.spawn_timer -= dt;
                if self.spawn_timer <= 0.0 {
                    self.spawn_timer = ENEMY_SPAWN_SECONDS;
                    self.spawn_wave();
                }
            }
            Phase::Warning(remaining) if remaining - dt <= 0.0 => {
                self.phase = Phase::Boss;
                self.boss = Some(Boss {
                    position: Vec2::new(self.size.x + BOSS_RADIUS * 2.0, self.size.y / 2.0),
                    health: BOSS_HEALTH,
                    age: 0.0,
                    spread_timer: 1.0,
                    aimed_timer: 1.5,
                });
            }
            Phase::Warning(remaining) => self.phase = Phase::Warning(remaining - dt),
            Phase::GameOver(remaining) if remaining - dt <= 0.0 => {
                // 再開時はスコアを戻し、インストールが終わっていればすぐボス戦へ進む
                self.player = Self::fresh_player(self.size);
                self.score = 0;
                self.phase = Phase::Playing;
            }
            Phase::GameOver(remaining) => self.phase = Phase::GameOver(remaining - dt),
            Phase::Boss | Phase::Cleared => {}
        }
    }

    /// 右端の外に、横に連なる1〜3体の編隊を出す
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn spawn_wave(&mut self) {
        let count = 1 + self.next_random() % 3;
        let margin = 50.0;
        let span = self.size.y - margin * 2.0;
        let y = margin + (self.next_random() % 1000) as f32 / 1000.0 * span;
        for index in 0..count {
            self.enemies.push(Enemy {
                position: Vec2::new(self.size.x + ENEMY_RADIUS + index as f32 * 44.0, y),
                base_y: y,
                age: index as f32 * 0.4,
            });
        }
    }

    /// 通常の敵を動かし、ときどき自機を狙って撃たせる
    ///
    /// # 引数
    ///
    /// * `dt` - 経過秒数
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn update_enemies(&mut self, dt: f32) {
        let target = self.player.position;
        let mut fired = Vec::new();
        for enemy in &mut self.enemies {
            enemy.age += dt;
            enemy.position.x -= ENEMY_SPEED * dt;
            enemy.position.y = enemy.base_y + (enemy.age * 2.2).sin() * 40.0;
            fired.push(enemy.position);
        }

        // 画面の右側にいる敵だけが低い確率で撃つ
        for origin in fired {
            let chance = (self.next_random() % 10_000) as f32 / 10_000.0;
            if origin.x < self.size.x && origin.x > self.size.x * 0.4 && chance < dt * 0.35 {
                self.enemy_shots.push(aimed_shot(origin, target, 170.0));
            }
        }
        self.enemies
            .retain(|enemy| enemy.position.x > -ENEMY_RADIUS * 2.0);
    }

    /// ボスを動かし、弾幕と狙い撃ちを出す
    ///
    /// # 引数
    ///
    /// * `dt` - 経過秒数
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn update_boss(&mut self, dt: f32) {
        let target = self.player.position;
        let size = self.size;
        let Some(boss) = &mut self.boss else {
            return;
        };
        boss.age += dt;

        // 登場中は右から定位置まで進み、その後は上下に揺れる
        let start = size.x + BOSS_RADIUS * 2.0;
        let home = size.x - BOSS_HOME_FROM_RIGHT;
        if boss.is_entering() {
            let t = boss.age / BOSS_ENTRY_SECONDS;
            boss.position.x = start + (home - start) * t;
            return;
        }
        let swing = (boss.age - BOSS_ENTRY_SECONDS) * 0.8;
        boss.position = Vec2::new(home, size.y / 2.0 + swing.sin() * size.y * 0.32);

        // 扇状の弾幕。耐久力が半分を切ると間隔が縮む
        let enraged = boss.health * 2 < BOSS_HEALTH;
        boss.spread_timer -= dt;
        if boss.spread_timer <= 0.0 {
            boss.spread_timer = if enraged { 0.8 } else { 1.3 };
            let count = if enraged { 9 } else { 7 };
            let phase = boss.age * 0.7;
            for index in 0..count {
                let angle = std::f32::consts::PI
                    + (index as f32 - (count - 1) as f32 / 2.0) * 0.22
                    + phase.sin() * 0.15;
                self.enemy_shots.push(Shot {
                    position: Vec2::new(boss.position.x - 30.0, boss.position.y),
                    velocity: Vec2::new(angle.cos() * 150.0, angle.sin() * 150.0),
                });
            }
        }

        // 怒り状態では自機を狙う弾も混ぜる
        boss.aimed_timer -= dt;
        if enraged && boss.aimed_timer <= 0.0 {
            boss.aimed_timer = 0.45;
            let origin = Vec2::new(boss.position.x - 30.0, boss.position.y);
            self.enemy_shots.push(aimed_shot(origin, target, 220.0));
        }
    }

    /// 弾が狙う相手の位置を返す
    ///
    /// # 引数
    ///
    /// * `from` - 弾や自機の位置
    ///
    /// # 戻り値
    ///
    /// 前方にいる最も近い敵か、登場を終えたボスの位置。いなければ None
    fn nearest_target(&self, from: Vec2) -> Option<Vec2> {
        let boss = self
            .boss
            .filter(|boss| !boss.is_entering())
            .map(|boss| boss.position);
        self.enemies
            .iter()
            .map(|enemy| enemy.position)
            .filter(|position| position.x > from.x - 40.0 && position.x < self.size.x)
            .chain(boss)
            .min_by(|a, b| {
                a.distance_squared(from)
                    .total_cmp(&b.distance_squared(from))
            })
    }

    /// 自機がロックオンしている相手の位置を返す
    ///
    /// # 戻り値
    ///
    /// ショットが向かう相手の位置。いなければ None
    pub fn lock_target(&self) -> Option<Vec2> {
        if matches!(self.phase, Phase::GameOver(_)) {
            return None;
        }
        self.nearest_target(self.player.position)
    }

    /// すべての弾を動かし、画面外へ出た弾を消す
    ///
    /// 自機の弾は近くの敵へ向きを変え、敵がいなければ右へ加速する
    ///
    /// # 引数
    ///
    /// * `dt` - 経過秒数
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn move_shots(&mut self, dt: f32) {
        let turn = (SHOT_TURN_RATE * dt).min(1.0);
        let targets: Vec<Option<Vec2>> = self
            .shots
            .iter()
            .map(|shot| self.nearest_target(shot.position))
            .collect();
        for (shot, target) in self.shots.iter_mut().zip(targets) {
            let desired = match target {
                Some(target) => {
                    let (dx, dy) = (target.x - shot.position.x, target.y - shot.position.y);
                    let length = dx.hypot(dy).max(1.0);
                    Vec2::new(dx / length * SHOT_SPEED, dy / length * SHOT_SPEED)
                }
                None => Vec2::new(SHOT_SPEED, 0.0),
            };
            shot.velocity.x += (desired.x - shot.velocity.x) * turn;
            shot.velocity.y += (desired.y - shot.velocity.y) * turn;
        }

        let size = self.size;
        let inside = |shot: &Shot| {
            shot.position.x > -20.0
                && shot.position.x < size.x + 20.0
                && shot.position.y > -20.0
                && shot.position.y < size.y + 20.0
        };
        for shot in self.shots.iter_mut().chain(self.enemy_shots.iter_mut()) {
            shot.position.x += shot.velocity.x * dt;
            shot.position.y += shot.velocity.y * dt;
        }
        self.shots.retain(inside);
        self.enemy_shots.retain(inside);
    }

    /// 自機の弾と敵・ボスの当たりを処理する
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn resolve_hits(&mut self) {
        let mut remaining_shots = Vec::with_capacity(self.shots.len());
        for shot in std::mem::take(&mut self.shots) {
            // 通常の敵は1発で倒れる
            let enemy_radius = (ENEMY_RADIUS + SHOT_RADIUS).powi(2);
            if let Some(index) = self
                .enemies
                .iter()
                .position(|enemy| enemy.position.distance_squared(shot.position) < enemy_radius)
            {
                let enemy = self.enemies.swap_remove(index);
                self.explode(enemy.position, 1.0);
                self.score += ENEMY_SCORE;
                continue;
            }

            // ボスは登場中を除いて耐久力を削る
            let boss_radius = (BOSS_RADIUS + SHOT_RADIUS).powi(2);
            let hits_boss = self.boss.is_some_and(|boss| {
                !boss.is_entering() && boss.position.distance_squared(shot.position) < boss_radius
            });
            if hits_boss {
                self.damage_boss(1);
                continue;
            }
            remaining_shots.push(shot);
        }
        self.shots = remaining_shots;
    }

    /// ボスの耐久力を減らし、0 になったらステージクリアにする
    ///
    /// # 引数
    ///
    /// * `amount` - 減らす量
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn damage_boss(&mut self, amount: u32) {
        let Some(boss) = &mut self.boss else {
            return;
        };
        boss.health = boss.health.saturating_sub(amount);
        if boss.health > 0 {
            return;
        }

        // 撃破時は弾を消し、大きな爆発を重ねる
        let center = boss.position;
        self.boss = None;
        self.enemy_shots.clear();
        self.enemies.clear();
        for (dx, dy, scale) in [
            (0.0, 0.0, 3.0),
            (-30.0, 10.0, 2.0),
            (30.0, -10.0, 2.0),
            (0.0, 30.0, 1.6),
        ] {
            self.explode(Vec2::new(center.x + dx, center.y + dy), scale);
        }
        self.score += BOSS_SCORE;
        self.phase = Phase::Cleared;
    }

    /// 自機への被弾と体当たりを処理する
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn resolve_player_damage(&mut self) {
        if self.player.invulnerable > 0.0
            || matches!(self.phase, Phase::Cleared | Phase::GameOver(_))
        {
            return;
        }
        let position = self.player.position;
        let shot_radius = (PLAYER_RADIUS + SHOT_RADIUS).powi(2);
        let enemy_radius = (PLAYER_RADIUS + ENEMY_RADIUS).powi(2);
        let boss_radius = (PLAYER_RADIUS + BOSS_RADIUS).powi(2);
        let hit = self
            .enemy_shots
            .iter()
            .any(|shot| shot.position.distance_squared(position) < shot_radius)
            || self
                .enemies
                .iter()
                .any(|enemy| enemy.position.distance_squared(position) < enemy_radius)
            || self
                .boss
                .is_some_and(|boss| boss.position.distance_squared(position) < boss_radius);
        if !hit {
            return;
        }

        // 被弾したら無敵時間を付け、残機がなくなればゲームオーバーにする
        self.explode(position, 1.4);
        self.enemy_shots.clear();
        self.player.lives -= 1;
        self.player.invulnerable = INVULNERABLE_SECONDS;
        if self.player.lives == 0 {
            self.enemies.clear();
            self.boss = None;
            self.phase = Phase::GameOver(GAME_OVER_SECONDS);
        }
    }

    /// 爆発の演出を追加する
    ///
    /// # 引数
    ///
    /// * `position` - 爆発の中心
    /// * `scale` - 大きさの倍率
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn explode(&mut self, position: Vec2, scale: f32) {
        self.explosions.push(Explosion {
            position,
            age: 0.0,
            scale,
        });
    }

    /// xorshift で次の乱数を返す
    ///
    /// # 戻り値
    ///
    /// 64ビットの擬似乱数
    fn next_random(&mut self) -> u64 {
        self.random ^= self.random << 13;
        self.random ^= self.random >> 7;
        self.random ^= self.random << 17;
        self.random
    }
}

/// 目標へ向かう弾を作る
///
/// # 引数
///
/// * `origin` - 発射位置
/// * `target` - 狙う位置
/// * `speed` - 1秒あたりの速さ
///
/// # 戻り値
///
/// 目標の方向へ進む弾
fn aimed_shot(origin: Vec2, target: Vec2, speed: f32) -> Shot {
    let (dx, dy) = (target.x - origin.x, target.y - origin.y);
    let length = dx.hypot(dy).max(1.0);
    Shot {
        position: origin,
        velocity: Vec2::new(dx / length * speed, dy / length * speed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 指定秒数だけ一定の操作でゲームを進める
    ///
    /// # 引数
    ///
    /// * `game` - 進めるゲーム
    /// * `seconds` - 進める秒数
    /// * `input` - 毎フレームの操作
    /// * `install_finished` - インストール完了の状態
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn run(game: &mut Game, seconds: f32, input: Input, install_finished: bool) {
        let frames = (seconds / 0.016).ceil() as usize;
        for _ in 0..frames {
            game.update(0.016, input, install_finished);
        }
    }

    #[test]
    fn boss_appears_only_after_install_finishes() {
        let mut game = Game::new(760.0, 400.0, 7);
        game.player.invulnerable = f32::INFINITY;
        run(&mut game, 20.0, Input::default(), false);
        assert!(game.boss.is_none());
        assert_eq!(game.phase, Phase::Playing);

        run(&mut game, WARNING_SECONDS + 0.1, Input::default(), true);
        assert_eq!(game.phase, Phase::Boss);
        assert!(game.boss.is_some());
    }

    #[test]
    fn defeating_the_boss_clears_the_stage() {
        let mut game = Game::new(760.0, 400.0, 7);
        game.phase = Phase::Boss;
        game.boss = Some(Boss {
            position: Vec2::new(660.0, 200.0),
            health: 2,
            age: BOSS_ENTRY_SECONDS,
            spread_timer: 10.0,
            aimed_timer: 10.0,
        });
        game.damage_boss(2);
        assert_eq!(game.phase, Phase::Cleared);
        assert!(game.boss.is_none());
        assert_eq!(game.score, BOSS_SCORE);
    }

    #[test]
    fn shots_destroy_enemies_and_score() {
        let mut game = Game::new(760.0, 400.0, 7);
        game.enemies.push(Enemy {
            position: Vec2::new(380.0, 100.0),
            base_y: 100.0,
            age: 0.0,
        });
        game.shots.push(Shot {
            position: Vec2::new(375.0, 100.0),
            velocity: Vec2::new(SHOT_SPEED, 0.0),
        });
        game.resolve_hits();
        assert!(game.enemies.is_empty());
        assert_eq!(game.score, ENEMY_SCORE);
    }

    #[test]
    fn keeps_the_player_inside_the_field() {
        let mut game = Game::new(760.0, 400.0, 7);
        let input = Input {
            left: true,
            up: true,
            ..Input::default()
        };
        game.player.invulnerable = f32::INFINITY;
        run(&mut game, 5.0, input, false);
        assert!(game.player.position.x >= 16.0);
        assert!(game.player.position.y >= 12.0);
    }

    #[test]
    fn shots_curve_toward_the_nearest_enemy() {
        let mut game = Game::new(760.0, 400.0, 7);
        game.enemies.push(Enemy {
            position: Vec2::new(500.0, 50.0),
            base_y: 50.0,
            age: 0.0,
        });
        game.shots.push(Shot {
            position: Vec2::new(100.0, 300.0),
            velocity: Vec2::new(SHOT_LAUNCH_SPEED, 0.0),
        });
        game.move_shots(0.1);
        assert!(game.shots[0].velocity.y < 0.0, "上の敵へ曲がっていない");
        assert_eq!(game.lock_target(), Some(Vec2::new(500.0, 50.0)));
    }

    #[test]
    fn enemies_come_from_the_right() {
        let mut game = Game::new(760.0, 400.0, 7);
        game.spawn_wave();
        assert!(game.enemies.iter().all(|enemy| enemy.position.x > 760.0));
        let before = game.enemies[0].position.x;
        game.update_enemies(0.5);
        assert!(game.enemies[0].position.x < before);
    }

    #[test]
    fn losing_all_lives_restarts_the_game() {
        let mut game = Game::new(760.0, 400.0, 7);
        game.player.lives = 1;
        game.player.invulnerable = 0.0;
        game.enemy_shots.push(Shot {
            position: game.player.position,
            velocity: Vec2::default(),
        });
        game.update(0.016, Input::default(), false);
        assert!(matches!(game.phase, Phase::GameOver(_)));

        run(&mut game, GAME_OVER_SECONDS + 0.1, Input::default(), false);
        assert_eq!(game.phase, Phase::Playing);
        assert_eq!(game.player.lives, STARTING_LIVES);
    }
}
