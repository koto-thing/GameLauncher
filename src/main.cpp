#include <QApplication>
#include <QDebug>

#include "infrastructure/provider/QtApplicationProvider.h"
#include "view/MainWindow.h"

int main(int argc, char* argv[])
{
    QtApplicationProvider app(argc, argv);

    MainWindow window;

    window.show();

    const int result = app.run();
    return result;
}
