// 必要なモジュールをインポート
const { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
// discord.js: Discordボットを作成するためのメインライブラリ
// Client: Discordクライアントを作成するためのクラス
// GatewayIntentBits: ボットが受け取るイベントを指定するためのフラグ
// Events: Discordイベントの種類を指定するための列挙型
// EmbedBuilder: リッチな埋め込みメッセージを作成するためのクラス
// REST, Routes: Discord APIとの通信に使用
// SlashCommandBuilder: スラッシュコマンドを定義するためのクラス

const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
// @discordjs/voice: Discordのボイスチャンネル機能を使用するためのライブラリ
// joinVoiceChannel: ボイスチャンネルに参加するための関数
// createAudioPlayer: 音声を再生するためのプレイヤーを作成する関数
// createAudioResource: 再生する音声リソースを作成する関数
// getVoiceConnection: 現在のボイス接続を取得する関数

const axios = require('axios');
// axios: HTTP通信を行うためのライブラリ（VOICEVOXのAPIを呼び出すのに使用）

const { Readable } = require('stream');
// stream.Readable: Node.jsのストリームを扱うためのクラス（音声データのストリーミングに使用）

const fs = require('fs');
// fs: ファイルシステムを操作するためのNode.jsの組み込みモジュール

// 設定ファイルを読み込む
let config;
try {
  // config.jsonファイルを同期的に読み込み、JSONとしてパース
  config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (error) {
  // ファイルの読み込みに失敗した場合はエラーを表示して終了
  console.error('設定ファイルの読み込みに失敗しました:', error);
  process.exit(1);
}

// Discord クライアントを初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,            // サーバー関連の情報を受け取る
    GatewayIntentBits.GuildVoiceStates,  // ボイスチャンネルの状態変更を受け取る
    GatewayIntentBits.GuildMessages,     // サーバー内のメッセージを受け取る
    GatewayIntentBits.MessageContent,    // メッセージの内容を受け取る
  ],
});

// グローバル変数の初期化
let isReading = false;  // 読み上げ中かどうかのフラグ
let userSettings = {};  // ユーザー設定を保存するオブジェクト
let dictionary = {};    // 辞書データを保存するオブジェクト
let autoJoin = true;    // 自動参加機能のフラグ
let currentAudioPlayer = null;  // 現在再生中のオーディオプレイヤー

// ユーザー設定ファイルを読み込む
try {
  userSettings = JSON.parse(fs.readFileSync('userSettings.json', 'utf8'));
} catch (error) {
  console.log('ユーザー設定ファイルが見つかりません。新規作成します。');
  // ファイルが存在しない場合は、空のオブジェクトのままになる
}

// 辞書ファイルを読み込む
try {
  dictionary = JSON.parse(fs.readFileSync('dictionary.json', 'utf8'));
} catch (error) {
  console.log('辞書ファイルが見つかりません。新規作成します。');
  // ファイルが存在しない場合は、空のオブジェクトのままになる
}

// ユーザー設定をファイルに保存する関数
function saveUserSettings() {
  fs.writeFileSync('userSettings.json', JSON.stringify(userSettings, null, 2));
  // JSON.stringify(obj, null, 2)でインデント付きの整形されたJSONを生成
}

// 辞書をファイルに保存する関数
function saveDictionary() {
  fs.writeFileSync('dictionary.json', JSON.stringify(dictionary, null, 2));
}

// スラッシュコマンドの定義
const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('ボイスチャンネルに参加し、読み上げを開始します'),
  new SlashCommandBuilder()
    .setName('bye')
    .setDescription('ボイスチャンネルから退出し、読み上げを終了します'),
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('話者を変更または一覧を表示します')
    .addIntegerOption(option => 
      option.setName('id')
        .setDescription('話者ID（省略すると一覧を表示）')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('speed')
    .setDescription('読み上げ速度を変更します')
    .addNumberOption(option =>
      option.setName('value')
        .setDescription('速度（例: 1.5）')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('dict')
    .setDescription('辞書を操作します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('辞書に単語を追加します')
        .addStringOption(option => option.setName('key').setDescription('キー').setRequired(true))
        .addStringOption(option => option.setName('value').setDescription('値').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('辞書から単語を削除します')
        .addStringOption(option => option.setName('key').setDescription('キー').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('辞書の内容を表示します')),
  new SlashCommandBuilder()
    .setName('autojoin')
    .setDescription('自動参加機能のオン/オフを切り替えます'),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('現在読み上げているメッセージをスキップします'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('ヘルプメッセージを表示します')
];

// スラッシュコマンドを登録する非同期関数
async function registerCommands() {
  try {
    console.log('スラッシュコマンドを登録中...');
    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
    // Discord APIのバージョン10を使用し、ボットトークンを設定

    await rest.put(
      Routes.applicationCommands(config.CLIENT_ID),
      { body: commands },
    );
    // 定義したコマンドをDiscord APIに送信して登録

    console.log('スラッシュコマンドが正常に登録されました');
  } catch (error) {
    console.error('スラッシュコマンドの登録中にエラーが発生しました:', error);
  }
}

// ボットが準備完了したときのイベントハンドラ
client.once(Events.ClientReady, () => {
  console.log('ボットが起動しました');
  registerCommands();  // スラッシュコマンドを登録
});

// VOICEVOXを使用して音声を生成する非同期関数
async function generateVoice(text, speakerId, speed) {
  // 辞書に登録された単語を置換
  for (const [key, value] of Object.entries(dictionary)) {
    text = text.replace(new RegExp(key, 'g'), value);
  }

  try {
    // VOICEVOXのAudio Query APIを呼び出し
    const query = await axios.post(`${config.VOICEVOX_API_URL}/audio_query`, null, {
      params: { text, speaker: speakerId },
    });

    // 生成された音声クエリに速度を設定
    query.data.speedScale = speed;

    // VOICEVOXのSynthesis APIを呼び出し
    const synthesis = await axios.post(`${config.VOICEVOX_API_URL}/synthesis`, query.data, {
      params: { speaker: speakerId },
      responseType: 'arraybuffer',
    });

    return synthesis.data;  // 生成された音声データを返す
  } catch (error) {
    console.error('音声生成エラー:', error);
    return null;
  }
}

// 音声を再生する非同期関数
async function playAudio(connection, audioData) {
  if (!audioData) return;

  // 音声データをストリームに変換
  const audioStream = Readable.from(audioData);
  // 音声リソースを作成
  const resource = createAudioResource(audioStream);
  // オーディオプレイヤーを作成
  const player = createAudioPlayer();
  // リソースをプレイヤーにセットして再生開始
  player.play(resource);
  // ボイス接続にプレイヤーを接続
  connection.subscribe(player);

  // 現在のオーディオプレイヤーを記録
  currentAudioPlayer = player;

  // 再生が終了するまで待機
  return new Promise((resolve) => {
    player.on('stateChange', (oldState, newState) => {
      if (newState.status === 'idle') {
        // 再生が終了したらcurrentAudioPlayerをリセットし、Promiseを解決
        currentAudioPlayer = null;
        resolve();
      }
    });
  });
}

// VOICEVOXの話者リストを取得する非同期関数
async function getSpeakerList() {
  try {
    const response = await axios.get(`${config.VOICEVOX_API_URL}/speakers`);
    return response.data;
  } catch (error) {
    console.error('話者リストの取得に失敗しました:', error);
    return [];
  }
}

// 話者リストを表示する非同期関数
async function displaySpeakerList(interaction) {
  const speakers = await getSpeakerList();
  const embed = new EmbedBuilder()
    .setTitle('利用可能な話者一覧')
    .setColor('#0099ff');

  let currentField = '';
  let fieldCount = 0;

  // 各話者とそのスタイルをリストに追加
  speakers.forEach(speaker => {
    let speakerInfo = `**${speaker.name}**\n`;
    speaker.styles.forEach(style => {
      const styleInfo = `${style.name}: ID ${style.id}\n`;
      // フィールドの文字数制限（1024文字）を超えないようにチェック
      if (currentField.length + speakerInfo.length + styleInfo.length > 1024) {
        embed.addFields({ name: `話者リスト (${++fieldCount})`, value: currentField });
        currentField = '';
      }
      speakerInfo += styleInfo;
    });
    
    // 同様に、全体のフィールド数制限（25フィールド）を超えないようにチェック
    if (currentField.length + speakerInfo.length > 1024) {
      embed.addFields({ name: `話者リスト (${++fieldCount})`, value: currentField });
      currentField = speakerInfo;
    } else {
      currentField += speakerInfo;
    }
  });

  // 最後の話者情報があればフィールドに追加
  if (currentField) {
    embed.addFields({ name: `話者リスト (${++fieldCount})`, value: currentField });
  }

  // 話者リストを埋め込みメッセージとして送信
  await interaction.reply({ embeds: [embed] });
}

// スラッシュコマンドの処理
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  switch (commandName) {
    case 'join':
      await handleJoinCommand(interaction);
      break;
    case 'bye':
      await handleByeCommand(interaction);
      break;
    case 'voice':
      await handleVoiceCommand(interaction);
      break;
    case 'speed':
      await handleSpeedCommand(interaction);
      break;
    case 'dict':
      await handleDictCommand(interaction);
      break;
    case 'autojoin':
      await handleAutoJoinCommand(interaction);
      break;
    case 'skip':
      await handleSkipCommand(interaction);
      break;
    case 'help':
      await handleHelpCommand(interaction);
      break;
  }
});

// joinコマンドの処理
async function handleJoinCommand(interaction) {
  // ユーザーがボイスチャンネルに接続しているか確認
  if (!interaction.member.voice.channel) {
    await interaction.reply('ボイスチャンネルに接続してから使用してください。');
    return;
  }

  // 既に接続済みかどうかを確認
  const connection = getVoiceConnection(interaction.guildId);
  if (!connection) {
    // 新しいボイス接続を作成
    const newConnection = joinVoiceChannel({
      channelId: interaction.member.voice.channelId,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });
    isReading = true;
   const connection = getVoiceConnection(interaction.guildId);
  if (!connection) {
    const newConnection = joinVoiceChannel({
      channelId: interaction.member.voice.channelId,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });
    isReading = true;
    await interaction.reply('ボイスチャンネルに参加しました。読み上げを開始します。');
    // ユーザー設定を取得（存在しない場合はデフォルト値を使用）
    const userSetting = userSettings[interaction.user.id] || { speakerId: config.DEFAULT_SPEAKER_ID, speed: config.DEFAULT_SPEED };
    // 参加メッセージを生成して再生
    const audioData = await generateVoice('読み上げを開始します', userSetting.speakerId, userSetting.speed);
    await playAudio(newConnection, audioData);
  } else {
    await interaction.reply('既にボイスチャンネルに接続しています。');
  }
}

// byeコマンドの処理
async function handleByeCommand(interaction) {
  const connection = getVoiceConnection(interaction.guildId);
  if (connection) {
    isReading = false;
    // ユーザー設定を取得（存在しない場合はデフォルト値を使用）
    const userSetting = userSettings[interaction.user.id] || { speakerId: config.DEFAULT_SPEAKER_ID, speed: config.DEFAULT_SPEED };
    // 退出メッセージを生成して再生
    const audioData = await generateVoice('読み上げを終了します', userSetting.speakerId, userSetting.speed);
    await playAudio(connection, audioData);
    // ボイスチャンネルから切断
    connection.destroy();
    await interaction.reply('ボイスチャンネルから退出しました');
  } else {
    await interaction.reply('ボイスチャンネルに接続していません');
  }
}

// voiceコマンドの処理
async function handleVoiceCommand(interaction) {
  const speakerId = interaction.options.getInteger('id');
  if (speakerId === null) {
    // 話者IDが指定されていない場合は話者リストを表示
    await displaySpeakerList(interaction);
  } else {
    // 指定された話者IDをユーザー設定に保存
    userSettings[interaction.user.id] = userSettings[interaction.user.id] || {};
    userSettings[interaction.user.id].speakerId = speakerId;
    saveUserSettings();
    await interaction.reply(`あなたの話者を${speakerId}に変更しました`);
  }
}

// speedコマンドの処理
async function handleSpeedCommand(interaction) {
  const speed = interaction.options.getNumber('value');
  if (speed <= 0) {
    await interaction.reply('有効な速度を指定してください（0より大きい数値）');
  } else {
    // 指定された速度をユーザー設定に保存
    userSettings[interaction.user.id] = userSettings[interaction.user.id] || {};
    userSettings[interaction.user.id].speed = speed;
    saveUserSettings();
    await interaction.reply(`あなたの読み上げ速度を${speed}に変更しました`);
  }
}

// dictコマンドの処理
async function handleDictCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'add':
      const key = interaction.options.getString('key');
      const value = interaction.options.getString('value');
      dictionary[key] = value;
      saveDictionary();
      await interaction.reply(`辞書に "${key}" => "${value}" を追加しました`);
      break;
    case 'remove':
      const removeKey = interaction.options.getString('key');
      if (dictionary[removeKey]) {
        delete dictionary[removeKey];
        saveDictionary();
        await interaction.reply(`辞書から "${removeKey}" を削除しました`);
      } else {
        await interaction.reply(`"${removeKey}" は辞書に存在しません`);
      }
      break;
    case 'list':
      const dictList = Object.entries(dictionary).map(([k, v]) => `${k} => ${v}`).join('\n');
      await interaction.reply(`辞書の内容:\n${dictList}`);
      break;
  }
}

// autojoinコマンドの処理
async function handleAutoJoinCommand(interaction) {
  autoJoin = !autoJoin;
  await interaction.reply(`自動参加機能を${autoJoin ? 'オン' : 'オフ'}にしました。`);
}

// skipコマンドの処理
async function handleSkipCommand(interaction) {
  if (currentAudioPlayer) {
    currentAudioPlayer.stop();
    await interaction.reply('現在の読み上げをスキップしました。');
  } else {
    await interaction.reply('現在読み上げている音声はありません。');
  }
}

// helpコマンドの処理
async function handleHelpCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('VOICEVOX読み上げボットのコマンド一覧')
    .setColor('#00ff00')
    .addFields(
      { name: '/join', value: 'ボイスチャンネルに参加し、読み上げを開始します' },
      { name: '/bye', value: 'ボイスチャンネルから退出し、読み上げを終了します' },
      { name: '/voice', value: '利用可能な話者の一覧を表示します' },
      { name: '/voice [id]', value: '指定した話者IDに変更します' },
      { name: '/speed <value>', value: '読み上げ速度を変更します' },
      { name: '/dict add <key> <value>', value: '辞書に単語を追加します' },
      { name: '/dict remove <key>', value: '辞書から単語を削除します' },
      { name: '/dict list', value: '辞書の内容を表示します' },
      { name: '/autojoin', value: '自動参加機能のオン/オフを切り替えます' },
      { name: '/skip', value: '現在読み上げているメッセージをスキップします' },
      { name: '/help', value: 'このヘルプメッセージを表示します' }
    );

  await interaction.reply({ embeds: [embed] });
}

// メッセージ受信時の処理
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return; // ボットからのメッセージは無視

  const connection = getVoiceConnection(message.guildId);
  if (connection && isReading) {
    // ボイスチャンネルに接続中で読み上げモードの場合
    const userSetting = userSettings[message.author.id] || { speakerId: config.DEFAULT_SPEAKER_ID, speed: config.DEFAULT_SPEED };
    const audioData = await generateVoice(message.content, userSetting.speakerId, userSetting.speed);
    await playAudio(connection, audioData);
  } else if (autoJoin && message.member.voice.channel) {
    // 自動参加が有効で、メッセージ送信者がボイスチャンネルにいる場合
    await joinVoiceChannelIfNeeded(message);
    if (isReading) {
      const userSetting = userSettings[message.author.id] || { speakerId: config.DEFAULT_SPEAKER_ID, speed: config.DEFAULT_SPEED };
      const audioData = await generateVoice(message.content, userSetting.speakerId, userSetting.speed);
      await playAudio(getVoiceConnection(message.guildId), audioData);
    }
  }
});

// 必要に応じてボイスチャンネルに参加する関数
async function joinVoiceChannelIfNeeded(message) {
  if (!message.member.voice.channel) return false;

  const connection = getVoiceConnection(message.guildId);
  if (!connection) {
    const newConnection = joinVoiceChannel({
      channelId: message.member.voice.channelId,
      guildId: message.guildId,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    isReading = true;
    const userSetting = userSettings[message.author.id] || { speakerId: config.DEFAULT_SPEAKER_ID, speed: config.DEFAULT_SPEED };
    const audioData = await generateVoice('読み上げを開始します', userSetting.speakerId, userSetting.speed);
    await playAudio(newConnection, audioData);
    return true;
  }
  return false;
}

// ボイスチャンネルの状態変更時の処理
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const connection = getVoiceConnection(newState.guild.id);
  if (!connection || !isReading) return;

  const userSetting = userSettings[newState.member.user.id] || { speakerId: config.DEFAULT_SPEAKER_ID, speed: config.DEFAULT_SPEED };

  // サーバーでのニックネームを取得、設定されていない場合はユーザー名を使用
  const memberName = newState.member.nickname || newState.member.user.username;

  if (!oldState.channelId && newState.channelId) {
    // ユーザーがボイスチャンネルに参加した場合
    const audioData = await generateVoice(`${memberName}さんが参加しました`, userSetting.speakerId, userSetting.speed);
    await playAudio(connection, audioData);
  } else if (oldState.channelId && !newState.channelId) {
    // ユーザーがボイスチャンネルから退出した場合
    const audioData = await generateVoice(`${memberName}さんが退出しました`, userSetting.speakerId, userSetting.speed);
    await playAudio(connection, audioData);
  }
});

// ボットにログイン
client.login(config.DISCORD_TOKEN).catch(error => {
  console.error('ボットのログインに失敗しました:', error);
  process.exit(1);
});