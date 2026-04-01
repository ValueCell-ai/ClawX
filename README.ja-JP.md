
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="ClawX Logo" />
</p>

<h1 align="center">ClawX</h1>

<p align="center">
  <strong>OpenClaw AIエージェントのためのデスクトップインターフェース</strong>
</p>

<p align="center">
  <a href="#機能">機能</a> •
  <a href="#なぜclawxなのか">なぜClawXなのか</a> •
  <a href="#はじめに">はじめに</a> •
  <a href="#アーキテクチャ">アーキテクチャ</a> •
  <a href="#開発">開発</a> •
  <a href="#コントリビューション">コントリビューション</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/ValueCell-ai/ClawX/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | 日本語
</p>

---

## 概要

**ClawX**は、強力なAIエージェントと日常のユーザーとの間のギャップを埋めます。[OpenClaw](https://github.com/OpenClaw)をベースに構築されており、コマンドラインによるAIオーケストレーションを、アクセスしやすく美しいデスクトップ体験に変換します。ターミナルは不要です。

ワークフローの自動化、AI搭載チャネルの管理、インテリジェントなタスクのスケジューリングなど、ClawXはAIエージェントを効果的に活用するために必要なインターフェースを提供します。

ClawXはベストプラクティスのモデルプロバイダーが事前設定されており、Windowsおよび多言語設定をネイティブにサポートしています。もちろん、**設定 → 詳細設定 → 開発者モード**から高度な設定を微調整することもできます。

---
## スクリーンショット

<p align="center">
  <img src="resources/screenshot/jp/chat.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/cron.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/skills.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/channels.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/models.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/settings.png" style="width: 100%; height: auto;">
</p>

---

## なぜClawXなのか

AIエージェントの構築にコマンドラインの習得は不要であるべきです。ClawXはシンプルな哲学のもとに設計されました：**強力な技術には、あなたの時間を尊重するインターフェースがふさわしい。**

| 課題 | ClawXのソリューション |
|------|----------------------|
| 複雑なCLIセットアップ | ワンクリックインストールとガイド付きセットアップウィザード |
| 設定ファイル | リアルタイムバリデーション付きのビジュアル設定 |
| プロセス管理 | ゲートウェイライフサイクルの自動管理 |
| 複数のAIプロバイダー | 統合プロバイダー設定パネル |
| スキル/プラグインのインストール | 組み込みのスキルマーケットプレイスと管理機能 |

### OpenClaw内蔵

ClawXは公式の**OpenClaw**コアを直接ベースに構築されています。別途インストールを必要とせず、アプリケーション内にランタイムを組み込むことで、シームレスな「バッテリー同梱」体験を提供します。

私たちはアップストリームのOpenClawプロジェクトとの厳密な整合性を維持することにコミットしており、公式リリースが提供する最新の機能、安定性の改善、エコシステムの互換性に常にアクセスできることを保証します。

---

## 機能

### 🎯 ゼロ設定バリア
インストールから最初のAIインタラクションまで、すべてのセットアップを直感的なグラフィカルインターフェースで完了できます。ターミナルコマンド不要、YAMLファイル不要、環境変数の探索も不要です。

### 💬 インテリジェントチャットインターフェース
モダンなチャット体験を通じてAIエージェントとコミュニケーションできます。複数の会話コンテキスト、メッセージ履歴、Markdownによるリッチコンテンツレンダリングに加え、マルチエージェント構成ではメイン入力欄の `@agent` から対象エージェントへ直接ルーティングできます。
`@agent` で別のエージェントを選ぶと、ClawX はデフォルトエージェントを経由せず、そのエージェント自身の会話コンテキストへ直接切り替えます。各エージェントのワークスペースは既定で分離されていますが、より強い実行時分離は OpenClaw の sandbox 設定に依存します。
各 Agent は `provider/model` の実行時設定を個別に上書きできます。上書きしていない Agent は引き続きグローバルの既定モデルを継承します。

### 📡 マルチチャネル管理
複数のAIチャネルを同時に設定・監視できます。各チャネルは独立して動作するため、異なるタスクに特化したエージェントを実行できます。
現在は各チャンネルで複数アカウントを扱え、Channels ページでアカウントの Agent 紐付けやデフォルトアカウント切替を直接管理できます。
ClawX には Tencent 公式の個人 WeChat チャンネルプラグインも同梱されており、Channels ページからアプリ内 QR フローで直接 WeChat を連携できます。

### ⏰ Cronベースの自動化
AIタスクを自動的に実行するようスケジュール設定できます。トリガーを定義し、間隔を設定することで、手動介入なしにAIエージェントを24時間稼働させることができます。
定期タスク画面では外部配信を「送信アカウント」と「受信先ターゲット」の 2 段階セレクターで設定できるようになりました。対応チャネルでは、受信先候補をチャネルのディレクトリ機能や既知セッション履歴から自動検出するため、`jobs.json` を手で編集する必要はありません。
既知の制限: WeChat は現在、定期タスク配信の対応チャネルから意図的に除外しています。`openclaw-weixin` プラグインの送信処理が、リアルタイム会話で得られる `contextToken` を必要とするため、cron のような能動配信をプラグイン自体がサポートしていません。

### 🧩 拡張可能なスキルシステム
事前構築されたスキルでAIエージェントを拡張できます。統合スキルパネルからスキルの閲覧、インストール、管理が可能です。パッケージマネージャーは不要です。
ClawX はドキュメント処理スキル（`pdf`、`xlsx`、`docx`、`pptx`）もフル内容で同梱し、起動時に管理スキルディレクトリ（既定 `~/.openclaw/skills`）へ自動配備し、初回インストール時に既定で有効化します。追加の同梱スキル（`find-skills`、`self-improving-agent`、`tavily-search`、`brave-web-search`）も既定で有効化されますが、必要な API キーが未設定の場合は OpenClaw が実行時に設定エラーを表示します。  
Skills ページでは OpenClaw の複数ソース（管理ディレクトリ、workspace、追加スキルディレクトリ）から検出されたスキルを表示でき、各スキルの実際のパスを確認して実フォルダを直接開けます。

主な検索スキルで必要な環境変数:
- `BRAVE_SEARCH_API_KEY`: `brave-web-search` 用
- `TAVILY_API_KEY`: `tavily-search` 用（上流ランタイムで OAuth 対応の場合あり）

### 🔐 セキュアなプロバイダー統合
複数のAIプロバイダー（OpenAI、Anthropicなど）に接続でき、資格情報はシステムのネイティブキーチェーンに安全に保存されます。OpenAI は API キーとブラウザ OAuth（Codex サブスクリプション）の両方に対応しています。
OpenAI-compatible ゲートウェイを **Custom プロバイダー** で使う場合、**設定 → AI Providers → Provider 編集** でカスタム `User-Agent` を設定でき、互換性が必要なエンドポイントで有効です。

### 🌙 アダプティブテーマ
ライトモード、ダークモード、またはシステム同期テーマ。ClawXはあなたの好みに自動的に適応します。

### 🚀 自動起動設定
**設定 → 通用** から **システム起動時に自動起動** を有効化すると、ログイン後に ClawX が自動的に起動します。

---

## はじめに

### システム要件

- **オペレーティングシステム**: macOS 11以上、Windows 10以上、またはLinux（Ubuntu 20.04以上）
- **メモリ**: 最低4GB RAM（8GB推奨）
- **ストレージ**: 1GBの空きディスク容量

### インストール

#### ビルド済みリリース（推奨）

[Releases](https://github.com/ValueCell-ai/ClawX/releases)ページから、お使いのプラットフォーム向けの最新リリースをダウンロードしてください。

#### ソースからビルド

```bash
# リポジトリをクローン
git clone https://github.com/ValueCell-ai/ClawX.git
cd ClawX

# プロジェクトの初期化
pnpm run init

# 開発モードで起動
pnpm dev
```
### 初回起動

ClawXを初めて起動すると、**セットアップウィザード**が以下の手順をガイドします：

1. **言語と地域** – 使用する言語・地域の設定
2. **AIプロバイダー** – APIキーまたは OAuth（ブラウザ/デバイスログイン対応プロバイダー）で追加
3. **スキルバンドル** – 一般的なユースケース向けの事前設定スキルを選択
4. **検証** – メインインターフェースに入る前に設定をテスト

サポート対象のシステム言語がある場合、ウィザードはその言語を初期選択し、未対応の場合は英語にフォールバックします。

### プロキシ設定

ClawXには、Electron、OpenClaw Gateway、またはTelegramなどのチャネルがローカルプロキシクライアントを介してインターネットにアクセスする必要がある環境向けに、組み込みのプロキシ設定が含まれています。

**設定 → ゲートウェイ → プロキシ**を開いて以下を設定します：

- **プロキシサーバー**: すべてのリクエストのデフォルトプロキシ
- **バイパスルール**: 直接接続すべきホスト（セミコロン、カンマ、または改行で区切る）
- **開発者モード**では、オプションで以下をオーバーライドできます：
  - **HTTP プロキシ**
  - **HTTPS プロキシ**
  - **ALL_PROXY / SOCKS**

推奨されるローカル設定例：

```text
プロキシサーバー: http://127.0.0.1:7890
```
注意事項：

- `host:port`のみの値はHTTPとして扱われます。
- 高度なプロキシフィールドが空の場合、ClawXは`プロキシサーバー`にフォールバックします。
- プロキシ設定を保存すると、Electronのネットワーク設定が即座に再適用され、ゲートウェイが自動的に再起動されます。
- ClawXはTelegramが有効な場合、プロキシをOpenClawのTelegramチャネル設定にも同期します。
- ClawXのプロキシが無効な状態では、Gatewayの通常再起動時に既存のTelegramチャネルプロキシ設定を保持します。
- OpenClaw設定のTelegramプロキシを明示的に消したい場合は、プロキシ無効の状態で一度「保存」を実行してください。
- **設定 → 詳細 → 開発者** では **OpenClaw Doctor** を実行でき、`openclaw doctor --json` の診断出力をアプリ内で確認できます。
- Windows のパッケージ版では、同梱された `openclaw` CLI/TUI は端末入力を安定させるため、同梱の `node.exe` エントリーポイント経由で実行されます。

---

## アーキテクチャ

ClawXは、**デュアルプロセス + Host API 統一アクセス**構成を採用しています。Renderer は単一クライアント抽象を呼び出し、プロトコル選択とライフサイクルは Main が管理します：

```┌─────────────────────────────────────────────────────────────────┐
│                        ClawX デスクトップアプリ                    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron メインプロセス                         │  │
│  │  • ウィンドウ＆アプリケーションライフサイクル管理              │  │
│  │  • ゲートウェイプロセスの監視                                │  │
│  │  • システム統合（トレイ、通知、キーチェーン）                 │  │
│  │  • 自動アップデートオーケストレーション                       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC（権威ある制御プレーン）            │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React レンダラープロセス                        │  │
│  │  • モダンなコンポーネントベースUI（React 19）                │  │
│  │  • Zustandによるステート管理                                 │  │
│  │  • 統一 host-api/api-client 呼び出し                          │  │
│  │  • リッチなMarkdownレンダリング                              │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ Main管理のトランスポート戦略
                               │（WS優先、HTTP次点、IPCフォールバック）
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                Host API と Main プロキシ層                       │
│                                                                  │
│  • hostapi:fetch（Mainプロキシ、CORS回避）                       │
│  • gateway:httpProxy（RendererはGateway HTTPに直アクセスしない） │
│  • 統一エラーマッピングとリトライ/バックオフ                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ WS / HTTP / IPC フォールバック
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw ゲートウェイ                         │
│                                                                  │
│  • AIエージェントランタイムとオーケストレーション                  │
│  • メッセージチャネル管理                                         │
│  • スキル/プラグイン実行環境                                      │
│  • プロバイダー抽象化レイヤー                                     │
└─────────────────────────────────────────────────────────────────┘
```
### 設計原則

- **プロセス分離**: AIランタイムは別プロセスで動作し、重い計算処理中でもUIの応答性を確保します
- **フロントエンド呼び出しの単一入口**: Renderer は host-api/api-client を通じて呼び出し、下位プロトコルに依存しません
- **Mainによるトランスポート制御**: WS/HTTP の選択と IPC フォールバックを Main で一元管理します
- **グレースフルリカバリ**: 再接続・タイムアウト・バックオフで一時的障害を自動処理します
- **セキュアストレージ**: APIキーや機密データは、OSのネイティブセキュアストレージ機構を活用します
- **CORSセーフ設計**: ローカルHTTPはMainプロキシ経由とし、Renderer側CORS問題を回避します

### プロセスモデルと Gateway トラブルシューティング

- ClawX は Electron アプリのため、**1つのアプリインスタンスでも複数プロセス（main/renderer/zygote/utility）が表示される**のが正常です。
- 単一起動保護は Electron のロックに加え、ローカルのプロセスロックファイルも併用し、デスクトップ IPC / セッションバスが不安定な環境でも重複起動を防ぎます。
- ローリングアップグレード中に旧版/新版が混在すると、単一起動保護の挙動が非対称になる場合があります。安定運用のため、デスクトップクライアントは可能な限り同一バージョンへ揃えてください。
- ただし OpenClaw Gateway の待受は常に**単一**であるべきです。`127.0.0.1:18789` を Listen しているプロセスは1つだけです。
- Listen プロセスの確認例:
  - macOS/Linux: `lsof -nP -iTCP:18789 -sTCP:LISTEN`
  - Windows (PowerShell): `Get-NetTCPConnection -LocalPort 18789 -State Listen`
- ウィンドウの閉じるボタン（`X`）は既定でトレイへ最小化する動作で、完全終了ではありません。完全終了する場合はトレイメニューの **Quit ClawX** を使用してください。

---

## ユースケース

### 🤖 パーソナルAIアシスタント
質問への回答、メールの下書き、ドキュメントの要約、日常タスクのサポートなど、汎用的なAIエージェントを設定できます。すべてクリーンなデスクトップインターフェースから操作できます。

### 📊 自動モニタリング
ニュースフィード、価格追跡、特定イベントの監視などを行うスケジュールエージェントを設定できます。結果はお好みの通知チャネルに配信されます。

### 💻 開発者の生産性向上
AI を開発ワークフローに統合できます。エージェントを使用して、コードレビュー、ドキュメント生成、反復的なコーディングタスクの自動化が可能です。

### 🔄 ワークフロー自動化
複数のスキルを連鎖させて、高度な自動化パイプラインを作成できます。データの処理、コンテンツの変換、アクションのトリガーを、すべてビジュアルにオーケストレーションできます。

---

## 開発

### 前提条件

- **Node.js**: 22以上（LTS推奨）
- **パッケージマネージャー**: pnpm 9以上（推奨）またはnpm

### プロジェクト構成

```ClawX/
├── electron/                 # Electron メインプロセス
│   ├── api/                 # メイン側 API ルーターとハンドラー
│   │   └── routes/          # RPC/HTTP プロキシのルートモジュール
│   ├── services/            # Provider/Secrets/ランタイムサービス
│   │   ├── providers/       # provider/account モデル同期ロジック
│   │   └── secrets/         # OS キーチェーンと秘密情報管理
│   ├── shared/              # 共通 Provider スキーマ/定数
│   │   └── providers/
│   ├── main/                # アプリ入口、ウィンドウ、IPC 登録
│   ├── gateway/             # OpenClaw ゲートウェイプロセスマネージャー
│   ├── preload/             # セキュア IPC ブリッジ
│   └── utils/               # ユーティリティ（ストレージ、認証、パス）
├── src/                      # React レンダラープロセス
│   ├── lib/                 # フロントエンド統一 API とエラーモデル
│   ├── stores/              # Zustand ストア（settings/chat/gateway）
│   ├── components/          # 再利用可能な UI コンポーネント
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # ローカライズリソース
│   └── types/               # TypeScript 型定義
├── tests/
│   ├── e2e/                 # Playwright による Electron E2E スモークテスト
│   └── unit/                # Vitest ユニット/統合寄りテスト
├── resources/                # 静的アセット（アイコン、画像）
└── scripts/                  # ビルド/ユーティリティスクリプト
```
### 利用可能なコマンド

```bash
# 開発
pnpm run init             # 依存関係のインストール + uvのダウンロード
pnpm dev                  # ホットリロードで起動（不足時は同梱スキルを自動準備）

# コード品質
pnpm lint                 # ESLintを実行
pnpm typecheck            # TypeScriptの型チェック

# テスト
pnpm test                 # ユニットテストを実行
pnpm run test:e2e         # Electron E2E スモークテストを実行
pnpm run test:e2e:headed  # 表示付きウィンドウで Electron E2E を実行
pnpm run comms:replay     # 通信リプレイ指標を算出
pnpm run comms:baseline   # 通信ベースラインを更新
pnpm run comms:compare    # リプレイ指標をベースライン閾値と比較

# ビルド＆パッケージ
pnpm run build:vite       # フロントエンドのみビルド
pnpm build                # フルプロダクションビルド（パッケージアセット含む）
pnpm package              # 現在のプラットフォーム向けにパッケージ化（同梱プリインストールスキルを含む）
pnpm package:mac          # macOS向けにパッケージ化
pnpm package:win          # Windows向けにパッケージ化
pnpm package:linux        # Linux向けにパッケージ化
```

ヘッドレス Linux では Electron テストに表示サーバーが必要です。`xvfb-run -a pnpm run test:e2e` を利用してください。

### 通信回帰チェック

PR が通信経路（Gateway イベント、Chat 送受信フロー、Channel 配信、トランスポートのフォールバック）に触れる場合は、次を実行してください。

```bash
pnpm run comms:replay
pnpm run comms:compare
```

CI の `comms-regression` が必須シナリオと閾値を検証します。
### 技術スタック

| レイヤー | 技術 |
|---------|------|
| ランタイム | Electron 40以上 |
| UIフレームワーク | React 19 + TypeScript |
| スタイリング | Tailwind CSS + shadcn/ui |
| ステート管理 | Zustand |
| ビルド | Vite + electron-builder |
| テスト | Vitest + Playwright |
| アニメーション | Framer Motion |
| アイコン | Lucide React |

---

## コントリビューション

コミュニティからのコントリビューションを歓迎します！バグ修正、新機能、ドキュメントの改善、翻訳など、あらゆる貢献がClawXをより良くするのに役立ちます。

### コントリビューション方法

1. リポジトリを**フォーク**する
2. フィーチャーブランチを**作成**する（`git checkout -b feature/amazing-feature`）
3. 明確なメッセージで変更を**コミット**する
4. ブランチに**プッシュ**する
5. **プルリクエスト**を作成する

### ガイドライン

- 既存のコードスタイルに従う（ESLint + Prettier）
- 新機能にはテストを書く
- 必要に応じてドキュメントを更新する
- コミットはアトミックかつ説明的に保つ

---

## 謝辞

ClawXは優れたオープンソースプロジェクトの上に構築されています：

- [OpenClaw](https://github.com/OpenClaw) – AIエージェントランタイム
- [Electron](https://www.electronjs.org/) – クロスプラットフォームデスクトップフレームワーク
- [React](https://react.dev/) – UIコンポーネントライブラリ
- [shadcn/ui](https://ui.shadcn.com/) – 美しくデザインされたコンポーネント
- [Zustand](https://github.com/pmndrs/zustand) – 軽量ステート管理

---

## コミュニティ

コミュニティに参加して、他のユーザーとつながり、サポートを受け、体験を共有しましょう。

| 企業微信 | Feishuグループ | Discord |
| :---: | :---: | :---: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="WeChat QRコード" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="Feishu QRコード" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord QRコード" /> |

### ClawX パートナープログラム 🚀

ClawX パートナープログラムを開始します。特に、カスタム AI エージェントや自動化ニーズを持つより多くの顧客に ClawX を紹介してくださるパートナーを募集しています。

パートナーの皆さまには、見込みユーザーや案件との接点づくりを担っていただき、ClawX チームは技術サポート、カスタマイズ、統合を全面的に提供します。

AI ツールや自動化に関心のある顧客とお仕事をされている方は、ぜひご一緒できればうれしいです。

詳細は DM いただくか、[public@valuecell.ai](mailto:public@valuecell.ai) までメールでご連絡ください。

---

## スター履歴

<p align="center">
  <img src="https://api.star-history.com/svg?repos=ValueCell-ai/ClawX&type=Date" alt="スター履歴チャート" />
</p>

---

## ライセンス

ClawXは[MITライセンス](LICENSE)の下でリリースされています。本ソフトウェアの使用、変更、配布は自由に行えます。

---

<p align="center">
  <sub>ValueCell Teamが❤️を込めて開発</sub>
</p>
