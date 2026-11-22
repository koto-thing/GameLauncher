//! セットアップ画面の状態遷移と、テーマへの受け渡し

use std::{path::PathBuf, sync::Arc, sync::mpsc::TryRecvError};

use eframe::egui::{
    self, FontData, FontDefinitions, FontFamily, Key, Rect, Stroke, Ui, ViewportCommand, pos2, vec2,
};
use pandd_setup::{
    cli::{Mode, ThemeKind},
    ifw::{IfwEvent, Outcome},
    install_dir::{self, DirectoryState},
    progress::Progress,
    shooter::{Game, Input},
};

use crate::{
    session::{self, Job, Plan},
    theme::{self, Action, Screen, Task, View, palette},
};

/// 失敗時に表示する IFW のログの行数
const LOG_TAIL: usize = 12;

/// セットアップ画面のアプリ
pub struct SetupApp {
    mode: Mode,
    task: Task,
    up_to_date: bool,
    theme: ThemeKind,
    screen: Screen,
    screen_seconds: f32,
    seconds: f32,
    root_text: String,
    default_root: String,
    problem: Option<(String, String)>,
    job: Option<Job>,
    progress: Progress,
    log: Vec<String>,
    failure: String,
    game: Option<Game>,
    portraits: theme::navi::Portraits,
}

impl SetupApp {
    /// フォントを登録し、起動引数に合わせた最初の画面を用意する
    ///
    /// # 引数
    ///
    /// * `context` - eframe の生成時の情報
    /// * `mode` - 新規インストール、更新、メンテナンスのどれか
    /// * `theme` - 最初の見た目
    /// * `default_root` - 新規インストールの既定のインストール先
    ///
    /// # 戻り値
    ///
    /// 新規インストールならあいさつ画面、更新なら実行中の画面、
    /// メンテナンスなら更新かアンインストールかを選ぶ画面から始まるアプリ
    pub fn new(
        context: &eframe::CreationContext<'_>,
        mode: Mode,
        theme: ThemeKind,
        default_root: PathBuf,
    ) -> Self {
        install_fonts(&context.egui_ctx);
        let default_root = default_root.display().to_string();

        // メンテナンスは選ぶまで作業が決まらないので、更新を仮に置いて選択画面から始める
        let (task, screen) = match mode {
            Mode::Install => (Task::Install, Screen::Welcome),
            Mode::Update { .. } => (Task::Update, Screen::Welcome),
            Mode::Maintenance { .. } => (Task::Update, Screen::Menu),
        };
        let mut app = Self {
            mode,
            task,
            up_to_date: false,
            theme,
            screen,
            screen_seconds: 0.0,
            seconds: 0.0,
            root_text: default_root.clone(),
            default_root,
            problem: None,
            job: None,
            progress: Progress::default(),
            log: Vec::new(),
            failure: String::new(),
            game: None,
            portraits: theme::navi::Portraits::load(&context.egui_ctx),
        };

        // 更新はランチャー側で確認済みなので、すぐに始める
        if let Mode::Update { root, wait_pid } = app.mode.clone() {
            app.run(Plan::Update { root, wait_pid });
        }
        app
    }

    /// 画面を切り替え、文字送りなどの経過時間を戻す
    ///
    /// # 引数
    ///
    /// * `screen` - 次の画面
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn go(&mut self, screen: Screen) {
        self.screen = screen;
        self.screen_seconds = 0.0;
    }

    /// 実際にインストールするディレクトリを返す
    ///
    /// # 戻り値
    ///
    /// 更新とメンテナンスならそのインストール先、新規なら入力から作った専用ディレクトリ
    fn final_root(&self) -> Option<PathBuf> {
        match &self.mode {
            Mode::Update { root, .. } | Mode::Maintenance { root } => Some(root.clone()),
            Mode::Install => install_dir::final_install_path(&self.root_text),
        }
    }

    /// IFW の実行を始めて実行中の画面へ進む
    ///
    /// # 引数
    ///
    /// * `plan` - 新規インストール、更新、アンインストールのどれか
    ///
    /// # 戻り値
    ///
    /// 戻り値なし。始められなければ失敗の画面へ進む
    fn run(&mut self, plan: Plan) {
        self.up_to_date = false;
        self.progress = Progress::default();
        self.log.clear();
        match session::start(&plan) {
            Ok(job) => {
                self.job = Some(job);
                self.go(Screen::Running);
            }
            Err(error) => self.fail(format!("{error:#}")),
        }
    }

    /// 失敗の画面へ進む
    ///
    /// # 引数
    ///
    /// * `message` - 表示する失敗の内容
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn fail(&mut self, message: String) {
        self.job = None;
        self.failure = message;
        self.go(Screen::Failed);
    }

    /// IFW から届いた出来事を画面の状態に反映する
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn poll_job(&mut self) {
        let Some(job) = &self.job else {
            return;
        };
        let mut finished = None;
        loop {
            match job.events.try_recv() {
                Ok(IfwEvent::Stage(stage)) => self.progress.enter(stage),
                Ok(IfwEvent::Log(line)) => {
                    self.log.push(line);
                    if self.log.len() > LOG_TAIL {
                        self.log.remove(0);
                    }
                }
                Ok(IfwEvent::Exited(outcome)) => {
                    // 更新するものがないのは、更新のときだけ完了として扱う
                    finished = Some(match (outcome, self.task) {
                        (Outcome::Completed, _) => Ok(false),
                        (Outcome::UpToDate, Task::Update) => Ok(true),
                        _ => Err(self.log.join("\n")),
                    });
                    break;
                }
                Ok(IfwEvent::Failed(message)) => {
                    finished = Some(Err(message));
                    break;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    finished = Some(Err("IFW の実行が途中で止まりました".to_owned()));
                    break;
                }
            }
        }

        // 終了したら完了か失敗の画面へ進む
        match finished {
            Some(Ok(up_to_date)) => {
                self.job = None;
                self.up_to_date = up_to_date;
                self.progress.finish();
                self.go(Screen::Finished);
            }
            Some(Err(log)) => {
                let action = match self.task {
                    Task::Install => "インストール",
                    Task::Update => "アップデート",
                    Task::Uninstall => "アンインストール",
                };
                self.fail(format!("{action}が完了しませんでした\n\n{log}"));
            }
            None => {}
        }
    }

    /// 押された操作を処理する
    ///
    /// # 引数
    ///
    /// * `ctx` - ウィンドウを閉じるときに使う
    /// * `action` - 押された操作
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn handle(&mut self, ctx: &egui::Context, action: Action) {
        match action {
            Action::Next => self.go(Screen::Destination),
            // アンインストールの確認からはメンテナンスの選択へ戻る
            Action::Back if self.task == Task::Uninstall => self.go(Screen::Menu),
            Action::Back => self.go(Screen::Welcome),
            Action::UseDefault => self.root_text = self.default_root.clone(),
            Action::Browse => {
                if let Some(folder) = rfd::FileDialog::new()
                    .set_title("インストール先のフォルダを選ぶ")
                    .pick_folder()
                {
                    self.root_text = folder.display().to_string();
                }
            }
            Action::Install => self.try_install(),
            Action::Update => {
                self.task = Task::Update;
                self.start_task();
            }
            Action::ConfirmUninstall => {
                self.task = Task::Uninstall;
                self.go(Screen::Welcome);
            }
            Action::Uninstall | Action::Retry => self.start_task(),
            Action::Launch => {
                let launched = self
                    .final_root()
                    .map(|root| session::launch_launcher(&root));
                match launched {
                    Some(Ok(())) => ctx.send_viewport_cmd(ViewportCommand::Close),
                    Some(Err(error)) => self.fail(format!("{error:#}")),
                    None => {}
                }
            }
            Action::Close => ctx.send_viewport_cmd(ViewportCommand::Close),
        }
    }

    /// 今の作業を対象のディレクトリで始める
    ///
    /// # 戻り値
    ///
    /// 戻り値なし。新規インストールの場所が決まっていなければインストール先の画面へ戻る
    fn start_task(&mut self) {
        let Some(root) = self.final_root() else {
            self.go(Screen::Destination);
            return;
        };
        let plan = match self.task {
            Task::Install => Plan::Install { root },
            Task::Update => Plan::Update {
                root,
                wait_pid: None,
            },
            Task::Uninstall => Plan::Uninstall { root },
        };
        self.run(plan);
    }

    /// インストール先を検証し、使えるならインストールを始める
    ///
    /// # 戻り値
    ///
    /// 戻り値なし。使えない場合は問題を画面に出す
    fn try_install(&mut self) {
        let Some(root) = self.final_root() else {
            self.problem = Some((
                self.root_text.clone(),
                "インストール先のフォルダを入力してください".to_owned(),
            ));
            return;
        };
        let problem = match install_dir::inspect(&root) {
            DirectoryState::Empty => None,
            DirectoryState::NotEmpty => {
                Some("このフォルダは空ではありません。空のフォルダか新しいフォルダを選んでください")
            }
            DirectoryState::NotDirectory => Some("ファイルがある場所は選べません"),
            DirectoryState::Unreadable => Some("このフォルダを読み取れません"),
        };
        match problem {
            Some(problem) => self.problem = Some((self.root_text.clone(), problem.to_owned())),
            None => {
                self.problem = None;
                self.run(Plan::Install { root });
            }
        }
    }

    /// アーケードのシューティングを1フレーム進める
    ///
    /// # 引数
    ///
    /// * `ui` - 入力の読み取りとフィールドの大きさに使う
    /// * `dt` - 経過秒数
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn update_game(&mut self, ui: &Ui, dt: f32) {
        let playing = self.theme == ThemeKind::Arcade
            && matches!(self.screen, Screen::Running | Screen::Finished);
        if !playing {
            return;
        }
        let area = ui.max_rect();
        let game = self.game.get_or_insert_with(|| {
            Game::new(
                area.width(),
                area.height() - theme::arcade::HUD_HEIGHT - theme::arcade::FOOTER_HEIGHT,
                u64::from(std::process::id()) * 2_654_435_761,
            )
        });
        let input = ui.input(|input| Input {
            left: input.key_down(Key::ArrowLeft) || input.key_down(Key::A),
            right: input.key_down(Key::ArrowRight) || input.key_down(Key::D),
            up: input.key_down(Key::ArrowUp) || input.key_down(Key::W),
            down: input.key_down(Key::ArrowDown) || input.key_down(Key::S),
            fire: input.key_down(Key::Z) || input.key_down(Key::Space),
        });
        game.update(dt, input, self.screen == Screen::Finished);
    }
}

impl eframe::App for SetupApp {
    /// 毎フレーム、IFW の状態を取り込み、ゲームを進め、今のテーマで画面を描く
    ///
    /// # 引数
    ///
    /// * `ui` - ウィンドウ全体の描画先
    /// * `_frame` - eframe のフレーム情報
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn ui(&mut self, ui: &mut Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        let dt = ui.input(|input| input.stable_dt).min(0.1);
        self.seconds += dt;
        self.screen_seconds += dt;

        // 実行中は IFW を止めずに済むよう、ウィンドウを閉じさせない
        if ctx.input(|input| input.viewport().close_requested()) && self.screen == Screen::Running {
            ctx.send_viewport_cmd(ViewportCommand::CancelClose);
        }

        self.poll_job();
        self.progress.tick(dt);
        self.update_game(ui, dt);

        // 問題の表示は、入力が変わるまでだけ続ける
        let problem = self
            .problem
            .as_ref()
            .filter(|(text, _)| *text == self.root_text)
            .map(|(_, problem)| problem.clone());
        let final_root = self
            .final_root()
            .map(|root| root.display().to_string())
            .unwrap_or_default();
        let mut view = View {
            task: self.task,
            up_to_date: self.up_to_date,
            screen: self.screen,
            root_text: &mut self.root_text,
            default_root: &self.default_root,
            final_root: &final_root,
            directory_problem: problem.as_deref(),
            progress: &self.progress,
            failure: &self.failure,
            screen_seconds: self.screen_seconds,
            seconds: self.seconds,
            game: self.game.as_ref(),
            portraits: &self.portraits,
        };
        let action = match self.theme {
            ThemeKind::Navi => theme::navi::show(ui, &mut view),
            ThemeKind::Arcade => theme::arcade::show(ui, &mut view),
        };
        let toggled = theme_toggle(ui, self.theme);

        if let Some(action) = action {
            self.handle(&ctx, action);
        }
        if toggled {
            self.theme = self.theme.toggled();
        }
        ctx.request_repaint();
    }
}

/// 右上にテーマの切り替えボタンを描き、押されたかを返す
///
/// # 引数
///
/// * `ui` - 描画先
/// * `current` - 今のテーマ
///
/// # 戻り値
///
/// 押されたら true
fn theme_toggle(ui: &mut Ui, current: ThemeKind) -> bool {
    let area = ui.max_rect();
    let rect = Rect::from_min_size(
        pos2(area.right() - 138.0, area.top() + 8.0),
        vec2(128.0, 24.0),
    );
    let (label, fill, text, border) = match current {
        ThemeKind::Navi => (
            "テーマ ◀▶ ナビ",
            palette::WHITE,
            palette::CHARCOAL,
            palette::CORAL_LIGHT,
        ),
        ThemeKind::Arcade => (
            "テーマ ◀▶ アーケード",
            palette::NIGHT,
            palette::CORAL_LIGHT,
            palette::CHARCOAL_SOFT,
        ),
    };
    let response = theme::hit_area(ui, rect);
    let border = if response.hovered() {
        palette::CORAL
    } else {
        border
    };
    theme::framed(ui, rect, 12, fill, Stroke::new(1.5, border));
    theme::centered_text(ui, rect.center(), label, theme::bold(11.0), text);
    response.clicked()
}

/// 同梱の M PLUS 2 と Press Start 2P を egui に登録する
///
/// # 引数
///
/// * `ctx` - フォントを登録する egui のコンテキスト
///
/// # 戻り値
///
/// 戻り値なし
pub(crate) fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    for (name, bytes) in [
        (
            "mplus-medium",
            include_bytes!("../assets/fonts/MPLUS2-Medium.ttf").as_slice(),
        ),
        (
            "mplus-extrabold",
            include_bytes!("../assets/fonts/MPLUS2-ExtraBold.ttf").as_slice(),
        ),
        (
            "press-start",
            include_bytes!("../assets/fonts/PressStart2P-Regular.ttf").as_slice(),
        ),
    ] {
        fonts
            .font_data
            .insert(name.to_owned(), Arc::new(FontData::from_static(bytes)));
    }

    // 本文は M PLUS 2 を優先し、ドット文字で出せない日本語は太字で補う
    for family in [FontFamily::Proportional, FontFamily::Monospace] {
        fonts
            .families
            .entry(family)
            .or_default()
            .insert(0, "mplus-medium".to_owned());
    }
    fonts.families.insert(
        FontFamily::Name(theme::BOLD.into()),
        vec!["mplus-extrabold".to_owned()],
    );
    fonts.families.insert(
        FontFamily::Name(theme::PIXEL.into()),
        vec!["press-start".to_owned(), "mplus-extrabold".to_owned()],
    );
    ctx.set_fonts(fonts);
}
