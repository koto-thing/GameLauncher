#include "presentation/GameDetailPage.h"
#include "presentation/vrm/VrmBackgroundWidget.h"

#include <QApplication>
#include <QLabel>
#include <QPushButton>
#include <QQuickWindow>
#include <QResource>
#include <QTimer>
#include <QVBoxLayout>
#include <QtTest>

/** @brief 外部テストRCCのVRMを描画して読込結果を返す */
int main(int argc, char* argv[]) {
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    QApplication application(argc, argv);
    if (application.arguments().size() != 2 ||
        !QResource::registerResource(application.arguments().at(1)))
        return 2;

    // テスト用RCCは /vrm/test.vrm にモデルを格納する
    pandd::GameDetailPage page;
    page.resize(960, 720);
    auto* layout = new QVBoxLayout(page.contentWidget());
    layout->addStretch();
    auto* label = new QLabel("VRM background preview", page.contentWidget());
    label->setStyleSheet("color:white;font-size:28px");
    layout->addWidget(label);
    auto* button = new QPushButton("Play", page.contentWidget());
    layout->addWidget(button);
    auto* widget = page.findChild<pandd::VrmBackgroundWidget*>();
    QObject::connect(&page, &pandd::GameDetailPage::backgroundError, &application,
                     [&application](const QString& error) {
                         qCritical().noquote() << error;
                         application.exit(1);
                     });
    QObject::connect(widget, &pandd::VrmBackgroundWidget::modelReady, &application, [&] {
        qInfo() << "VRM model rendered";
        QTimer::singleShot(1000, &application, [&] {
            if (!page.grab().save("vrm-preview.png") ||
                page.childAt(button->mapTo(&page, button->rect().center())) != button) {
                application.exit(4);
                return;
            }

            // ゲーム実行中の画像が静止し再開後に変化することを検証する
            page.setGameRunning(true);
            QTest::qWait(250);
            const auto paused = page.grab().toImage();
            QTest::qWait(300);
            if (paused != page.grab().toImage()) {
                qCritical() << "VRM animation did not pause";
                application.exit(5);
                return;
            }
            page.setGameRunning(false);
            QTest::qWait(500);
            if (paused == page.grab().toImage()) {
                qCritical() << "VRM animation did not resume";
                application.exit(6);
                return;
            }

            // 同じモデルの再選択と非表示・再表示後も操作領域を保つ
            page.setModel(std::nullopt, pandd::VrmAsset{QStringLiteral(":/vrm/test.vrm")});
            page.hide();
            QTest::qWait(100);
            page.show();
            QTest::qWait(100);
            page.setModel(std::nullopt, std::nullopt);
            qInfo() << "PASS: composition, foreground input, pause/resume, hide/show, release";
            QTimer::singleShot(250, &application, &QApplication::quit);
        });
    });
    page.setModel(std::nullopt, pandd::VrmAsset{QStringLiteral(":/vrm/test.vrm")});
    page.show();
    QTimer::singleShot(40000, &application, [&application] { application.exit(3); });
    return application.exec();
}
