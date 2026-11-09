// ツァーフィル オンライン対戦サーバー
// 起動: npm start（または node server.js）→ ブラウザで http://localhost:3000 を開く
//
// サーバーの役割は「部屋番号ごとに2人を組み合わせる」「色と先手をランダムに決める」
// 「手番の人の指し手だけを相手に中継する」の3つ。
// 盤面とルールの処理はブラウザ側（tsarfil.html）で行い、受け取った手が正しいかもブラウザ側で確かめる。

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const N = 13;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ゲーム画面だけを公開する（server.js などのファイルは公開しない）
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "tsarfil.html")));

// 部屋番号 → { players: [{ id, color, rematch }], turn, started }
const rooms = new Map();

const other = c => (c === "w" ? "b" : "w");
const isSquare = v => Number.isInteger(v) && v >= 0 && v < N;

// 送られてきた手の形を確かめ、余計なデータを除いて作り直す
function cleanMove(m, color) {
  if (!m || typeof m !== "object" || !isSquare(m.tx) || !isSquare(m.ty)) return null;
  if (m.drop !== undefined) {
    if (typeof m.drop !== "string" || !/^[a-z]{2,12}$/.test(m.drop)) return null;
    return { drop: m.drop, c: color, tx: m.tx, ty: m.ty };
  }
  if (!isSquare(m.fx) || !isSquare(m.fy)) return null;
  return { fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty };
}

function startGame(roomId) {
  const room = rooms.get(roomId);
  const colors = Math.random() < 0.5 ? ["w", "b"] : ["b", "w"];
  const first = Math.random() < 0.5 ? "w" : "b";
  room.players.forEach((p, i) => { p.color = colors[i]; p.rematch = false; });
  room.turn = first;
  room.started = true;
  for (const p of room.players) io.to(p.id).emit("start", { color: p.color, first });
  console.log(`部屋 ${roomId}: 対局開始（先手 ${first === "w" ? "白" : "黒"}）`);
}

io.on("connection", socket => {
  let roomId = null;

  const myRoom = () => (roomId ? rooms.get(roomId) : null);
  const me = room => room.players.find(p => p.id === socket.id);

  function leave() {
    if (!roomId) return;
    const room = rooms.get(roomId);
    socket.leave(roomId);
    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);
      room.started = false;
      if (room.players.length === 0) rooms.delete(roomId);
      else io.to(roomId).emit("opponent-left");
    }
    console.log(`部屋 ${roomId}: 1人退室`);
    roomId = null;
  }

  socket.on("join", raw => {
    const id = String(raw ?? "").trim();
    if (!/^\d{1,8}$/.test(id)) {
      socket.emit("join-error", "部屋番号は1〜8桁の数字で入力してください。");
      return;
    }
    leave();
    let room = rooms.get(id);
    if (!room) {
      room = { players: [], turn: null, started: false };
      rooms.set(id, room);
    }
    if (room.players.length >= 2) {
      socket.emit("join-error", `部屋 ${id} は満員です。別の番号を入力してください。`);
      return;
    }
    room.players.push({ id: socket.id, color: null, rematch: false });
    roomId = id;
    socket.join(id);
    socket.emit("joined", id);
    console.log(`部屋 ${id}: 入室（${room.players.length}/2）`);
    if (room.players.length === 2) startGame(id);
    else socket.emit("waiting");
  });

  // 手番の人の手だけを相手に中継する
  function relay(event, payload) {
    const room = myRoom();
    if (!room || !room.started) return;
    const player = me(room);
    if (!player || player.color !== room.turn) return;
    room.turn = other(room.turn);
    socket.to(roomId).emit(event, payload);
  }

  socket.on("move", m => {
    const room = myRoom();
    const player = room && me(room);
    const move = player && cleanMove(m, player.color);
    if (move) relay("move", move);
  });

  socket.on("pass", () => relay("pass"));

  // 2人とも「再戦」を押したら新しい対局を始める
  socket.on("rematch", () => {
    const room = myRoom();
    if (!room || room.players.length < 2) return;
    me(room).rematch = true;
    if (room.players.every(p => p.rematch)) startGame(roomId);
    else socket.to(roomId).emit("rematch-requested");
  });

  socket.on("leave", leave);
  socket.on("disconnect", leave);
});

server.listen(PORT, () => {
  console.log(`ツァーフィル サーバー起動: http://localhost:${PORT}`);
});
