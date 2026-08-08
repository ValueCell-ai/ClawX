# ClawXのプロキシ設定

このドキュメントは、READMEの「プロキシ設定」セクションの詳細版です。

- `host:port` だけの値はHTTPプロキシとして扱われます。
- 高度なプロキシ項目が空の場合、ClawXは **プロキシサーバー** にフォールバックします。
- プロキシ設定を保存すると、Electronのネットワーク設定が即座に再適用され、Gatewayが自動的に再起動します。
- Telegramが有効な場合、ClawXはプロキシをOpenClawのTelegramチャネル設定にも同期します。
- ClawXのプロキシが無効な状態で通常のGateway再起動が行われても、既存のTelegramチャネルプロキシは保持されます。
- OpenClaw設定からTelegramプロキシを明示的に削除するには、プロキシを無効にしてプロキシ設定を一度保存してください。
- **設定 → 詳細設定 → 開発者**では **OpenClaw Doctor** を実行できます。`openclaw doctor --json` を実行し、診断結果をアプリ内に表示します。
- Windowsのパッケージ版では、同梱の`openclaw` CLI/TUIは同梱の`node.exe`エントリーポイント経由で実行され、ターミナル入力の安定性を保ちます。
