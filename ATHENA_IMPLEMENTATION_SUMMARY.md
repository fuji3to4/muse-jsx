# Muse Athena対応 実装サマリー

## 追加・変更ファイル

### 1. `src/lib/athena-parser.ts` （新規作成）
- Athenaプロトコルのパケット解析エンジン
- 5つのパケットタイプをサポート：
  - `0x12`: EEG（8ch, 2サンプル, 256Hz）
  - `0x47`: ACC_GYRO（3サンプル, 52Hz）
  - `0x34`: OPTICAL（3サンプル, 64Hz）
  - `0x98`: BATTERY（10値, 0.1Hz）
- ビット操作による14ビット・20ビット値の抽出
- `parsePacket()`: 低レベルパケット解析
- `packetParser()`: 高レベルバルク処理

### 2. `src/lib/muse-interfaces.ts` （修正）
新しいインターフェース追加：
- `AthenaEEGReading`: EEGデータ
- `AthenaAccGyroReading`: 加速度計+ジャイロデータ
- `AthenaOpticalReading`: 光センサーデータ
- `AthenaBatteryData`: バッテリーデータ

### 3. `src/muse.ts` （大幅修正）
- `enableAthena` フラグでモード選択
- 2つの接続モード：
  - `connectAthena()`: Athena用初期化
  - `connectClassicMuse()`: 従来型用初期化
- Athena専用ストリーム：
  - `athenaEegReadings`
  - `athenaAccGyroReadings`
  - `athenaOpticalReadings`
  - `athenaBatteryData`
- Athenaコマンド実装（`ATHENA_COMMANDS`）
- パケット個別解析メソッド：
  - `parseAthenaEegPacket()`
  - `parseAthenaAccGyroPacket()`
  - `parseAthenaOpticalPacket()`
  - `parseAthenaBatteryPacket()`

### 4. `ATHENA_SUPPORT.md` （新規作成）
完全なドキュメント：
- 概要、アーキテクチャ
- 使用方法（接続、購読、コマンド）
- インターフェース定義
- パケット形式の詳細
- 実装詳細とトラブルシューティング

## 主な機能

✅ **Athenaプロトコル完全対応**
- Python実装（`athena_packet_decoder.py`）と互換
- タグベースのパケット形式
- 複雑なビット操作を完全実装

✅ **RxJSストリーム統合**
- 従来のMuseクライアントと同じAPI
- `Observable<T>`で各データ型をサポート
- `filter`、`map`などのRxJS演算子で処理可能

✅ **後方互換性**
- `enableAthena = false`で従来型Museに対応
- 既存コード変更なし

✅ **ユーザーフレンドリーなAPI**
```typescript
client.enableAthena = true;
await client.connect();
client.athenaEegReadings.subscribe(reading => {
    // EEG処理
});
```

## 使用例

```typescript
import { MuseClient } from './muse';

const client = new MuseClient();
client.enableAthena = true;

await client.connect();
await client.start();

// EEG
client.athenaEegReadings.subscribe(reading => {
    console.log(`EEG: ${reading.samples.join(',')}`);
});

// IMU
client.athenaAccGyroReadings.subscribe(reading => {
    console.log(`ACC: ${reading.acc}`);
    console.log(`GYRO: ${reading.gyro}`);
});

// 光
client.athenaOpticalReadings.subscribe(reading => {
    console.log(`OPTICAL: ${reading.samples}`);
});

// バッテリー
client.athenaBatteryData.subscribe(data => {
    console.log(`BATTERY: ${data.values}`);
});
```

## 技術的ハイライト

- **ビット操作**: LSB-first形式で14ビット・20ビット値を正確に抽出
- **スケーリング**: 物理単位への変換（mV、m/s²、deg/sなど）
- **エラーハンドリング**: バッファオーバーフロー防止
- **パケット連続性**: 未知のタグはスキップして継続処理

---

このアップデートにより、muse-jsxはMuse Athenaの新型ヘッドセットに完全対応しました！
