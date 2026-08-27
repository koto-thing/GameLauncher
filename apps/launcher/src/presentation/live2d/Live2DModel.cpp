#include "presentation/live2d/Live2DModel.h"

#include "presentation/live2d/CubismRuntime.h"
#include "presentation/live2d/Live2DModelData.h"

#include <GL/glew.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <utility>

#include <QByteArray>
#include <QCoreApplication>
#include <QImage>
#include <QOpenGLContext>
#include <QPointer>
#include <QRandomGenerator>
#include <QThread>
#include <QVector>

#include <CubismDefaultParameterId.hpp>
#include <CubismFramework.hpp>
#include <CubismModelSettingJson.hpp>
#include <Id/CubismIdManager.hpp>
#include <Math/CubismMatrix44.hpp>
#include <Model/CubismUserModel.hpp>
#include <Motion/CubismMotion.hpp>
#include <Motion/CubismUpdateScheduler.hpp>
#include <Physics/CubismPhysics.hpp>
#include <Rendering/OpenGL/CubismRenderer_OpenGLES2.hpp>
#include <Rendering/OpenGL/CubismShader_OpenGLES2.hpp>
#include <Type/csmMap.hpp>
#include <Type/csmString.hpp>
#include <Type/csmVector.hpp>
#include <Utils/CubismString.hpp>

#include "Motion/CubismBreathUpdater.hpp"
#include "Motion/CubismEyeBlinkUpdater.hpp"
#include "Motion/CubismPhysicsUpdater.hpp"
#include "Motion/CubismPoseUpdater.hpp"

namespace {

namespace Core = Live2D::Cubism::Core;
using namespace Live2D::Cubism::Framework;
using namespace Live2D::Cubism::Framework::DefaultParameterId;
using namespace Live2D::Cubism::Framework::Rendering;

constexpr int kPriorityIdle = 1;

bool isGuiThread() {
    if (const auto* app = QCoreApplication::instance()) {
        return QThread::currentThread() == app->thread();
    }

    return true;
}

bool hasCurrentContext() { return QOpenGLContext::currentContext() != nullptr; }

bool initializeGlew(QString& error) {
    static QPointer<QOpenGLContext> initializedContext;

    QOpenGLContext* currentContext = QOpenGLContext::currentContext();
    if (!currentContext) {
        error = QStringLiteral("Live2DModel requires a current OpenGL context.");
        return false;
    }

    if (initializedContext == currentContext) {
        return true;
    }

    // current contextごとにGLEWを一度だけ初期化する
    glewExperimental = GL_TRUE;
    const GLenum status = glewInit();
    glGetError();
    if (status != GLEW_OK) {
        error = QStringLiteral("GLEW initialization failed: %1")
                    .arg(QString::fromLatin1(
                        reinterpret_cast<const char*>(glewGetErrorString(status))));
        return false;
    }

    initializedContext = currentContext;
    return true;
}

bool diagnosticsContainShaderFailure(const QString& diagnostics) {
    return diagnostics.contains(QStringLiteral("Shader compile log"), Qt::CaseInsensitive) ||
           diagnostics.contains(QStringLiteral("Program link log"), Qt::CaseInsensitive) ||
           diagnostics.contains(QStringLiteral("Validate program log"), Qt::CaseInsensitive) ||
           diagnostics.contains(QStringLiteral("Failed to load vertex shader"),
                                Qt::CaseInsensitive) ||
           diagnostics.contains(QStringLiteral("Failed to load fragment shader"),
                                Qt::CaseInsensitive) ||
           diagnostics.contains(QStringLiteral("Failed to link program"), Qt::CaseInsensitive) ||
           diagnostics.contains(QStringLiteral("File loader is not set"), Qt::CaseInsensitive);
}

bool hasModelParameter(CubismModel& model, const CubismId* id) {
    if (!id) {
        return false;
    }

    const csmInt32 index = model.GetParameterIndex(id);
    return index >= 0 && index < model.GetParameterCount();
}

class CubismSceneModel final : public CubismUserModel {
  public:
    CubismSceneModel()
        : modelSetting_(nullptr), motionUpdated_(false), idleGroupUtf8_(), lastRenderWidth_(0),
          lastRenderHeight_(0) {
        idParamAngleX_ = CubismFramework::GetIdManager()->GetId(ParamAngleX);
        idParamAngleY_ = CubismFramework::GetIdManager()->GetId(ParamAngleY);
        idParamAngleZ_ = CubismFramework::GetIdManager()->GetId(ParamAngleZ);
        idParamBodyAngleX_ = CubismFramework::GetIdManager()->GetId(ParamBodyAngleX);
        idParamBreath_ = CubismFramework::GetIdManager()->GetId(ParamBreath);
    }

    ~CubismSceneModel() override {
        _motionManager->StopAllMotions();
        releaseTextures();
        releaseMotions();
        delete modelSetting_;
        modelSetting_ = nullptr;
    }

    bool load(const pandd::Live2DModelData& data, QString& error) {
        error.clear();
        // 検証済みmodel3.jsonをCubism設定へ変換して関連資源を構築する
        modelSetting_ =
            new CubismModelSettingJson(reinterpret_cast<const csmByte*>(data.modelJson.constData()),
                                       static_cast<csmSizeInt>(data.modelJson.size()));
        modelJsonPath_ = data.modelPath;
        idleGroupUtf8_ = data.idleGroup.toUtf8();
        return setupModel(data, error);
    }

    void updateModel(float seconds) {
        if (!GetModel() || !std::isfinite(seconds)) {
            return;
        }

        const csmFloat32 delta = static_cast<csmFloat32>(std::clamp(seconds, 0.0f, 0.1f));

        // 前frameのparameterを復元してmotionと自動更新を順に適用する
        GetModel()->LoadParameters();

        motionUpdated_ = false;
        if (_motionManager) {
            if (!idleGroupUtf8_.isEmpty() && modelSetting_ &&
                modelSetting_->GetMotionCount(idleGroupUtf8_.constData()) > 0) {
                if (_motionManager->IsFinished()) {
                    motionUpdated_ = startRandomMotion(idleGroupUtf8_.constData(), kPriorityIdle);
                } else {
                    motionUpdated_ = _motionManager->UpdateMotion(GetModel(), delta);
                }
            } else {
                motionUpdated_ = _motionManager->UpdateMotion(GetModel(), delta);
            }
        }

        GetModel()->SaveParameters();
        SetOpacity(GetModel()->GetModelOpacity());
        _updateScheduler.OnLateUpdate(GetModel(), delta);
        GetModel()->Update();
    }

    void drawModel(int pixelWidth, int pixelHeight, float centerX, float centerY, float scale) {
        if (!GetModel()) {
            return;
        }

        if (pixelWidth <= 0 || pixelHeight <= 0) {
            return;
        }

        const auto width = static_cast<csmUint32>(pixelWidth);
        const auto height = static_cast<csmUint32>(pixelHeight);
        auto* renderer = GetRenderer<CubismRenderer_OpenGLES2>();
        if (!renderer) {
            return;
        }

        // target寸法が変わった場合だけCubism側の描画sizeを更新する
        if (lastRenderWidth_ != pixelWidth || lastRenderHeight_ != pixelHeight) {
            SetRenderTargetSize(width, height);
            lastRenderWidth_ = pixelWidth;
            lastRenderHeight_ = pixelHeight;
        }

        const csmFloat32 aspect =
            static_cast<csmFloat32>(pixelWidth) / static_cast<csmFloat32>(pixelHeight);
        const csmFloat32 clampedCenterX = static_cast<csmFloat32>(std::clamp(centerX, 0.0f, 1.0f));
        const csmFloat32 clampedCenterY = static_cast<csmFloat32>(std::clamp(centerY, 0.0f, 1.0f));
        const csmFloat32 fittedScale = static_cast<csmFloat32>(std::clamp(scale, 0.01f, 100.0f));

        // model canvas原点を考慮して正規化済み中心位置へ配置する
        CubismModelMatrix* modelMatrix = GetModelMatrix();
        modelMatrix->LoadIdentity();
        modelMatrix->SetHeight(2.0f * fittedScale);
        Core::csmVector2 canvasSize, canvasOrigin;
        csmFloat32 pixelsPerUnit = 0;
        Core::csmReadCanvasInfo(GetModel()->GetModel(), &canvasSize, &canvasOrigin, &pixelsPerUnit);
        const float canvasCenterX = (canvasSize.X * 0.5f - canvasOrigin.X) / pixelsPerUnit;
        const float canvasCenterY = (canvasSize.Y * 0.5f - canvasOrigin.Y) / pixelsPerUnit;
        modelMatrix->SetPosition(
            (clampedCenterX * 2.0f - 1.0f) * aspect - canvasCenterX * modelMatrix->GetScaleX(),
            1.0f - clampedCenterY * 2.0f - canvasCenterY * modelMatrix->GetScaleY());

        CubismMatrix44 projection;
        projection.LoadIdentity();
        projection.ScaleRelative(1.0f / aspect, 1.0f);
        projection.MultiplyByMatrix(modelMatrix);

        glViewport(0, 0, pixelWidth, pixelHeight);
        renderer->SetMvpMatrix(&projection);
        renderer->DrawModel();
    }

    QString modelPath() const { return modelJsonPath_; }

  private:
    bool setupModel(const pandd::Live2DModelData& data, QString& error) {
        // Cubismの更新抑止中にCPUとGPU資源を一括構築する
        IsUpdating(true);
        IsInitialized(false);

        if (!loadMainModel(data, error)) {
            return false;
        }

        CreateRenderer(1, 1);
        auto* renderer = GetRenderer<CubismRenderer_OpenGLES2>();
        if (!renderer) {
            error = QStringLiteral("Failed to create the Cubism OpenGL renderer.");
            return false;
        }
        renderer->IsPremultipliedAlpha(true);

        if (!loadPhysics(data.physics, error)) {
            return false;
        }
        if (!loadPose(data.pose, error)) {
            return false;
        }

        // model設定に存在する任意effectだけをschedulerへ登録する
        setupEyeBlink();
        setupBreath();
        collectLipSyncIds();

        if (!loadTextures(data.textures, error)) {
            return false;
        }
        if (!preloadIdleGroup(data.motions, error)) {
            return false;
        }

        if (_motionManager) {
            _motionManager->StopAllMotions();
        }

        IsInitialized(true);
        IsUpdating(false);
        return true;
    }

    bool loadMainModel(const pandd::Live2DModelData& data, QString& error) {
        LoadModel(reinterpret_cast<const csmByte*>(data.moc.constData()),
                  static_cast<csmSizeInt>(data.moc.size()), true);
        if (!GetModel() || !GetModelMatrix()) {
            error = QStringLiteral("Failed to create Cubism model: %1").arg(data.modelPath);
            return false;
        }
        if (!(GetModel()->GetCanvasWidth() > 0) || !(GetModel()->GetCanvasHeight() > 0)) {
            error = QStringLiteral("Model canvas must have positive dimensions");
            return false;
        }
        return true;
    }

    bool loadPhysics(const QByteArray& bytes, QString& error) {
        if (bytes.isEmpty()) {
            return true;
        }
        LoadPhysics(reinterpret_cast<const csmByte*>(bytes.constData()),
                    static_cast<csmSizeInt>(bytes.size()));
        if (!_physics) {
            error = QStringLiteral("Invalid physics data");
            return false;
        }
        _updateScheduler.AddUpdatableList(CSM_NEW CubismPhysicsUpdater(*_physics));
        return true;
    }

    bool loadPose(const QByteArray& bytes, QString& error) {
        if (bytes.isEmpty()) {
            return true;
        }
        LoadPose(reinterpret_cast<const csmByte*>(bytes.constData()),
                 static_cast<csmSizeInt>(bytes.size()));
        if (!_pose) {
            error = QStringLiteral("Invalid pose data");
            return false;
        }
        _updateScheduler.AddUpdatableList(CSM_NEW CubismPoseUpdater(*_pose));
        return true;
    }

    void setupEyeBlink() {
        if (!modelSetting_ || modelSetting_->GetEyeBlinkParameterCount() <= 0) {
            return;
        }

        _eyeBlink = CubismEyeBlink::Create(modelSetting_);
        if (!_eyeBlink) {
            return;
        }

        for (csmInt32 i = 0; i < modelSetting_->GetEyeBlinkParameterCount(); ++i) {
            eyeBlinkIds_.PushBack(modelSetting_->GetEyeBlinkParameterId(i));
        }

        _updateScheduler.AddUpdatableList(
            CSM_NEW CubismEyeBlinkUpdater(motionUpdated_, *_eyeBlink));
    }

    void setupBreath() {
        csmVector<CubismBreath::BreathParameterData> parameters;

        // modelに実在する標準parameterだけを呼吸effectへ追加する
        auto maybeAdd = [&](const CubismId* id, csmFloat32 offset, csmFloat32 peak,
                            csmFloat32 cycle, csmFloat32 weight) {
            if (hasModelParameter(*GetModel(), id)) {
                parameters.PushBack(
                    CubismBreath::BreathParameterData(id, offset, peak, cycle, weight));
            }
        };

        maybeAdd(idParamAngleX_, 0.0f, 15.0f, 6.5345f, 0.5f);
        maybeAdd(idParamAngleY_, 0.0f, 8.0f, 3.5345f, 0.5f);
        maybeAdd(idParamAngleZ_, 0.0f, 10.0f, 5.5345f, 0.5f);
        maybeAdd(idParamBodyAngleX_, 0.0f, 4.0f, 15.5345f, 0.5f);
        maybeAdd(idParamBreath_, 0.5f, 0.5f, 3.2345f, 0.5f);

        if (parameters.GetSize() == 0) {
            return;
        }

        _breath = CubismBreath::Create();
        _breath->SetParameters(parameters);
        _updateScheduler.AddUpdatableList(CSM_NEW CubismBreathUpdater(*_breath));
    }

    void collectLipSyncIds() {
        if (!modelSetting_) {
            return;
        }

        for (csmInt32 i = 0; i < modelSetting_->GetLipSyncParameterCount(); ++i) {
            lipSyncIds_.PushBack(modelSetting_->GetLipSyncParameterId(i));
        }
    }

    bool loadTextures(const QList<QImage>& images, QString& error) {
        auto* renderer = GetRenderer<CubismRenderer_OpenGLES2>();
        textures_.resize(images.size());
        GLint glMaxTextureSize = 0;
        glGetIntegerv(GL_MAX_TEXTURE_SIZE, &glMaxTextureSize);
        // GPU上限を確認してpremultiplied RGBA textureを順に構築する
        for (qsizetype i = 0; i < images.size(); ++i) {
            const auto& image = images[i];
            if (image.isNull() || image.width() > glMaxTextureSize ||
                image.height() > glMaxTextureSize) {
                error = QStringLiteral("Texture exceeds the GPU texture size limit");
                return false;
            }
            GLuint textureId = 0;
            glGenTextures(1, &textureId);
            if (textureId == 0) {
                error = QStringLiteral("OpenGL failed to allocate a texture");
                return false;
            }

            glBindTexture(GL_TEXTURE_2D, textureId);
            glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, image.width(), image.height(), 0, GL_RGBA,
                         GL_UNSIGNED_BYTE, image.constBits());
            glGenerateMipmap(GL_TEXTURE_2D);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glBindTexture(GL_TEXTURE_2D, 0);

            renderer->BindTexture(static_cast<csmUint32>(i), textureId);
            textures_[i] = textureId;
        }

        return true;
    }

    bool preloadIdleGroup(const QList<QByteArray>& motions, QString& error) {
        // 検証済みidle motionを安定したgroupとindexのkeyで保持する
        for (csmInt32 i = 0; i < motions.size(); ++i) {
            const auto& motionBytes = motions[i];
            CubismMotion* motion = static_cast<CubismMotion*>(
                LoadMotion(reinterpret_cast<const csmByte*>(motionBytes.constData()),
                           static_cast<csmSizeInt>(motionBytes.size()), nullptr, nullptr, nullptr,
                           modelSetting_, idleGroupUtf8_.constData(), i, true));
            if (!motion) {
                error = QStringLiteral("Failed to preload idle motion %1.").arg(i);
                return false;
            }

            motion->SetEffectIds(eyeBlinkIds_, lipSyncIds_);
            csmString key =
                Utils::CubismString::GetFormatedString("%s_%d", idleGroupUtf8_.constData(), i);
            motions_[key] = motion;
        }

        return true;
    }

    bool startRandomMotion(const csmChar* group, csmInt32 priority) {
        if (!modelSetting_ || !group) {
            return false;
        }

        const csmInt32 motionCount = modelSetting_->GetMotionCount(group);
        if (motionCount <= 0) {
            return false;
        }

        // 登録済みgroupから均等に一件選んで予約済みpriorityで開始する
        const csmInt32 index =
            static_cast<csmInt32>(QRandomGenerator::global()->bounded(motionCount));
        return startMotion(group, index, priority);
    }

    bool startMotion(const csmChar* group, csmInt32 index, csmInt32 priority) {
        if (!modelSetting_ || !_motionManager || !group || index < 0) {
            return false;
        }

        if (!_motionManager->ReserveMotion(priority)) {
            return false;
        }
        const csmString key = Utils::CubismString::GetFormatedString("%s_%d", group, index);
        auto* motion = motions_[key];
        if (!motion) {
            return false;
        }
        _motionManager->StartMotionPriority(motion, false, priority);
        return true;
    }

    void releaseMotions() {
        for (auto it = motions_.Begin(); it != motions_.End(); ++it) {
            ACubismMotion::Delete(it->Second);
        }
        motions_.Clear();
    }

    void releaseTextures() {
        if (!hasCurrentContext()) {
            const bool hasAnyTexture = std::any_of(textures_.cbegin(), textures_.cend(),
                                                   [](GLuint id) { return id != 0; });
            if (hasAnyTexture) {
                qWarning() << "Live2DModel destroyed without a current OpenGL context; leaking "
                              "model textures";
            }
            return;
        }

        // 作成済みtextureだけをcurrent contextから解放する
        for (GLuint& textureId : textures_) {
            if (textureId != 0) {
                glDeleteTextures(1, &textureId);
                textureId = 0;
            }
        }
    }

    QString modelJsonPath_;
    ICubismModelSetting* modelSetting_;
    csmMap<csmString, ACubismMotion*> motions_;
    csmVector<CubismIdHandle> eyeBlinkIds_;
    csmVector<CubismIdHandle> lipSyncIds_;
    QVector<GLuint> textures_;
    bool motionUpdated_;
    QByteArray idleGroupUtf8_;
    int lastRenderWidth_;
    int lastRenderHeight_;
    const CubismId* idParamAngleX_;
    const CubismId* idParamAngleY_;
    const CubismId* idParamAngleZ_;
    const CubismId* idParamBodyAngleX_;
    const CubismId* idParamBreath_;
};

} // namespace

namespace pandd {

class Live2DModel::Impl {
  public:
    std::shared_ptr<CubismRuntime> runtime;
    std::unique_ptr<CubismSceneModel> model;
};

Live2DModel::Live2DModel() : impl_(std::make_unique<Impl>()) {}

Live2DModel::~Live2DModel() = default;

bool Live2DModel::load(const Live2DModelData& data, QString& error) {
    error.clear();

    if (!isGuiThread()) {
        error = QStringLiteral("Live2DModel::load() must run on the GUI thread.");
        return false;
    }

    if (!hasCurrentContext()) {
        error = QStringLiteral("Live2DModel::load() requires a current OpenGL context.");
        return false;
    }

    // process共有runtimeとcurrent context用GLEWを順に準備する
    if (!impl_->runtime) {
        impl_->runtime = CubismRuntime::acquire(error);
        if (!impl_->runtime) {
            return false;
        }
    }
    static_cast<void>(impl_->runtime->takeDiagnostics());

    if (!initializeGlew(error)) {
        return false;
    }

    // 既存モデルを維持したまま次モデルを完全に構築する
    auto nextModel = std::make_unique<CubismSceneModel>();
    if (!nextModel->load(data, error)) {
        return false;
    }

    if (!CubismShader_OpenGLES2::GetInstance()) {
        error = QStringLiteral("Failed to initialize Cubism OpenGL shaders.");
        return false;
    }

    // Cubismがlogだけへ出したshader失敗も読込失敗として扱う
    const QString diagnostics = impl_->runtime->takeDiagnostics();
    if (diagnosticsContainShaderFailure(diagnostics)) {
        error = diagnostics.trimmed();
        return false;
    }

    impl_->model = std::move(nextModel);
    return true;
}

void Live2DModel::update(float seconds) {
    if (!impl_->model) {
        return;
    }

    Q_ASSERT(isGuiThread());
    impl_->model->updateModel(seconds);
}

void Live2DModel::draw(int pixelWidth, int pixelHeight, float centerX, float centerY, float scale) {
    if (!impl_->model) {
        return;
    }

    Q_ASSERT(isGuiThread());
    Q_ASSERT(hasCurrentContext());
    if (!hasCurrentContext()) {
        qWarning() << "Live2DModel::draw() requires a current OpenGL context";
        return;
    }

    impl_->model->drawModel(pixelWidth, pixelHeight, centerX, centerY, scale);
}

bool Live2DModel::isLoaded() const noexcept { return impl_->model != nullptr; }

QString Live2DModel::loadedModelPath() const {
    return impl_->model ? impl_->model->modelPath() : QString();
}

} // namespace pandd
