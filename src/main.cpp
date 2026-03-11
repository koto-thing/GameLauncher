#include <QApplication>
#include "presentation/di/AppContainer.h"
#include "presentation/views/LauncherWindow.h"

int main(int argc, char* argv[])
{
    QApplication app(argc, argv);

    AppContainer container;
    container.getSettingsRepository()->loadSettings();

    LauncherWindow window(&container);
    window.show();

    int result = QApplication::exec();

    container.getSettingsRepository()->saveSettings();

    return result;
}
