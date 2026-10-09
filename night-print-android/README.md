# NIGHT PRINT Android — 岡ちゃん仕様（開発中）

基本理念：**簡単・確実**。元のYour One Slicerを残したまま、別アプリとして試せる構成。

## 実装したソース（ビルド・実機未検証）

- ベース：[`taylormadearmy/u1-slicer-for-android`](https://github.com/taylormadearmy/u1-slicer-for-android) の公開ソース（AGPL-3.0）
- 既存アプリと衝突しない別パッケージ `com.u1.slicer.orca.nightprint`
- Android Deep Link `nightprint://apply?profile=...` を受信
- `nightprint/v1` JSONのホワイトリスト検証
- ダイアログに変更予定を表示 → **承認した場合のみ** ネイティブアプリの `SlicingOverrides` に反映
- 反映する項目：レイヤー高さ、壁数、充填率、上下面層数、充填パターン
- 印刷送信・自動印刷は **しない**（誤操作防止）

プリンターの接続設定、材料温度、サポート、モデルの幾何寸法は現時点では変更しません。G-codeの自動再検査、再スライス、STL形状補正、A1 mini実機検証も未完成です。

## 受信する例

```json
{
  "schema": "nightprint/v1",
  "name": "岡ちゃん 強度優先",
  "layer_height": 0.20,
  "wall_loops": 5,
  "sparse_infill_density": 40,
  "top_shell_layers": 5,
  "bottom_shell_layers": 5,
  "sparse_infill_pattern": "gyroid"
}
```

リンク作成：`nightprint://apply?profile=` + `encodeURIComponent(JSON.stringify(preset))`。
リンクを **改造版アプリで開く** と確認画面が表示され、キャンセル可能。

## APKのビルドと検証

GitHubの **Actions → Build NIGHT PRINT for Android → Run workflow** で手動ビルド。
ワークフローは上流ソースをクローンし `apply_overlay.py` で最小限の改変、ユニットテスト、`assembleDebug` を実行し、成功した場合のみデバッグAPKを成果物として保存します。

**現時点ではビルド成功を確認しておらず、APKは提供していません。**
安全のためスマホに導入するのはビルド検証と実機動作確認のあとにしてください。
Androidの別パッケージとして入るため、Bambu接続やアプリ設定は元アプリから引き継がれません。

## ライセンス

上流アプリは AGPL-3.0。本プロジェクトのAndroid向け派生コードもAGPL-3.0に従って公開し、改変元とライセンス表示を残します。
