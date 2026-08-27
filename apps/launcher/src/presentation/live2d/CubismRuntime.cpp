#include "presentation/live2d/CubismRuntime.h"

#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <new>
#include <string>

#include <QByteArray>
#include <QCoreApplication>
#include <QFile>
#include <QOpenGLContext>
#include <QThread>

#include <CubismFramework.hpp>
#include <Rendering/CubismRenderer.hpp>

#ifdef _MSC_VER
#include <malloc.h>
#endif

namespace {

using namespace Live2D::Cubism::Framework;

constexpr qint64 kMaxFrameworkShaderBytes = qint64{256} * 1024;
constexpr int kMaxDiagnosticsChars = 16 * 1024;
constexpr const char* kFrameworkShaderPrefix = "FrameworkShaders/";
constexpr const char* kFrameworkShaderResourcePrefix = ":/live2d/FrameworkShaders/";

std::mutex diagnosticsMutex;
QString diagnosticsBuffer;

bool isGuiThread() {
    if (const auto* app = QCoreApplication::instance()) {
        return QThread::currentThread() == app->thread();
    }

    return true;
}

QString normalizeFrameworkPath(const std::string& filePath) {
    // Framework既定shader pathを検証済みApplication Resourceへ置換する
    const QString path = QString::fromUtf8(filePath);
    if (path.startsWith(QLatin1String(kFrameworkShaderPrefix))) {
        return QLatin1String(kFrameworkShaderResourcePrefix) +
               path.mid(QStringLiteral("FrameworkShaders/").size());
    }

    return path;
}

csmByte* loadFrameworkFileBytes(const std::string filePath, csmSizeInt* outSize) {
    if (!outSize) {
        return nullptr;
    }

    // 解決済みshaderを固定上限内で一括読込する
    const QString resolvedPath = normalizeFrameworkPath(filePath);
    QFile file(resolvedPath);
    if (!file.open(QIODevice::ReadOnly)) {
        qWarning().noquote() << "CubismRuntime failed to open shader file:" << resolvedPath
                             << file.errorString();
        return nullptr;
    }

    const qint64 size = file.size();
    if (size < 0 || size > kMaxFrameworkShaderBytes) {
        qWarning().noquote() << "CubismRuntime rejected shader file size:" << resolvedPath << size;
        return nullptr;
    }

    QByteArray bytes = file.readAll();
    if (bytes.size() != size) {
        qWarning().noquote() << "CubismRuntime failed to read shader file:" << resolvedPath;
        return nullptr;
    }

    // Cubism Frameworkの解放callbackへ渡せる所有bufferを確保する
    auto* buffer = new (std::nothrow) csmByte[static_cast<size_t>(bytes.size())];
    if (!buffer) {
        qWarning() << "CubismRuntime failed to allocate shader buffer";
        return nullptr;
    }

    std::memcpy(buffer, bytes.constData(), static_cast<size_t>(bytes.size()));
    *outSize = static_cast<csmSizeInt>(bytes.size());
    return buffer;
}

void releaseFrameworkBytes(csmByte* byteData) { delete[] byteData; }

void cubismLog(const char* message) {
    const QString text = QString::fromUtf8(message ? message : "");
    // 診断bufferを固定長へ保ちながら複数callbackから保護する
    {
        std::lock_guard lock(diagnosticsMutex);
        if (!diagnosticsBuffer.isEmpty()) {
            diagnosticsBuffer.append(QLatin1Char('\n'));
        }
        diagnosticsBuffer.append(text);
        if (diagnosticsBuffer.size() > kMaxDiagnosticsChars) {
            diagnosticsBuffer = diagnosticsBuffer.right(kMaxDiagnosticsChars);
        }
    }
    qInfo().noquote() << "[Cubism]" << text;
}

class CubismAllocator final : public ICubismAllocator {
  public:
    void* Allocate(const csmSizeType size) override { return ::operator new(size, std::nothrow); }

    void Deallocate(void* memory) override { ::operator delete(memory); }

    void* AllocateAligned(const csmSizeType size, const csmUint32 alignment) override {
#ifdef _MSC_VER
        return _aligned_malloc(size, alignment);
#else
        const std::size_t alignedSize = (size + alignment - 1) / alignment * alignment;
        return std::aligned_alloc(alignment, alignedSize);
#endif
    }

    void DeallocateAligned(void* alignedMemory) override {
#ifdef _MSC_VER
        _aligned_free(alignedMemory);
#else
        std::free(alignedMemory);
#endif
    }
};

} // namespace

namespace pandd {

class CubismRuntime::Impl {
  public:
    CubismAllocator allocator;
    CubismFramework::Option option;
    bool initialized = false;
};

CubismRuntime::CubismRuntime() : impl_(std::make_unique<Impl>()) {
    // 全file accessとlog出力をランチャー管理callbackへ固定する
    impl_->option.LogFunction = cubismLog;
    impl_->option.LoadFileFunction = loadFrameworkFileBytes;
    impl_->option.ReleaseBytesFunction = releaseFrameworkBytes;
    impl_->option.LoggingLevel = CubismFramework::Option::LogLevel_Warning;
}

CubismRuntime::~CubismRuntime() {
    if (!impl_ || !impl_->initialized) {
        return;
    }

    if (!isGuiThread()) {
        qWarning() << "CubismRuntime destroyed off the GUI thread";
    }

    // OpenGL共有資源はcurrent contextがある場合だけ明示解放する
    if (QOpenGLContext::currentContext()) {
        Live2D::Cubism::Framework::Rendering::CubismRenderer::StaticRelease();
    } else {
        qWarning() << "CubismRuntime destroyed without a current OpenGL context; static Cubism GL "
                      "resources may leak";
    }

    CubismFramework::Dispose();
    CubismFramework::CleanUp();
}

bool CubismRuntime::initialize(QString& error) {
    error.clear();

    // 前回instanceの診断を新しい初期化へ持ち越さない
    {
        std::lock_guard lock(diagnosticsMutex);
        diagnosticsBuffer.clear();
    }

    if (!isGuiThread()) {
        error = QStringLiteral("Cubism runtime must be created on the GUI thread.");
        return false;
    }

    // 検証済みAllocatorとcallback構成でFrameworkを起動する
    if (!CubismFramework::StartUp(&impl_->allocator, &impl_->option)) {
        error = QStringLiteral("CubismFramework::StartUp() failed.");
        return false;
    }

    CubismFramework::Initialize();
    impl_->initialized = true;
    return true;
}

std::shared_ptr<CubismRuntime> CubismRuntime::acquire(QString& error) {
    static std::mutex mutex;
    static std::weak_ptr<CubismRuntime> sharedRuntime;

    // process内で初期化済みruntimeを弱参照から再利用する
    std::lock_guard lock(mutex);
    if (auto runtime = sharedRuntime.lock()) {
        error.clear();
        return runtime;
    }

    auto runtime = std::shared_ptr<CubismRuntime>(new CubismRuntime());
    if (!runtime->initialize(error)) {
        return {};
    }

    sharedRuntime = runtime;
    return runtime;
}

bool CubismRuntime::isInitialized() const noexcept { return impl_ && impl_->initialized; }

QString CubismRuntime::takeDiagnostics() {
    std::lock_guard lock(diagnosticsMutex);
    QString text = diagnosticsBuffer;
    diagnosticsBuffer.clear();
    return text;
}

} // namespace pandd
