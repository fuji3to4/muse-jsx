# Athena Support for Muse-JSX

このドキュメントでは、muse-jsxに追加されたMuse Athena対応について説明します。

## 概要

Muse Athenaは新型のMuse EEGヘッドセットで、異なるBluetoothプロトコルを使用しています。以前のバージョンのmuse.tsは、古いMuseデバイスのプロトコルにのみ対応していました。

新しいバージョンでは、以下の機能が追加されました：

- **Athenaパケット解析**: タグベースのパケット形式（0x12: EEG、0x47: ACC_GYRO、0x34: OPTICAL、0x98: BATTERY）
- **Athenaコマンド処理**: デバイス初期化とストリーミング制御
- **統合センサーサポート**: 複数のセンサー値を1つのBLE特性から受信
- **後方互換性**: 古いMuseデバイスも引き続きサポート

## アーキテクチャ

### ファイル構成

```
src/lib/
├── athena-parser.ts          # Athenaパケット解析ロジック
├── muse-interfaces.ts        # 型定義（Athena用型を追加）
├── muse-parse.ts            # 古いMuse解析関数
└── muse-utils.ts            # ユーティリティ関数

src/
└── muse.ts                  # メインMuseClientクラス（Athena対応）
```

### Athenaパケット形式

各パケットは**タグバイト**で始まり、その後4バイトスキップし、ペイロードが続きます：

| タグ | 型 | サンプル数 | 周波数 | 説明 |
|-----|-----|---------|------|------|
| 0x12 | EEG | 2 | 256 Hz | 8チャネル、14ビット精度 |
| 0x47 | ACC_GYRO | 3 | 52 Hz | 加速度計＋ジャイロスコープ |
| 0x34 | OPTICAL | 3 | 64 Hz | 光センサー（4値） |
| 0x98 | BATTERY | 1 | 0.1 Hz | 10値のバッテリーデータ |

## 使用方法

### Athenaデバイスへの接続

```typescript
import { MuseClient } from './muse';

const client = new MuseClient();
client.enableAthena = true;  // Athenaモード有効化

await client.connect();
await client.start();

// Athena EEGデータの購読
client.athenaEegReadings.subscribe((reading) => {
    console.log('EEG samples:', reading.samples);
    console.log('Timestamp:', reading.timestamp);
});

// Athena加速度計/ジャイロデータの購読
client.athenaAccGyroReadings.subscribe((reading) => {
    reading.acc.forEach((sample) => {
        console.log(`ACC: x=${sample.x}, y=${sample.y}, z=${sample.z}`);
    });
});

// Athena光センサーデータの購読
client.athenaOpticalReadings.subscribe((reading) => {
    console.log('Optical samples:', reading.samples);
});

// バッテリーデータの購読
client.athenaBatteryData.subscribe((data) => {
    console.log('Battery values:', data.values);
});
```

### 古いMuseデバイスへの接続（後方互換性）

```typescript
const client = new MuseClient();
client.enableAthena = false;  // 古いMuseモード（デフォルト）

await client.connect();
await client.start();

// 従来のEEGデータの購読
client.eegReadings.subscribe((reading) => {
    console.log('EEG data:', reading.samples);
});
```

## Athenaコマンド

以下のコマンドがサポートされています：

```typescript
client.sendCommand('v4');      // バージョン確認
client.sendCommand('s');       // ステータス確認
client.sendCommand('h');       // ハルト（停止）
client.sendCommand('d');       // ストリーミング開始
client.sendCommand('p21');     // プリセット21
client.sendCommand('p1045');   // プリセット1045（推奨）
```

## インターフェース

### AthenaEEGReading

```typescript
interface AthenaEEGReading {
    timestamp: number;      // ミリ秒単位のタイムスタンプ
    samples: number[];      // EEG値（16個）
}
```

### AthenaAccGyroReading

```typescript
interface AthenaAccGyroReading {
    timestamp: number;      // ミリ秒単位のタイムスタンプ
    acc: XYZ[];            // 3サンプルの加速度計
    gyro: XYZ[];           // 3サンプルのジャイロスコープ
}

interface XYZ {
    x: number;
    y: number;
    z: number;
}
```

### AthenaOpticalReading

```typescript
interface AthenaOpticalReading {
    timestamp: number;      // ミリ秒単位のタイムスタンプ
    samples: number[];      // 光センサー値（12個：3サンプル×4値）
}
```

### AthenaBatteryData

```typescript
interface AthenaBatteryData {
    timestamp: number;      // ミリ秒単位のタイムスタンプ
    values: number[];       // バッテリー値（10個）
}
```

## パケット解析

### parsePacket（低レベルAPI）

```typescript
import { parsePacket } from './lib/athena-parser';

const data = new Uint8Array([0x12, /* ... */]);
const [nextIndex, packetType, entries, samples] = parsePacket(data, 0x12, 0);

console.log(`Packet type: ${packetType}`);
entries.forEach((entry) => {
    console.log(`${entry.type}: ${entry.data}`);
});
```

### packetParser（高レベルAPI）

```typescript
import { packetParser } from './lib/athena-parser';

const rawData = new Uint8Array([/* ... */]);
const [counts, parsedPackets] = packetParser(rawData, false, true);

console.log('Packet counts:', counts);
// { EEG: { packets: 5, samples: 10 }, ACC_GYRO: { packets: 3, samples: 9 }, ... }

parsedPackets.forEach((pkt) => {
    console.log(`Tag 0x${pkt.tag.toString(16)}: ${pkt.type} (${pkt.samples} samples)`);
});
```

## 実装詳細

### パケット解析のステップ

1. **タグ検出**: バッファの最初のバイトでパケット型を判定
2. **スキップ**: タグ後の4バイトをスキップ
3. **ペイロード抽出**: 型別のサイズ分のデータを抽出
4. **ビット操作**: 14ビット・20ビット値などを適切に解析
5. **スケーリング**: 生値を物理単位に変換

### ビット操作の詳細

- **EEG（14ビット）**: LSB-first形式で16個の14ビット値を解析、1450/16383でスケーリング
- **ACC/GYRO（12ビット）**: 
  - ACC: 0.0000610352倍でスケーリング（m/s²相当）
  - GYRO: -0.0074768倍でスケーリング（deg/s相当）
- **OPTICAL（20ビット）**: LSB-first形式で20ビット値を解析、32768で正規化
- **BATTERY（16ビット）**: 10個の符号なし16ビット整数

## Python実装との関連

このTypeScript実装は、以下のPythonコードを参考にしています：

- `athena_connection.py`: BLE接続・コマンド処理
- `athena_packet_decoder.py`: パケット解析ロジック
- `athena_main.py`: ストリーミング管理

完全な互換性を保つため、パケット形式とコマンドシーケンスはPython実装と同一です。

## トラブルシューティング

### デバイスが見つからない場合

1. Bluetoothデバイスの電源が入っているか確認
2. デバイスが認可されているか確認
3. `requestDevice()`ダイアログで正しいデバイスを選択

### パケット解析エラー

- バッファサイズが不足している場合、エラーがスローされます
- `try-catch`で囲んで例外処理を実装してください

### データが受信されない場合

1. `start()`メソッドが呼ばれているか確認
2. センサー特性が正しく有効化されているか確認
3. デバイスがストリーミング状態にあるか確認（`sendCommand('d')`）

## ライセンス

このコードはmuse-jsxプロジェクトの一部です。詳細はLICENSEファイルを参照してください。
