# Admin Web HTTP API

以下は実装済みRouteだけを掲載したOpenAPI 3.1リファレンスです。Cookie session、GitHub bearer token、GitHub Actions OIDC、same-origin条件と、Artifact上限を仕様へ含めています。

APIは運営環境専用です。ブラウザーやCIへ必要以上の資格情報を渡さず、presigned URLをログ・文書へ保存しないでください。

<a href="./admin/index.html" class="VPButton medium brand">Redoc APIリファレンスを開く</a>

OpenAPIの原本は `packages/contracts/openapi/admin-api.openapi.yaml` です。Docs build時にRedocの自己完結型HTMLへ変換し、GitHub Pages成果物へ配置します。
