#include <iostream>
#include <string>

int main(int argc, char* argv[]) {
    if (argc > 1 && std::string(argv[1]) == "--checkupdates") {
        std::cout << R"(<?xml version="1.0" encoding="UTF-8"?>
<updates>
    <update name="Launcher" version="1.2.3" size="1048576" description="Test Release Notes"/>
</updates>)" << std::endl;
        return 0; // Success (Updates found)
    }
    return 1; // No updates
}
