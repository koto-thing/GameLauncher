#include "LauncherWindow.h"
#include "GameListFactory.h"
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QFile>
#include <QGridLayout>
#include <QFrame>
#include <QDebug>

LauncherWindow::LauncherWindow(AppContainer* container, QWidget *parent) 
    : QWidget(parent) {
    
    m_runner = container->getGameRunner();
    ISettingsRepository* settings = container->getSettingsRepository();
    
    // UIをセットアップしてからデータを渡す
    setupUI();
    
    if (m_optionOverlay && settings) {
        m_optionOverlay->setDependencies(
            settings,
            container->getCheckLauncherUpdateUseCase(),
            container->getApplyLauncherUpdateUseCase()
        );
    }
    
    if (m_gameDetailsView && m_runner) {
        m_gameDetailsView->setGameRunner(m_runner);
        m_runner->setGamePath("C:/Windows/System32/notepad.exe");
    }
}

void LauncherWindow::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        if (event->position().y() <= TITLE_BAR_HEIGHT) {
            m_dragPosition = event->globalPosition().toPoint() - frameGeometry().topLeft();
            m_isDragging = true;
            event->accept();
        }
    }
}

void LauncherWindow::mouseMoveEvent(QMouseEvent *event) {
    if ((event->buttons() & Qt::LeftButton) && m_isDragging) {
        move(event->globalPosition().toPoint() - m_dragPosition);
        event->accept();
    }
}

void LauncherWindow::mouseReleaseEvent(QMouseEvent *event) {
    m_isDragging = false;
    QWidget::mouseReleaseEvent(event);
}

void LauncherWindow::paintEvent(QPaintEvent *event) {
    Q_UNUSED(event);
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);

    QPainterPath path;
    path.addRoundedRect(rect(), 20, 20);
    painter.setClipPath(path);

    const QPixmap background(":/images/launcher_background_placeholder.png");
    painter.drawPixmap(rect(), background);
}

void LauncherWindow::resizeEvent(QResizeEvent *event) {
    QWidget::resizeEvent(event);
    if (m_optionOverlay) {
        m_optionOverlay->resize(this->size());
    }
}

void LauncherWindow::loadStyleSheet(QWidget *widget, const QString& filePath) {
    if (QFile file(filePath); file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        widget->setStyleSheet(file.readAll());
        file.close();
    }
}

void LauncherWindow::setupUI() {
    loadStyleSheet(this, ":/styles/mainWindow.qss");

    setWindowTitle("Game Launcher");
    setWindowFlags(Qt::FramelessWindowHint);
    setAttribute(Qt::WA_TranslucentBackground);
    resize(1280, 720);

    mainLayout = new QHBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);
    mainLayout->setSpacing(0);

    QWidget *leftContainer = new QWidget(this);
    leftContainer->setMaximumWidth(150);
    leftContainer->setStyleSheet(
        "QWidget {"
        "    background-color: rgba(0, 0, 0, 200);"
        "    border-top-left-radius: 20px;"
        "    border-bottom-left-radius: 20px;"
        "}"
    );

    QVBoxLayout *leftContainerLayout = new QVBoxLayout(leftContainer);
    leftContainerLayout->setContentsMargins(0, 0, 0, 0);
    leftContainerLayout->setSpacing(0);

    addGameButton = new QPushButton("+", leftContainer);
    addGameButton->setFixedSize(50, 50);
    connect(addGameButton, &QPushButton::clicked, this, &LauncherWindow::showGameStore);

    QHBoxLayout *addButtonLayout = new QHBoxLayout;
    addButtonLayout->setContentsMargins(10, 15, 10, 15);
    addButtonLayout->addWidget(addGameButton, 0, Qt::AlignCenter);
    leftContainerLayout->addLayout(addButtonLayout);

    QFrame *separatorLine = new QFrame(leftContainer);
    separatorLine->setFrameShape(QFrame::HLine);
    separatorLine->setFixedHeight(2);
    separatorLine->setStyleSheet("background-color: rgba(255, 255, 255, 50); border: none; margin: 0px 10px;");
    leftContainerLayout->addWidget(separatorLine);

    gameListWidget = new QListWidget(leftContainer);
    gameListWidget->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    gameListWidget->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    gameListWidget->setFocusPolicy(Qt::NoFocus);
    gameListWidget->setStyleSheet("QListWidget { background-color: transparent; border: none; }");

    GameListFactory::addGameItemWithWidget(gameListWidget, "ゲーム1", ":/images/placeholder_100x100.png");
    GameListFactory::addGameItemWithWidget(gameListWidget, "ゲーム2", ":/images/placeholder_100x100.png");
    GameListFactory::addGameItemWithWidget(gameListWidget, "ゲーム3", ":/images/placeholder_100x100.png");

    connect(gameListWidget, &QListWidget::itemClicked, this, &LauncherWindow::showGameDetails);
    leftContainerLayout->addWidget(gameListWidget);

    mainLayout->addWidget(leftContainer);

    rightLayout = new QVBoxLayout();
    rightLayout->setContentsMargins(0, 0, 0, 0);
    rightLayout->setSpacing(0);

    contentStack = new QStackedWidget(this);
    m_gameDetailsView = new GameDetailsWidget(this);
    contentStack->addWidget(m_gameDetailsView);

    m_gameStoreView = new GameStoreWidget(this);
    contentStack->addWidget(m_gameStoreView);

    rightLayout->addWidget(contentStack);
    mainLayout->addLayout(rightLayout);

    m_closeButton = new QPushButton("x", this);
    m_closeButton->setGeometry(width() - 40, 10, 30, 30);
    connect(m_closeButton, &QPushButton::clicked, this, &QWidget::close);

    m_minimizeButton = new QPushButton("-", this);
    m_minimizeButton->setGeometry(width() - 80, 10, 30, 30);
    connect(m_minimizeButton, &QPushButton::clicked, this, &QWidget::showMinimized);

    m_optionButton = new QPushButton("⚙", this);
    m_optionButton->setGeometry(width() - 120, 10, 30, 30);

    m_optionOverlay = new OptionOverlay(this);
    connect(m_optionButton, &QPushButton::clicked, this, [this]() {
        m_optionOverlay->raise();
        m_optionOverlay->resize(this->size());
        m_optionOverlay->show();
    });
}

void LauncherWindow::showGameDetails() {
    contentStack->setCurrentWidget(m_gameDetailsView);
}

void LauncherWindow::showGameStore() {
    contentStack->setCurrentWidget(m_gameStoreView);
}
