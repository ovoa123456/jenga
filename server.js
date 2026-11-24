const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const rooms = new Map();

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

function makeCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

io.on("connection", socket => {
  socket.on("create-room", callback => {
    let roomId;
    do { roomId = makeCode(); } while (rooms.has(roomId));
    rooms.set(roomId, { players: new Set(), state: null });
    callback({ ok: true, roomId });
  });

  socket.on("join-room", ({ roomId }, callback) => {
    roomId = String(roomId || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    const room = rooms.get(roomId);
    if (!room) return callback({ ok: false, error: "방을 찾을 수 없어. 코드를 확인해 줘." });
    if (room.players.size >= 2 && !room.players.has(socket.id))
      return callback({ ok: false, error: "이 방은 이미 두 명이 접속했어." });

    room.players.add(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.player = [...room.players].indexOf(socket.id) + 1;
    callback({ ok: true, roomId, player: socket.data.player, count: room.players.size, state: room.state });
    io.to(roomId).emit("room-count", { roomId, count: room.players.size });
  });

  socket.on("game-state", data => {
    const roomId = socket.data.roomId;
    if (!roomId || data.roomId !== roomId) return;
    // Relay the latest transforms to the other player in this room.
    io.to(roomId).except(socket.id).emit("game-state", { roomId, transforms: data.transforms });
    const room = rooms.get(roomId);
    if (room) room.state = { ...(room.state || {}), transforms: data.transforms };
  });

  socket.on("question-sync", data => {
    const roomId = socket.data.roomId;
    if (!roomId || data.roomId !== roomId) return;
    io.to(roomId).except(socket.id).emit("question-sync", data);
    const room = rooms.get(roomId);
    if (room) room.state = { ...(room.state || {}), question: data.question, category: data.category, turn: data.turn };
  });

  socket.on("turn-sync", data => {
    const roomId = socket.data.roomId;
    if (!roomId || data.roomId !== roomId) return;
    io.to(roomId).except(socket.id).emit("turn-sync", data);
    const room = rooms.get(roomId);
    if (room) room.state = { ...(room.state || {}), turn: data.turn };
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.players.delete(socket.id);
    io.to(roomId).emit("room-count", { roomId, count: room.players.size });
    if (room.players.size === 0) rooms.delete(roomId);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Couple Jenga listening on ${port}`));
