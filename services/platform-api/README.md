# Platform API

PandDアカウント、商品販売、所有権、コミュニティを提供する一般利用者向けAPI。

最初は`identity`、`catalog`、`commerce`、`entitlements`、`community`、`moderation`、
`notifications`を1つのデプロイ単位に置くモジュラーモノリスとする。各モジュールは自身の
テーブルだけを更新し、他モジュールとは公開インターフェースまたはイベントで連携する。
