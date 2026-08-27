#include "presentation/GameDetailPage.h"
#include "presentation/Live2DBackgroundWidget.h"

#include <QApplication>
#include <QCommandLineParser>
#include <QFileInfo>
#include <QLabel>
#include <QPushButton>
#include <QTimer>
#include <QVBoxLayout>
#include <QtTest>

#include <memory>

/** @brief 開発者指定モデルを本番素材へ登録せず描画する */
int main(int argc, char* argv[]) {
    QApplication application(argc, argv);
    QCommandLineParser parser;
    parser.setApplicationDescription("Live2D background visual verification (development only)");
    parser.addHelpOption();
    parser.addOption({"model", "Absolute path to an authorized model3.json", "path"});
    parser.addOption({"screenshot", "Save the composed detail page to a PNG", "path"});
    parser.addOption({"verify", "Verify visible pixels and animation lifecycle, then exit"});
    parser.process(application);
    const auto modelFile = QFileInfo(parser.value("model"));
    if (!parser.isSet("model") || !modelFile.isFile()) {
        qCritical() << "--model must name an existing authorized model3.json";
        return 2;
    }
    pandd::GameDetailPage page;
    page.setWindowTitle("Live2D background verification");
    page.resize(1090, 720);
    auto* layout = new QVBoxLayout(page.contentWidget());
    layout->setContentsMargins(46, 30, 46, 34);
    auto* back = new QPushButton("Back", page.contentWidget());
    layout->addWidget(back, 0, Qt::AlignLeft);
    layout->addStretch();
    auto* title = new QLabel("Live2D background preview", page.contentWidget());
    title->setStyleSheet("color:white;font-size:32px;font-weight:bold");
    layout->addWidget(title);
    auto* play = new QPushButton("Pause / resume background", page.contentWidget());
    layout->addWidget(play, 0, Qt::AlignRight);
    auto* background = page.findChild<pandd::Live2DBackgroundWidget*>();
    QObject::connect(play, &QPushButton::clicked, &page,
                     [background] { background->setGameRunning(background->animationRunning()); });
    QObject::connect(back, &QPushButton::clicked, &page, &QWidget::close);
    QObject::connect(&page, &pandd::GameDetailPage::backgroundError, &application,
                     [&application](const QString& error) {
                         qCritical().noquote() << error;
                         application.exit(3);
                     });
    const pandd::Live2DAsset asset{modelFile.absoluteFilePath(), "Idle", 0.65F, 0.5F, 1.0F};
    auto baseline = std::make_shared<QImage>();
    auto loadCount = std::make_shared<int>(0);
    page.show();
    QTimer::singleShot(250, &page, [&page, background, baseline, asset] {
        *baseline = background->grabFramebuffer();
        // worker完了前に選択を置換する経路を検証する
        page.setModel(asset);
        page.setModel(std::nullopt);
        page.setModel(asset);
    });
    QObject::connect(
        background, &pandd::Live2DBackgroundWidget::modelReady, &page,
        [&page, &application, &parser, background, baseline, asset, play, loadCount] {
            if (++*loadCount == 2 && parser.isSet("verify")) {
                qInfo() << "PASS: animated pixels, overlay, pause/resume, minimize, hide/show, "
                           "resize, same selection, release/reload, stale load discarded";
                application.exit(0);
                return;
            }
            QTimer::singleShot(
                1500, &page, [&page, &application, &parser, background, baseline, asset, play] {
                    const auto rendered = background->grabFramebuffer();
                    if (rendered.isNull() || baseline->isNull() || rendered == *baseline ||
                        !background->animationRunning()) {
                        qCritical() << "Model did not produce visible animated pixels";
                        application.exit(4);
                        return;
                    }
                    if (parser.isSet("screenshot") &&
                        !page.grab().save(parser.value("screenshot"))) {
                        qCritical() << "Cannot save screenshot";
                        application.exit(5);
                        return;
                    }
                    if (!parser.isSet("verify")) {
                        return;
                    }
                    QTest::qWait(250);
                    if (rendered == background->grabFramebuffer()) {
                        qCritical() << "Idle motion did not change pixels";
                        application.exit(12);
                        return;
                    }
                    if (page.childAt(play->mapTo(&page, play->rect().center())) != play) {
                        qCritical() << "Background obscures the foreground button";
                        application.exit(14);
                        return;
                    }
                    QTest::mouseClick(play, Qt::LeftButton);
                    if (background->animationRunning()) {
                        application.exit(6);
                        return;
                    }
                    QTest::mouseClick(play, Qt::LeftButton);
                    page.showMinimized();
                    QTest::qWait(100);
                    if (background->animationRunning()) {
                        application.exit(13);
                        return;
                    }
                    page.showNormal();
                    QTest::qWait(100);
                    page.hide();
                    if (background->animationRunning()) {
                        application.exit(7);
                        return;
                    }
                    page.show();
                    QTimer::singleShot(100, &page, [&page, &application, background, asset] {
                        if (!background->animationRunning()) {
                            application.exit(8);
                            return;
                        }
                        // 同じ素材の再選択では読込済みinstanceを維持する
                        page.setModel(asset);
                        if (!background->modelLoaded()) {
                            application.exit(9);
                            return;
                        }
                        page.setModel(std::nullopt);
                        if (background->modelLoaded() || background->animationRunning()) {
                            application.exit(10);
                            return;
                        }
                        page.resize(960, 600);
                        QTest::qWait(100);
                        const auto frame = background->grabFramebuffer();
                        if (frame.size() != background->size() * background->devicePixelRatioF()) {
                            application.exit(15);
                            return;
                        }
                        page.resize(1280, 720);
                        page.setModel(asset);
                    });
                });
        });
    if (parser.isSet("verify")) {
        QTimer::singleShot(30000, &application, [&application] {
            qCritical() << "Timed out waiting for rendered model";
            application.exit(11);
        });
    }
    return application.exec();
}
