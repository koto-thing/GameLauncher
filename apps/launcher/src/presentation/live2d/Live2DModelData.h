#pragma once

#include "presentation/live2d/Live2DAssetCatalog.h"

#include <QByteArray>
#include <QImage>
#include <QList>

#include <atomic>

namespace pandd {
/** @brief 素材workerからOpenGL threadへ渡すCPU専用データ */
struct Live2DModelData {
    QString modelPath;
    QString idleGroup;
    QByteArray modelJson;
    QByteArray moc;
    QByteArray physics;
    QByteArray pose;
    QList<QByteArray> motions;
    QList<QImage> textures;
    QString error;
};

/** @brief CubismとOpenGLへ触れず上限付きlocal素材を読み込み復号する */
Live2DModelData prepareLive2DModel(const Live2DAsset& asset, const std::atomic_bool& canceled);
} // namespace pandd
