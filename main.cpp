#include <QApplication>
#include <QVBoxLayout>
#include <QLabel>
#include <QPushButton>

#include "LauncherWindow.h"

int main(int argc, char* argv[])
{
    QApplication app(argc, argv);

    LauncherWindow window;
    window.show();

    return QApplication::exec();
}
