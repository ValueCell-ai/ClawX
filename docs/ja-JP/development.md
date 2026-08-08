# ClawX開発ガイド

このドキュメントは、READMEの「開発」セクションの詳細版です。

### 前提条件

- **Node.js**：対応するメジャー系列の22.22.3以上、24.15.0以上、または25.9.0以上（Node 24 LTS推奨）
- **パッケージマネージャー**：pnpm 9以上（npmも対応）
- **Linux（Ubuntu/Debian）**：Electronを実行する前に必要なシステムライブラリをインストールしてください。
  ```bash
  sudo apt-get install -y libnss3 libgtk-3-0 libxss1 libxtst6 libatspi2.0-0 libnotify4 xdg-utils
  ```
  Ubuntu 24.04以降では一部のパッケージに`t64`サフィックスが付きます。上記コマンドを実行すると、`apt`が適切なバリアントを自動選択します。

### プロジェクト構成

```text
ClawX/
├── electron/                 # Electron Mainプロセス
│   ├── services/            # 型付きHost API、プロバイダー、秘密情報、ランタイムサービス
│   │   ├── providers/       # プロバイダー/アカウントのモデル同期ロジック
│   │   └── secrets/         # OSキーチェーンと秘密情報の保存
│   ├── shared/              # 共有プロバイダースキーマ/定数
│   │   └── providers/
│   ├── main/                # アプリ入口、ウィンドウ、IPC登録
│   ├── gateway/             # OpenClaw Gatewayプロセスマネージャー
│   ├── preload/             # セキュアIPCブリッジ
│   └── utils/               # ストレージ、認証、パスのユーティリティ
├── src/                      # React Rendererプロセス
│   ├── lib/                 # フロントエンド統合APIとエラーモデル
│   ├── stores/              # Zustandストア（settings/chat/gateway）
│   ├── components/          # 再利用可能なUIコンポーネント
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # ローカライズリソース
│   └── types/               # TypeScript型定義
├── tests/
│   ├── e2e/                 # Playwright Electron E2Eスモークテスト
│   └── unit/                # Vitestユニット/統合系テスト
├── resources/                # 静的アセット（アイコン、画像）
└── scripts/                  # ビルドとユーティリティのスクリプト
```

### 利用可能なコマンド

```bash
# 開発
pnpm run init             # 依存関係をインストールし、同梱バイナリ（uv、agent-browser）をダウンロード
pnpm dev                  # ホットリロードで起動（不足時は同梱スキルを自動準備）

# 品質
pnpm lint                 # ESLintを実行
pnpm typecheck            # TypeScriptを検証

# テスト
pnpm test                 # ユニットテストを実行
pnpm run test:e2e         # Electron E2Eスモークテストを実行
pnpm run test:e2e:headed  # 表示可能なウィンドウでElectron E2Eテストを実行
pnpm run perf:chat        # 合成Chat Renderer/Main CPUプロファイルを取得
pnpm run profile:main     # Main inspectorを9229番ポートで起動したビルド済みアプリを実行
pnpm run comms:replay     # 通信リプレイ指標を算出
pnpm run comms:baseline   # 通信ベースラインスナップショットを更新
pnpm run comms:compare    # リプレイ指標をベースラインの閾値と比較

# ビルドとパッケージ
pnpm run build:vite       # フロントエンドのみをビルド
pnpm build                # パッケージアセットを含む本番ビルド
pnpm package              # 現在のプラットフォーム向けにパッケージ化（同梱スキルを含む）
pnpm package:mac          # macOS向けにパッケージ化
pnpm package:win          # Windows向けにパッケージ化
pnpm package:linux        # Linux向けにパッケージ化
```

ヘッドレスLinuxではElectronテストに表示サービスが必要です。`xvfb-run -a pnpm run test:e2e`を使用してください。

Electron E2E機能テストはローカルとCIの両方で既定で2つのPlaywright workerを使用します。通常の並列レーンは`CLAWX_E2E_WORKERS=<正の整数>`で調整できます。OS全体の状態に触れるテストは1 workerの`exclusive`プロジェクトを使用し、ホストのパフォーマンスプロファイルはその後単独で実行されます。新しいE2Eテストは既定で並列です。実際のクリップボードなどマシン全体で共有されるリソースを使う場合は、`tests/e2e/parallel-policy.ts`の`E2E_EXCLUSIVE_TAG`を適用してください。

独占前提を必要としない通常のspecだけを実行する場合は、`pnpm exec playwright test <spec> --project=parallel --no-deps`を使用します。

### Electronパフォーマンス診断

`pnpm run perf:chat`は、ストリーミングとリッチな静的Markdownサイドバー/スクロール操作を対象に、分離された合成ACP負荷を実行します。Playwrightの`test-results/`ディレクトリにバージョン付きメトリクスとRenderer/Main CPUプロファイルを書き込みます。Rendererプロファイルは本番のstore/render経路とフレームペーシングを対象とします。ストリーミングMainプロファイルはMainからRendererへのIPC fanoutを測定し、操作用MainプロファイルはRenderer操作中にMainがアイドル状態を保つかを示します。どちらも上流のOpenClaw/ACPサブプロセスやGPUプロセスの経路は含みません。

CPUプロファイルはChrome DevToolsで開けます。アーティファクトには生成されたfixtureテキストだけが含まれ、製品テレメトリーではありません。結果はハードウェアに依存するため、単一のクロスプラットフォーム絶対閾値ではなく、同じマシンで繰り返した結果を比較してください。

実際のRendererを記録するには、`CLAWX_REMOTE_DEBUGGING_PORT=9223 pnpm dev`で開発環境を起動し、PlaywrightまたはChrome DevToolsを`localhost:9223`へ接続します。実際のElectron Mainを記録するには`pnpm run profile:main`を実行し、`chrome://inspect`で`localhost:9229`を設定してElectron Mainターゲットを選びます。WebSocket trace自体を測定する場合を除き、`CLAWX_GATEWAY_WS_TRACE`は設定しないでください。

ClawXは既定でChromiumのハードウェアアクセラレーションを有効にし、長い文書、スクロール、レイアウトアニメーションでGPUコンポジットとラスタライズを利用します。グラフィックスドライバーに問題がある場合のトラブルシューティングには、Chromium標準の`--disable-gpu`コマンドラインスイッチを使用できます。

### 通信回帰チェック

Gatewayイベント、ACP Chat bridgeの送受信フロー、チャネル配信、トランスポートフォールバックなどの通信経路をPRで変更した場合は、次を実行してください。

```bash
pnpm run comms:replay
pnpm run comms:compare
```

CIの`comms-regression`ジョブが必須シナリオと閾値を検証します。

### Electron E2Eテスト

Playwright Electronスイートは`dist/`と`dist-electron/`からパッケージ済みのRendererとMainプロセスを起動するため、事前に`pnpm dev`を手動実行する必要はありません。

`pnpm run test:e2e`は自動的に次を行います。

- `pnpm run build:vite`でRendererとElectronのバンドルをビルド
- 一時的な`HOME`を使ってElectronを分離E2Eモードで起動
- 一時的なClawX `userData`ディレクトリを使用
- OS全体のリソースとパフォーマンステストを隔離しながら、通常のspecファイルを並列実行
- Gateway自動起動、同梱スキルのインストール、トレイ作成、CLI自動インストールなど、重い起動副作用をスキップ

最初のベースラインspecは次を対象とします。

- 新しいプロファイルでの初回起動Setup Wizardの表示
- セットアップをスキップし、Electronアプリ内でModelsページへ移動できること

今後のElectronフローは`tests/e2e/`に追加し、`tests/e2e/fixtures/electron.ts`の共有fixtureを再利用してください。固定の書き込みパス、ポート、ネイティブキーチェーン、その他の外部共有状態を避けてテストを並列安全に保ちます。分離できない場合は`E2E_EXCLUSIVE_TAG`を使用してください。

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| ランタイム | Electron 40+ |
| UIフレームワーク | React 19 + TypeScript |
| スタイリング | Tailwind CSS + shadcn/ui |
| 状態管理 | Zustand |
| ビルド | Vite + electron-builder |
| テスト | Vitest + Playwright |
| アニメーション | Framer Motion |
| アイコン | Lucide React |
